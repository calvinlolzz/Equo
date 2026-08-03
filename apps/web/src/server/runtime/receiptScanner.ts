import type { ScanReceiptLineItem, ScanReceiptResponse } from "../../contracts/schemas.js";

/** The composer's category keys. The model must return one of these or null - a free-text guess would not map to any chip. */
export const RECEIPT_CATEGORIES = ["food", "transport", "lodging", "shopping", "general", "other"] as const;

/**
 * Models this endpoint knows how to call: vision-capable, and supporting the
 * structured-output schema the response is parsed from.
 *
 * The allowlist lives here rather than in the database on purpose - it is a
 * property of the deployed code, so adding a model must not need a migration,
 * and dropping one must not leave a saved setting pointing at something the
 * server will now reject on every scan.
 *
 * Note the effort parameter is deliberately NOT sent on any of them: it is
 * rejected outright by Haiku 4.5, so passing it would make the cheapest option
 * the one model this endpoint cannot run on.
 */
export const RECEIPT_SCAN_MODELS = ["claude-haiku-4-5", "claude-sonnet-5", "claude-opus-5"] as const;

/** Cheapest of the allowed models; recognition is perception, not reasoning. */
export const RECEIPT_SCAN_DEFAULT_MODEL: string = RECEIPT_SCAN_MODELS[0];

export function isReceiptScanModel(model: string): boolean {
  return (RECEIPT_SCAN_MODELS as readonly string[]).includes(model);
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

const RESPONSE_SCHEMA = {
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
      anyOf: [{ type: "string", enum: ["TWD", "JPY", "USD", "EUR", "CNY", "HKD", "KRW", "GBP", "SGD", "THB", "AUD", "CAD", "MYR", "VND", "PHP"] }, { type: "null" }],
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

/**
 * Receipt recognition backed by Claude vision, or undefined when this
 * deployment has no ANTHROPIC_API_KEY.
 *
 * Returning undefined rather than throwing is the point: the route reports the
 * feature as unavailable and the client still attaches the photo, so a missing
 * key costs the auto-fill and nothing else.
 */
export function createReceiptScanner(apiKey: string | undefined): ReceiptScanner | undefined {
  if (!apiKey) return undefined;

  return async ({ dataUrl, currency, model }) => {
    // Guard here as well as at the route: this is the last point before real
    // money is spent, and an unknown model id fails as a 404 per scan rather
    // than anywhere a user would see.
    const modelId = isReceiptScanModel(model) ? model : RECEIPT_SCAN_DEFAULT_MODEL;
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const client = new Anthropic({ apiKey, timeout: REQUEST_TIMEOUT_MS, maxRetries: 1 });

    let response;
    try {
      response = await client.messages.create({
        model: modelId,
        max_tokens: MAX_TOKENS,
        system: SYSTEM_PROMPT,
        output_config: { format: { type: "json_schema", schema: RESPONSE_SCHEMA } },
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
              {
                type: "text",
                text: `Extract this receipt. If no currency is printed on it, assume ${currency}.`,
              },
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
    const payload = textBlock && "text" in textBlock ? textBlock.text : "";

    try {
      return normaliseReceiptResult(JSON.parse(payload) as RawReceipt, currency);
    } catch {
      throw new ReceiptScanUnavailableError("Receipt recognition returned a response that was not JSON.");
    }
  };
}
