import type { PostgrestClient } from "../db/postgrestClient.js";
import type { ScanReceiptRequest } from "../../contracts/schemas.js";
import { validateScanReceiptRequest } from "../../contracts/validation.js";
import type { GoogleTokenVerifier } from "../auth/google.js";
import { buildAuthContext } from "../auth/routeContext.js";
import type { ScanLogEntry } from "../repositories/scanLogRepository.js";
import { createSupabaseScanLogRepository } from "../repositories/supabaseScanLogRepository.js";
import { createSupabaseSettingsRepository } from "../repositories/supabaseSettingsRepository.js";
import {
  RECEIPT_SCAN_DEFAULT_MODEL,
  ReceiptScanUnavailableError,
  estimateScanCostMicros,
  findReceiptScanModel,
  isReceiptScanModel,
  readLastScanUsage,
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

  // Read out here rather than inside record(): TypeScript does not carry the
  // union narrowing above into a nested function, and the id is all it needs.
  const scanUserId = auth.context.user.id;

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

  /**
   * Log the call, then record it.
   *
   * Both, not one or the other: the log line is what somebody greps during an
   * incident, and the row is what the console aggregates a month later. The
   * write is awaited rather than left floating — a serverless function can be
   * frozen the moment it responds, which drops a detached promise — and it is
   * one indexed insert in the same region against a call that just spent
   * seconds upstream.
   *
   * Recording is best-effort by design. A scan the user has already paid for
   * must not turn into an error because the bookkeeping failed, and a
   * deployment running ahead of this migration has no function to call.
   */
  async function record(outcome: ScanLogEntry["outcome"], failureReason?: string) {
    const usage = readLastScanUsage();
    const elapsed = Date.now() - startedAt;
    const costMicros = estimateScanCostMicros(model, usage);

    // The photo itself is never logged - a receipt carries a card's last four
    // digits and where somebody was at what time.
    //
    // Failures stay at warn so they keep showing up under a log-level filter,
    // which is how this line was read before it also became a table row.
    const write = outcome === "failed" ? console.warn : console.log;
    write(
      `Receipt scan: model=${model} outcome=${outcome} upstream_ms=${elapsed} bytes=${request.data_url.length} ` +
        `image_tokens=${usage.imageTokens ?? "n/a"} input_tokens=${usage.inputTokens ?? "n/a"} ` +
        `thought_tokens=${usage.thoughtTokens ?? "n/a"} output_tokens=${usage.outputTokens ?? "n/a"} ` +
        `attempts=${usage.attempts} cost_micros=${costMicros ?? "n/a"}` +
        (failureReason ? ` reason=${failureReason}` : ""),
    );

    try {
      await createSupabaseScanLogRepository(options.client).record({
        userId: scanUserId,
        model,
        provider: findReceiptScanModel(model)?.provider ?? "unknown",
        outcome,
        failureReason,
        upstreamMs: elapsed,
        imageBytes: request.data_url.length,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
        thoughtTokens: usage.thoughtTokens,
        imageTokens: usage.imageTokens,
        attempts: usage.attempts,
        costMicros,
      });
    } catch (error) {
      console.warn("Receipt scan usage not recorded:", (error as Error).message);
    }
  }

  try {
    const result = await options.scanReceipt({ dataUrl: request.data_url, currency: request.currency, model });
    // "Answered, but could not read it" is kept apart from "recognised": it is
    // the number that says whether the camera guidance is working, and folding
    // it into either success or failure hides it in both.
    await record(result.recognised ? "recognised" : "unrecognised");
    return { ok: true, status: 200, body: result };
  } catch (error) {
    await record("failed", (error as Error).message);
    return unavailable(
      error instanceof ReceiptScanUnavailableError
        ? "Receipt recognition is temporarily unavailable."
        : "Receipt recognition failed.",
      request.client_request_id,
    );
  }
}
