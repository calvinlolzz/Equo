import type { PostgrestClient } from "../db/postgrestClient.js";
import type { GoogleIdentity } from "../auth/google.js";
import { isLiffTokenShape, liffIdentity, verifyLiffToken, type LiffClaims } from "../auth/liffToken.js";
import { liffLinkIsLive } from "../line/lineRepository.js";
import { getAuthToken, type HttpRuntimeRequest, type HttpRuntimeResponse } from "./httpTypes.js";
import { errorResponse } from "./jsonResponse.js";
import { liffAllows } from "./liffScope.js";

/**
 * The runtime's half of the LIFF session: the gate in front of the router, the
 * verifier a route uses to learn who is calling, and the one response filter.
 * liffToken.ts says what the token IS; liffScope.ts says what it may CALL; this
 * file applies both to a request.
 *
 * Everything here fails CLOSED. A LIFF-shaped token that does not verify is a
 * 401, never a fall-through to the other verifiers; a request outside the
 * allowlist is a 403; a question the database cannot answer is a 503, not a
 * "probably still fine".
 */

/** A path with ids blanked out, short enough for one log line. Never the query, never a token. */
function loggablePath(path: string): string {
  return path
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, ":id")
    .slice(0, 120);
}

/**
 * The token a request authenticates with, wherever it came from: getAuthToken
 * is bearer, then view-as cookie, then session cookie, and a LIFF token placed
 * in ANY of them is still a LIFF token. Gating only the Authorization header
 * would leave the cookies as a way around the revocation check.
 */
export function liffTokenOf(request: HttpRuntimeRequest): string | null {
  const token = getAuthToken(request);

  return isLiffTokenShape(token) ? token : null;
}

/** The verified claims behind this request's LIFF token, or null (no LIFF token, or not a valid one). */
export function liffClaimsOf(
  request: HttpRuntimeRequest,
  sessionSecret: string | undefined,
  now?: number,
): LiffClaims | null {
  const token = liffTokenOf(request);

  return token && sessionSecret ? verifyLiffToken(token, sessionSecret, now) : null;
}

/**
 * The route-level check, independent of the gate. A route's verifier calls this
 * for a LIFF-shaped token INSTEAD of the session and Google verifiers, so a
 * route that is reached some other way (a gate bug, a new entry point) still
 * refuses a request the scope does not cover.
 */
export function verifyLiffForRequest(
  token: string,
  request: HttpRuntimeRequest,
  sessionSecret: string | undefined,
  now?: number,
): GoogleIdentity | null {
  if (!sessionSecret) return null;

  const claims = verifyLiffToken(token, sessionSecret, now);

  if (!claims || !liffAllows(request.method, request.path, claims.ledger_id)) return null;

  return liffIdentity(claims);
}

/**
 * The gate. Returns the response that ends the request, or null to carry on
 * (not a LIFF request, or a LIFF request that is valid, in scope and live).
 *
 * Order: signature and expiry (401), scope (403), then the link still existing
 * (401). Scope is checked before the database is touched, so an out-of-scope
 * probe costs no query.
 */
export async function liffGate(
  options: { client: PostgrestClient; sessionSecret?: string; now?: number },
  request: HttpRuntimeRequest,
): Promise<HttpRuntimeResponse | null> {
  const token = liffTokenOf(request);

  if (!token) return null;

  const claims = options.sessionSecret ? verifyLiffToken(token, options.sessionSecret, options.now) : null;

  if (!claims) {
    return errorResponse(401, "UNAUTHENTICATED", "LIFF session expired.", "req_liff_session");
  }

  if (!liffAllows(request.method, request.path, claims.ledger_id)) {
    console.warn(`[liff] scope refused: ${request.method} ${loggablePath(request.path)}`);
    return errorResponse(403, "LIFF_SCOPE", "This LINE session cannot do that.", "req_liff_scope");
  }

  let live: boolean;

  try {
    live = await liffLinkIsLive(options.client, claims);
  } catch (error) {
    // Cannot tell whether the link still exists, and a token that outlives its
    // link is the one thing this check is for: refuse, but as retryable.
    console.error("[liff] link check failed, refusing request:", error instanceof Error ? error.message : "unknown");
    return errorResponse(503, "LINE_UNAVAILABLE", "Could not verify the LINE session. Try again.", "req_liff_unavailable");
  }

  if (!live) {
    return errorResponse(401, "UNAUTHENTICATED", "LIFF session expired.", "req_liff_session");
  }

  return null;
}

/**
 * GET /groups for a LIFF session lists the one ledger and nothing else - the
 * route answers for the whole account, and a LINE session is not the account.
 * Anything that is not a list of groups becomes an empty list rather than
 * passing through unfiltered.
 */
export function filterGroupsForLiff(body: unknown, ledgerId: string): unknown {
  const groups = (body as { groups?: unknown } | null)?.groups;

  if (!Array.isArray(groups)) return { groups: [] };

  return {
    ...(body as object),
    groups: groups.filter((group) => (group as { id?: unknown } | null)?.id === ledgerId),
  };
}
