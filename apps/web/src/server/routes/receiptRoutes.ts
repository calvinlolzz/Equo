import type { PostgrestClient } from "../db/postgrestClient.js";
import type { ScanReceiptRequest } from "../../contracts/schemas.js";
import { validateScanReceiptRequest } from "../../contracts/validation.js";
import type { GoogleTokenVerifier } from "../auth/google.js";
import { buildAuthContext } from "../auth/routeContext.js";
import { ReceiptScanUnavailableError, type ReceiptScanner } from "../runtime/receiptScanner.js";

type RouteOptions = {
  client: PostgrestClient;
  verifier: GoogleTokenVerifier;
  idToken: string;
  /** Absent = this deployment has recognition switched off (no ANTHROPIC_API_KEY). */
  scanReceipt?: ReceiptScanner;
};

/**
 * POST /api/v1/receipts/scan — read a photographed receipt into composer fields.
 *
 * Not scoped to a group on purpose: nothing is read from or written to the
 * ledger, so membership has nothing to authorise. What it does cost is an
 * upstream model call, which is why it sits behind the session wall and its own
 * rate-limit bucket rather than the shared write budget.
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
    return {
      ok: false,
      status: 503,
      body: {
        error: {
          code: "RECEIPT_SCAN_UNAVAILABLE",
          message: "Receipt recognition is not configured on this deployment.",
          request_id: request.client_request_id,
        },
      },
    };
  }

  try {
    const result = await options.scanReceipt({ dataUrl: request.data_url, currency: request.currency });
    return { ok: true, status: 200, body: result };
  } catch (error) {
    // The photo itself is never logged - a receipt carries a card's last four
    // digits and where somebody was at what time.
    console.warn("Receipt recognition failed:", (error as Error).message);
    return {
      ok: false,
      status: 503,
      body: {
        error: {
          code: "RECEIPT_SCAN_UNAVAILABLE",
          message:
            error instanceof ReceiptScanUnavailableError
              ? "Receipt recognition is temporarily unavailable."
              : "Receipt recognition failed.",
          request_id: request.client_request_id,
        },
      },
    };
  }
}
