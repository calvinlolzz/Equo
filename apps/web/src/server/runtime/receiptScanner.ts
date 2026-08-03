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
  { id: "claude-haiku-4-5", provider: "anthropic", note: "付費・最便宜，約 US$0.003 一次" },
  { id: "claude-sonnet-5", provider: "anthropic", note: "付費・辨識較準，模糊或小字收據用" },
  { id: "claude-opus-5", provider: "anthropic", note: "付費・最準也最貴" },
  // Free of charge, and not free of consequences - see the terms warning the
  // console shows next to it. Kept last so it is a deliberate choice.
  { id: "gemini-3.6-flash", provider: "google", note: "免費層・Google 會用來訓練且真人可能閱讀" },
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
 * A scan must not hold an HTTP request open indefinitely - the user is staring
 * at a "辨識中…" spinner with a camera running behind it.
 */
const REQUEST_TIMEOUT_MS = 30_000;

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

  // Safety classifiers answer with a 200 and an empty content array, so
  // reading content[0] before checking stop_reason would throw on a refusal.
  if (response.stop_reason === "refusal") {
    throw new ReceiptScanUnavailableError("Receipt recognition was declined by the model's safety classifiers.");
  }

  const textBlock = response.content.find((block) => block.type === "text");
  return textBlock && "text" in textBlock ? textBlock.text : "";
}

type GeminiStep = { type?: string; content?: Array<{ type?: string; text?: string }> };

/**
 * Gemini's Interactions API. Called over plain HTTPS rather than through a
 * Google SDK: the request is one JSON body and the response one field deep, so
 * a dependency would buy nothing but a version to keep current.
 */
async function callGemini(apiKey: string, { dataUrl, currency, model }: ScanInput): Promise<string> {
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
      }),
    });
  } catch (error) {
    // Includes the abort: a hung upstream must surface as "unavailable" rather
    // than holding the request open behind a user's spinner.
    throw new ReceiptScanUnavailableError(`Receipt recognition upstream failed: ${(error as Error).message}`);
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    // 429 here is the free tier's quota, which is the expected failure rather
    // than an exceptional one - the caller degrades to attaching the photo.
    throw new ReceiptScanUnavailableError(`Receipt recognition upstream returned ${response.status}.`);
  }

  const body = (await response.json()) as { steps?: GeminiStep[] };
  // Search for the model_output step instead of indexing steps[0]: the array is
  // a timeline that can also carry thoughts and tool steps, and which of those
  // appear is not ours to control.
  const output = body.steps?.find((step) => step.type === "model_output");
  return output?.content?.find((part) => part.type === "text")?.text ?? "";
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
