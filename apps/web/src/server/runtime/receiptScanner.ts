import type { ScanReceiptLineItem, ScanReceiptResponse } from "../../contracts/schemas.js";

/** The composer's category keys. The model must return one of these or null - a free-text guess would not map to any chip. */
export const RECEIPT_CATEGORIES = ["food", "transport", "lodging", "shopping", "general", "other"] as const;

export type ReceiptScanProvider = "anthropic" | "google";

export type ReceiptScanModel = {
  id: string;
  provider: ReceiptScanProvider;
  /**
   * Shown in the console next to the id. Says what choosing it actually costs,
   * because that is the only reason anybody switches.
   */
  note: string;
  /**
   * List price in USD per million tokens, used to turn a scan's token counts
   * into the console's spend estimate.
   *
   * Deliberately here rather than in the database: the price belongs to the
   * model, the model list is already a property of the deployed code, and a
   * pricing table somebody has to remember to update separately is a pricing
   * table that goes stale silently.
   *
   * An estimate, and it rounds up rather than down. Claude Sonnet 5 carries
   * introductory pricing ($2/$10) until 2026-08-31; the standard rate is used
   * so the number never under-reports what the next invoice will say.
   */
  usdPerMTokIn: number;
  usdPerMTokOut: number;
};

/**
 * Models this endpoint knows how to call: vision-capable, and able to be held
 * to the structured-output schema the response is parsed from.
 *
 * The allowlist lives here rather than in the database on purpose - it is a
 * property of the deployed code, so adding a model must not need a migration,
 * and dropping one must not leave a saved setting pointing at something the
 * server will now reject on every scan.
 *
 * Note the effort parameter is deliberately NOT sent to the Claude models: it
 * is rejected outright by Haiku 4.5, so passing it would make the cheapest
 * option the one model this endpoint cannot run on.
 */
export const RECEIPT_SCAN_MODELS: readonly ReceiptScanModel[] = [
  { id: "claude-haiku-4-5", provider: "anthropic", note: "付費・最便宜，約 US$0.003 一次", usdPerMTokIn: 1, usdPerMTokOut: 5 },
  { id: "claude-sonnet-5", provider: "anthropic", note: "付費・辨識較準，模糊或小字收據用", usdPerMTokIn: 3, usdPerMTokOut: 15 },
  { id: "claude-opus-5", provider: "anthropic", note: "付費・最準也最貴", usdPerMTokIn: 5, usdPerMTokOut: 25 },
  // Free of charge, and not free of consequences - see the terms warning the
  // console shows next to it. Kept last so it is a deliberate choice.
  // Zero-rated on purpose: the free tier's price really is nothing, and the
  // console's spend chart going flat while scan volume climbs is the honest
  // picture of what switching to it did.
  { id: "gemini-3.6-flash", provider: "google", note: "免費層・Google 會用來訓練且真人可能閱讀", usdPerMTokIn: 0, usdPerMTokOut: 0 },
];

/** Cheapest paid option; recognition is perception, not reasoning. */
export const RECEIPT_SCAN_DEFAULT_MODEL = "claude-haiku-4-5";

export function findReceiptScanModel(model: string): ReceiptScanModel | undefined {
  return RECEIPT_SCAN_MODELS.find((entry) => entry.id === model);
}

export function isReceiptScanModel(model: string): boolean {
  return findReceiptScanModel(model) !== undefined;
}

/** Generous headroom over the small JSON, so a long itemised receipt is never truncated mid-object. */
const MAX_TOKENS = 4000;

/**
 * How long to wait before calling it a failure.
 *
 * Sized from what the happy path actually costs: a successful recognition
 * measures ~4.4s upstream, so 12s is already generous. The old 30s was picked
 * before there was any data, and production showed what it buys - a hung
 * upstream made the user watch "辨識中…" for half a minute before being told it
 * had failed. Failing at 12s is not a worse outcome than failing at 30s; it is
 * the same outcome, eighteen seconds sooner.
 */
const REQUEST_TIMEOUT_MS = 12_000;

const SYSTEM_PROMPT = [
  "You extract structured data from a photo of a purchase receipt.",
  "Return the grand total the customer actually paid - after discounts, including tax - not the subtotal and not any single line item.",
  "Receipts are usually Traditional Chinese (Taiwan): 統一發票, 應稅, 小計, 合計, 總計, 應收, 現金, 找零. 合計/總計/應收 is the total; 找零 is change given back and is never the total.",
  "Keep merchant and item names in the language printed on the receipt; do not translate them.",
  "Set recognised to false when the image is not a receipt, or is too blurry or cropped to read a total. When recognised is false every other field must be null or empty.",
  "Never invent a value you cannot read. A null field is correct and useful; a plausible guess is not.",
].join("\n");

const CURRENCY_CODES = ["TWD", "JPY", "USD", "EUR", "CNY", "HKD", "KRW", "GBP", "SGD", "THB", "AUD", "CAD", "MYR", "VND", "PHP"];

/**
 * Claude's dialect: nullability is an anyOf against a null branch.
 */
const ANTHROPIC_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    recognised: { type: "boolean" },
    merchant: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Shop or restaurant name as printed, or null if not shown.",
    },
    total_amount: {
      anyOf: [{ type: "number" }, { type: "null" }],
      description: "Grand total as a decimal in the receipt's own currency, e.g. 1250.5. Null if unreadable.",
    },
    currency: {
      anyOf: [{ type: "string", enum: CURRENCY_CODES }, { type: "null" }],
      description: "ISO 4217 code of the currency printed on the receipt. Null when no symbol or code is visible.",
    },
    purchased_at: {
      anyOf: [{ type: "string" }, { type: "null" }],
      description: "Date printed on the receipt as YYYY-MM-DD. Convert 民國 years by adding 1911. Null if not shown.",
    },
    category: {
      anyOf: [{ type: "string", enum: [...RECEIPT_CATEGORIES] }, { type: "null" }],
      description: "Best-fitting spending category for the whole receipt.",
    },
    items: {
      type: "array",
      description: "Line items, in printed order. Empty when individual lines are not legible.",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          amount: { anyOf: [{ type: "number" }, { type: "null" }] },
        },
        required: ["name", "amount"],
        additionalProperties: false,
      },
    },
  },
  required: ["recognised", "merchant", "total_amount", "currency", "purchased_at", "category", "items"],
  additionalProperties: false,
};

/**
 * Gemini's dialect of the same schema.
 *
 * Not a cosmetic difference: its structured-output subset has no anyOf, and
 * expresses nullability by listing "null" in the type array instead. Feeding it
 * the Claude schema above is rejected, so the two are written out separately
 * rather than translated at runtime - a translator would be one more thing that
 * can be subtly wrong in a way only production notices.
 */
const GEMINI_RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    recognised: { type: "boolean" },
    merchant: {
      type: ["string", "null"],
      description: "Shop or restaurant name as printed, or null if not shown.",
    },
    total_amount: {
      type: ["number", "null"],
      description: "Grand total as a decimal in the receipt's own currency, e.g. 1250.5. Null if unreadable.",
    },
    currency: {
      type: ["string", "null"],
      enum: [...CURRENCY_CODES, null],
      description: "ISO 4217 code of the currency printed on the receipt. Null when no symbol or code is visible.",
    },
    purchased_at: {
      type: ["string", "null"],
      description: "Date printed on the receipt as YYYY-MM-DD. Convert 民國 years by adding 1911. Null if not shown.",
    },
    category: {
      type: ["string", "null"],
      enum: [...RECEIPT_CATEGORIES, null],
      description: "Best-fitting spending category for the whole receipt.",
    },
    items: {
      type: "array",
      description: "Line items, in printed order. Empty when individual lines are not legible.",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          amount: { type: ["number", "null"] },
        },
        required: ["name", "amount"],
      },
    },
  },
  required: ["recognised", "merchant", "total_amount", "currency", "purchased_at", "category", "items"],
};

type RawReceipt = {
  recognised?: unknown;
  merchant?: unknown;
  total_amount?: unknown;
  currency?: unknown;
  purchased_at?: unknown;
  category?: unknown;
  items?: unknown;
};

/** Thrown when recognition could not run or produced nothing usable. The route turns this into RECEIPT_SCAN_UNAVAILABLE. */
export class ReceiptScanUnavailableError extends Error {}

export type ReceiptScanner = (input: {
  dataUrl: string;
  currency: string;
  /** Chosen per call, because an admin can change it between two requests. */
  model: string;
}) => Promise<ScanReceiptResponse>;

function mediaTypeFromDataUrl(dataUrl: string): "image/jpeg" | "image/png" | "image/webp" {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,/.exec(dataUrl);
  return (match?.[1] as "image/jpeg" | "image/png" | "image/webp" | undefined) ?? "image/jpeg";
}

/**
 * Every amount in this app is stored as hundredths regardless of the currency's
 * real exponent (see the composer's /100 round-trip), so JPY follows the same
 * rule as TWD. Keep that consistent here or a scanned yen receipt lands 100x
 * off from a hand-typed one.
 */
function toMinor(amount: unknown): number | null {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 0) return null;
  return Math.round(amount * 100);
}

function asTrimmedString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function asIsoDate(value: unknown): string | null {
  const text = asTrimmedString(value);
  if (!text || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  // Round-trip rather than a NaN check: Date rolls an impossible day over
  // instead of rejecting it, so 2026-02-31 parses happily as 2026-03-03 and
  // would file the expense two days late without any error to notice.
  const parsed = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text ? text : null;
}

function asItems(value: unknown): ScanReceiptLineItem[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, 50)
    .map((entry) => {
      const name = asTrimmedString((entry as { name?: unknown })?.name);
      return name ? { name, amount_minor: toMinor((entry as { amount?: unknown })?.amount) } : null;
    })
    .filter((item): item is ScanReceiptLineItem => item !== null);
}

/** Narrow the model's JSON to the response contract, dropping anything that doesn't fit rather than trusting it. */
export function normaliseReceiptResult(raw: RawReceipt, fallbackCurrency: string): ScanReceiptResponse {
  const empty: ScanReceiptResponse = {
    recognised: false,
    merchant: null,
    amount_minor: null,
    currency: null,
    purchased_at: null,
    category: null,
    items: [],
  };

  if (raw?.recognised !== true) return empty;

  const amountMinor = toMinor(raw.total_amount);
  // A receipt with no readable total is not a usable scan: the composer would
  // open with a merchant name and an empty amount, which is worse than the
  // plain photo path because it looks like it worked.
  if (amountMinor === null || amountMinor <= 0) return empty;

  const category = asTrimmedString(raw.category);

  return {
    recognised: true,
    merchant: asTrimmedString(raw.merchant),
    amount_minor: amountMinor,
    currency: asTrimmedString(raw.currency) ?? fallbackCurrency,
    purchased_at: asIsoDate(raw.purchased_at),
    category: category && (RECEIPT_CATEGORIES as readonly string[]).includes(category) ? category : null,
    items: asItems(raw.items),
  };
}

/** The instruction and the image, in the shape both callers need. */
type ScanInput = { dataUrl: string; currency: string; model: string };

function userPrompt(currency: string): string {
  return `Extract this receipt. If no currency is printed on it, assume ${currency}.`;
}

async function callAnthropic(apiKey: string, { dataUrl, currency, model }: ScanInput): Promise<string> {
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 });

  let response;
  try {
    response = await client.messages.create({
      model,
      max_tokens: MAX_TOKENS,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: "json_schema", schema: ANTHROPIC_RESPONSE_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaTypeFromDataUrl(dataUrl),
                data: dataUrl.slice(dataUrl.indexOf(",") + 1),
              },
            },
            { type: "text", text: userPrompt(currency) },
          ],
        },
      ],
    });
  } catch (error) {
    throw new ReceiptScanUnavailableError(`Receipt recognition upstream failed: ${(error as Error).message}`);
  }

  // Recorded before the refusal check below: a declined request still spent
  // input tokens, and a scan that cost money has to appear in the spend report
  // whether or not it produced an answer.
  lastScanUsage = {
    ...EMPTY_USAGE,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    attempts: 1,
  };

  // Safety classifiers answer with a 200 and an empty content array, so
  // reading content[0] before checking stop_reason would throw on a refusal.
  if (response.stop_reason === "refusal") {
    throw new ReceiptScanUnavailableError("Receipt recognition was declined by the model's safety classifiers.");
  }

  const textBlock = response.content.find((block) => block.type === "text");
  return textBlock && "text" in textBlock ? textBlock.text : "";
}

type GeminiStep = { type?: string; content?: Array<{ type?: string; text?: string }> };

type GeminiUsage = {
  total_thought_tokens?: number;
  total_output_tokens?: number;
  total_input_tokens?: number;
  /** Per-modality split; the "image" entry is what a photo's resolution actually costs. */
  input_tokens_by_modality?: Array<{ modality?: string; tokens?: number }>;
};

/**
 * What the last scan spent, in the one shape both providers can fill.
 *
 * Anything a provider does not report stays null rather than becoming 0: a
 * missing number and a genuine zero mean opposite things on a spend chart, and
 * Anthropic does not break out image tokens the way Gemini does.
 */
export type ScanUsage = {
  inputTokens: number | null;
  outputTokens: number | null;
  /** Reasoning tokens. Gemini reports these separately; Anthropic folds them into output. */
  thoughtTokens: number | null;
  /**
   * Image tokens, not bytes, are what a vision model actually spends time on:
   * an 87 KB JPEG can still be 1600px on its long edge and cost a pile of
   * tiles. Gemini-only — this is what tells downscaling apart from everything else.
   */
  imageTokens: number | null;
  /** How many upstream attempts this scan needed (Gemini retries once when unanswered). */
  attempts: number;
};

const EMPTY_USAGE: ScanUsage = {
  inputTokens: null,
  outputTokens: null,
  thoughtTokens: null,
  imageTokens: null,
  attempts: 0,
};

/**
 * What the last scan cost, for the route to log and record.
 *
 * Module-level and overwritten per call, which is fine because it is only ever
 * read immediately afterwards by the same request - and it keeps the scanner's
 * return type the response contract rather than a diagnostics envelope.
 *
 * Reset at the top of every scan, so a failed call reports its own emptiness
 * instead of the previous request's numbers. That matters more now than when
 * this was only a log line: these figures are written to receipt_scan_logs, and
 * a failure inheriting the last success's token counts would bill a scan that
 * never happened.
 */
let lastScanUsage: ScanUsage = EMPTY_USAGE;

export function readLastScanUsage(): ScanUsage {
  return lastScanUsage;
}

function findModality(usage: GeminiUsage, modality: string): number | null {
  return usage.input_tokens_by_modality?.find((entry) => entry.modality === modality)?.tokens ?? null;
}

/**
 * The estimated cost of one scan, in millionths of a USD.
 *
 * Micro-dollars because a Haiku scan is roughly US$0.0005 — in cents it would
 * round to zero, and a column of zeros is not a cost report. An integer, so the
 * database column can be one too and a month's total never drifts the way a
 * summed float does. Unknown token counts return null rather than 0: "we did
 * not measure this" is not "this was free".
 */
export function estimateScanCostMicros(model: string, usage: ScanUsage): number | null {
  const entry = findReceiptScanModel(model);

  if (!entry || usage.inputTokens === null || usage.outputTokens === null) return null;

  // Gemini's thought tokens are billed as output where they are billed at all;
  // on the free tier every rate is zero and this whole sum collapses anyway.
  const output = usage.outputTokens + (usage.thoughtTokens ?? 0);
  const usd = (usage.inputTokens * entry.usdPerMTokIn + output * entry.usdPerMTokOut) / 1_000_000;
  return Math.round(usd * 1_000_000);
}

/** Thrown by a single attempt when nothing came back at all, so the caller knows a retry is worth it. */
class GeminiUnansweredError extends Error {}

/**
 * One attempt at Gemini's Interactions API. Called over plain HTTPS rather than
 * through a Google SDK: the request is one JSON body and the response one field
 * deep, so a dependency would buy nothing but a version to keep current.
 */
async function callGeminiOnce(apiKey: string, { dataUrl, currency, model }: ScanInput): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch("https://generativelanguage.googleapis.com/v1beta/interactions", {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        // The Interactions API has no documented system-instruction field, so
        // the standing instructions ride as the first text part. Order matters:
        // the rules have to precede the image they apply to.
        input: [
          { type: "text", text: SYSTEM_PROMPT },
          {
            type: "image",
            data: dataUrl.slice(dataUrl.indexOf(",") + 1),
            mime_type: mediaTypeFromDataUrl(dataUrl),
          },
          { type: "text", text: userPrompt(currency) },
        ],
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: GEMINI_RESPONSE_SCHEMA,
        },
        // Reading a receipt is perception, not reasoning, and Gemini 3 thinks
        // at "medium" unless told otherwise - which is latency the user spends
        // staring at a spinner for no gain. "minimal" is the floor this model
        // allows; thinking cannot be switched off entirely on the Flash line.
        generation_config: { thinking_level: "minimal" },
      }),
    });
  } catch (error) {
    // The abort lands here, and so does a dropped connection: in both cases the
    // upstream said nothing at all, which is the one failure a second attempt
    // can plausibly fix.
    throw new GeminiUnansweredError(`upstream did not answer: ${(error as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    // A status IS an answer - 429 means quota, 400 means the request is wrong -
    // and repeating it would just spend the same rejection twice.
    throw new ReceiptScanUnavailableError(`Receipt recognition upstream returned ${response.status}.`);
  }

  const body = (await response.json()) as { steps?: GeminiStep[]; usage?: GeminiUsage };
  const usage = body.usage ?? {};
  lastScanUsage = {
    inputTokens: usage.total_input_tokens ?? null,
    outputTokens: usage.total_output_tokens ?? null,
    thoughtTokens: usage.total_thought_tokens ?? null,
    imageTokens: findModality(usage, "image"),
    attempts: lastScanUsage.attempts,
  };
  // Search for the model_output step instead of indexing steps[0]: the array is
  // a timeline that can also carry thoughts and tool steps, and which of those
  // appear is not ours to control.
  const output = body.steps?.find((step) => step.type === "model_output");
  return output?.content?.find((part) => part.type === "text")?.text ?? "";
}

/** One retry, and only when nothing came back. */
const GEMINI_MAX_ATTEMPTS = 2;

/**
 * Gemini, retried once when the upstream simply never answers.
 *
 * Production showed two out of three scans ending as a full timeout with no
 * response at all, while the ones that did answer took ~4.4s. A stall like that
 * is exactly what a second attempt on a fresh connection is for - and it is
 * nearly free here, because the composer no longer waits on the result: the
 * user is already typing while this happens.
 *
 * Deliberately narrow. Only an unanswered request is retried; any HTTP status
 * is a real answer (a 429 is the free tier's quota) and repeating it would just
 * spend the same rejection twice, or add load to something already throttling.
 *
 * The Anthropic path has had this all along via the SDK's own maxRetries: 1 -
 * the hand-rolled Gemini path was the one silently without it.
 */
async function callGemini(apiKey: string, input: ScanInput): Promise<string> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= GEMINI_MAX_ATTEMPTS; attempt += 1) {
    // Set before the call, so callGeminiOnce carries it through when it
    // overwrites the record with the usage the upstream reported.
    lastScanUsage = { ...lastScanUsage, attempts: attempt };
    try {
      return await callGeminiOnce(apiKey, input);
    } catch (error) {
      lastError = error;
      if (!(error instanceof GeminiUnansweredError)) throw error;
    }
  }

  throw new ReceiptScanUnavailableError(
    `Receipt recognition upstream failed after ${GEMINI_MAX_ATTEMPTS} attempts: ${(lastError as Error).message}`,
  );
}

/** API keys per provider. A provider with no key simply has no models available. */
export type ReceiptScanKeys = {
  anthropic?: string;
  google?: string;
};

/** Which of the catalog's models this deployment can actually run. */
export function availableReceiptScanModels(keys: ReceiptScanKeys): ReceiptScanModel[] {
  return RECEIPT_SCAN_MODELS.filter((entry) =>
    entry.provider === "anthropic" ? Boolean(keys.anthropic) : Boolean(keys.google),
  );
}

/**
 * Receipt recognition, or undefined when no provider has a key at all.
 *
 * Returning undefined rather than throwing is the point: the route reports the
 * feature as unavailable and the client still attaches the photo, so a missing
 * key costs the auto-fill and nothing else. A key for one provider and not the
 * other still returns a scanner - it just cannot run the other's models, which
 * is what the console's per-model availability is for.
 */
export function createReceiptScanner(keys: ReceiptScanKeys): ReceiptScanner | undefined {
  if (!keys.anthropic && !keys.google) return undefined;

  return async ({ dataUrl, currency, model }) => {
    // Guard here as well as at the route: this is the last point before a real
    // request is spent, and an unknown model id fails as a 404 per scan rather
    // than anywhere a user would see.
    // Clear the previous call's numbers first: everything below can throw, and
    // a failure must not inherit the last success's token counts.
    lastScanUsage = EMPTY_USAGE;

    const entry = findReceiptScanModel(model) ?? findReceiptScanModel(RECEIPT_SCAN_DEFAULT_MODEL)!;
    const apiKey = entry.provider === "anthropic" ? keys.anthropic : keys.google;

    if (!apiKey) {
      throw new ReceiptScanUnavailableError(`No API key configured for ${entry.provider}.`);
    }

    const input = { dataUrl, currency, model: entry.id };
    const payload =
      entry.provider === "anthropic" ? await callAnthropic(apiKey, input) : await callGemini(apiKey, input);

    try {
      return normaliseReceiptResult(JSON.parse(payload) as RawReceipt, currency);
    } catch {
      throw new ReceiptScanUnavailableError("Receipt recognition returned a response that was not JSON.");
    }
  };
}
