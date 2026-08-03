import type { PostgrestClient } from "../db/postgrestClient.js";
import type { ScanReceiptRequest } from "../../contracts/schemas.js";
import { validateScanReceiptRequest } from "../../contracts/validation.js";
import type { GoogleTokenVerifier } from "../auth/google.js";
import { buildAuthContext } from "../auth/routeContext.js";
import { createSupabaseSettingsRepository } from "../repositories/supabaseSettingsRepository.js";
import {
  RECEIPT_SCAN_DEFAULT_MODEL,
  ReceiptScanUnavailableError,
  isReceiptScanModel,
  readLastGeminiUsage,
  type ReceiptScanner,
} from "../runtime/receiptScanner.js";

type RouteOptions = {
  client: PostgrestClient;
  verifier: GoogleTokenVerifier;
  idToken: string;
  /** Absent = this deployment has recognition switched off (no ANTHROPIC_API_KEY). */
  scanReceipt?: ReceiptScanner;
  /** The deployment's default model, used when no admin has chosen one. */
  defaultModel?: string;
};

function unavailable(message: string, requestId: string) {
  return {
    ok: false as const,
    status: 503 as const,
    body: { error: { code: "RECEIPT_SCAN_UNAVAILABLE", message, request_id: requestId } },
  };
}

/**
 * POST /api/v1/receipts/scan — read a photographed receipt into composer fields.
 *
 * Not scoped to a group on purpose: nothing is read from or written to the
 * ledger, so membership has nothing to authorise. What it does cost is an
 * upstream model call, which is why it sits behind the session wall, its own
 * rate-limit bucket, and the console's kill switch.
 *
 * Every failure below the auth check answers 503 RECEIPT_SCAN_UNAVAILABLE, and
 * the client treats that as "keep the photo, skip the auto-fill" — a scan that
 * cannot run must never cost the user the expense they were recording.
 */
export async function scanReceiptRoute(options: RouteOptions, request: ScanReceiptRequest) {
  const validation = validateScanReceiptRequest(request);

  if (!validation.ok) {
    return {
      ok: false,
      status: 400,
      body: {
        error: {
          code: validation.issues[0]?.code ?? "INVALID_IMAGE",
          message: validation.issues[0]?.message ?? "Invalid receipt scan request.",
          request_id: request?.client_request_id ?? "",
        },
      },
    };
  }

  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  if (!options.scanReceipt) {
    return unavailable("Receipt recognition is not configured on this deployment.", request.client_request_id);
  }

  const fallbackModel = options.defaultModel ?? RECEIPT_SCAN_DEFAULT_MODEL;
  let settings = { enabled: true, model: fallbackModel };

  try {
    const saved = await createSupabaseSettingsRepository(options.client).getReceiptScan(fallbackModel);
    settings = { enabled: saved.enabled !== false, model: saved.model || fallbackModel };
  } catch (error) {
    // Fail open, the same way rate limiting does: a deployment that is ahead of
    // its migration has no settings function to call, and refusing every scan
    // over that would break a working feature to protect a switch nobody has
    // touched yet. Logged, because the console's card will look wrong too.
    console.warn("Receipt scan settings unavailable, using defaults:", (error as Error).message);
  }

  if (!settings.enabled) {
    return unavailable("Receipt recognition is currently switched off.", request.client_request_id);
  }

  const model = isReceiptScanModel(settings.model) ? settings.model : fallbackModel;
  const startedAt = Date.now();

  try {
    const result = await options.scanReceipt({ dataUrl: request.data_url, currency: request.currency, model });
    // The one number worth having when somebody says "辨識好慢": it separates
    // the upstream's time from the round trip carrying a ~400 KB photo to get
    // here, which are fixed in completely different places.
    const usage = readLastGeminiUsage();
    console.log(
      `Receipt scan: model=${model} upstream_ms=${Date.now() - startedAt} bytes=${request.data_url.length} ` +
        `thought_tokens=${usage.total_thought_tokens ?? "n/a"} output_tokens=${usage.total_output_tokens ?? "n/a"} ` +
        `recognised=${result.recognised}`,
    );
    return { ok: true, status: 200, body: result };
  } catch (error) {
    // The photo itself is never logged - a receipt carries a card's last four
    // digits and where somebody was at what time.
    console.warn(`Receipt recognition failed after ${Date.now() - startedAt}ms:`, (error as Error).message);
    return unavailable(
      error instanceof ReceiptScanUnavailableError
        ? "Receipt recognition is temporarily unavailable."
        : "Receipt recognition failed.",
      request.client_request_id,
    );
  }
}
