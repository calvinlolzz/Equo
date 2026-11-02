import type { PostgrestClient } from "../db/postgrestClient.js";
import type { ErrorCode } from "../../contracts/errors.js";
import { LOCALES, type Locale } from "../../app/i18n/locale.js";
import { createLiffToken, LIFF_SESSION_TTL_MS } from "../auth/liffToken.js";
import { lineUserTag, redactForLog, sha256Hex } from "../line/lineCrypto.js";
import type { LineIdTokenResult } from "../line/lineIdToken.js";
import { lineLiffIdentity } from "../line/lineRepository.js";

/**
 * The two routes behind opening Equo inside LINE (LIFF):
 *
 *   GET  /api/v1/line/liff   which LIFF app this deployment serves (or none)
 *   POST /api/v1/auth/line   a LINE ID token -> an hour-long, personal-ledger-only token
 *
 * The exchange is the only door to a LIFF token and it is narrow on purpose:
 *   - the credential is a LINE ID token, verified through LINE (line/lineIdToken.ts);
 *   - the user is whoever that LINE account is LINKED to (line_accounts), found in
 *     SQL from the verified `sub` - nothing in the request names a user or a ledger;
 *   - the token goes back in the BODY, with no-store and NO Set-Cookie. A cookie
 *     would land in whichever browser opened the LIFF URL (a desktop one, if the
 *     link is opened from LINE PC or pasted) and shadow that browser's real
 *     session; the page keeps this token in memory only.
 *
 * Logs: the ID token, the issued token, `sub` and the user id are never logged.
 * The one diagnostic is a short hash tag of `sub` on not_linked, comparable with
 * the webhook's tag for the same person - if they differ, the LINE Login channel
 * sits in a different provider than the Messaging API channel.
 */

type RouteResult = {
  ok: boolean;
  status: number;
  headers: Record<string, string>;
  body: unknown;
};

const NO_STORE = { "cache-control": "no-store" } as const;

/** A JWT: three base64url parts. The size cap keeps a junk megabyte from ever reaching LINE. */
const ID_TOKEN_PATTERN = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const MAX_ID_TOKEN_LENGTH = 4_096;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Per verified LINE account, on top of the per-IP rule: 30 exchanges in 10 minutes. */
const SUB_LIMIT = 30;
const SUB_WINDOW_SECONDS = 600;

function failure(status: number, code: ErrorCode, message: string, extraHeaders: Record<string, string> = {}): RouteResult {
  return {
    ok: false,
    status,
    headers: { ...NO_STORE, ...extraHeaders },
    body: { error: { code, message, request_id: "req_auth_line" } },
  };
}

export type AuthLineOptions = {
  client: PostgrestClient;
  sessionSecret: string;
  verifyIdToken: (idToken: string) => Promise<LineIdTokenResult>;
  now?: number;
};

/**
 * POST /api/v1/auth/line {id_token}.
 *
 * 200 {session: {token, expires_at, user, ledger_id, locale}}
 * 400 MALFORMED_REQUEST      no id_token string
 * 401 LINE_ID_TOKEN_INVALID  not a JWT, or LINE/our checks refused it
 * 401 LINE_ID_TOKEN_EXPIRED  LINE says it has expired (the client logs in again, once)
 * 403 LINE_NOT_LINKED        a valid LINE account that is not linked to an Equo account
 * 403 ACCOUNT_DISABLED       linked, but the Equo account is disabled
 * 409 NO_LEDGER              linked, but there is no personal ledger to open
 * 429 RATE_LIMITED           too many exchanges for this LINE account
 * 503 LINE_UNAVAILABLE       LINE (or our database) could not be reached
 */
export async function authLineRoute(options: AuthLineOptions, body: { id_token?: unknown } | null | undefined): Promise<RouteResult> {
  const idToken = body?.id_token;

  if (typeof idToken !== "string" || idToken.length === 0) {
    return {
      ok: false,
      status: 400,
      headers: { ...NO_STORE },
      body: { issues: [{ code: "MALFORMED_REQUEST", message: "id_token is required." }] },
    };
  }

  if (idToken.length > MAX_ID_TOKEN_LENGTH || !ID_TOKEN_PATTERN.test(idToken)) {
    return failure(401, "LINE_ID_TOKEN_INVALID", "LINE ID token is invalid.");
  }

  const verified = await options.verifyIdToken(idToken);

  if (verified.ok === false) {
    if (verified.reason === "expired") {
      return failure(401, "LINE_ID_TOKEN_EXPIRED", "LINE ID token has expired.");
    }

    if (verified.reason === "unavailable") {
      return failure(503, "LINE_UNAVAILABLE", "LINE could not be reached. Try again shortly.");
    }

    return failure(401, "LINE_ID_TOKEN_INVALID", "LINE ID token is invalid.");
  }

  const sub = verified.claims.sub;
  const subHash = sha256Hex(sub);

  // Fails OPEN, like every limiter here: a counter outage must not lock LINE
  // users out of their own ledger. The per-IP rule in front of this is the
  // other half.
  try {
    const limit = await options.client.rpc<{ allowed?: boolean; retry_after?: number }>("consume_rate_limit", {
      p_bucket: `lineAuth:s:${subHash.slice(0, 16)}`,
      p_limit: SUB_LIMIT,
      p_window_seconds: SUB_WINDOW_SECONDS,
    });

    if (limit?.allowed === false) {
      const retryAfter = Math.max(1, Math.ceil(limit.retry_after ?? SUB_WINDOW_SECONDS));
      return failure(429, "RATE_LIMITED", "Too many requests. Try again shortly.", { "retry-after": String(retryAfter) });
    }
  } catch (error) {
    console.error("[liff] per-account limit could not be counted, allowing request:", redactForLog(String(error instanceof Error ? error.message : "unknown")));
  }

  let identity: Awaited<ReturnType<typeof lineLiffIdentity>>;

  try {
    identity = await lineLiffIdentity(options.client, sub);
  } catch (error) {
    console.error(`[liff] identity lookup failed: ${redactForLog(String(error instanceof Error ? error.message : "unknown"))}`);
    return failure(503, "LINE_UNAVAILABLE", "Could not sign in with LINE. Try again shortly.");
  }

  if (typeof identity !== "object" || identity === null) {
    console.error("[liff] identity lookup returned an unexpected shape");
    return failure(503, "LINE_UNAVAILABLE", "Could not sign in with LINE. Try again shortly.");
  }

  if (identity.ok === false) {
    if (identity.reason === "account_disabled") {
      return failure(403, "ACCOUNT_DISABLED", "此帳號已被停用。");
    }

    if (identity.reason === "no_ledger") {
      return failure(409, "NO_LEDGER", "No personal ledger to open.");
    }

    // The provider-mismatch diagnostic: compare this tag with the webhook's for the same person.
    console.warn(`[liff] exchange not_linked (${lineUserTag(sub)})`);
    return failure(403, "LINE_NOT_LINKED", "This LINE account is not linked to an Equo account.");
  }

  const { user, ledger_id: ledgerId, locale } = identity;

  // Only a literal ok:true signs anything; a row that merely has the right fields does not.
  if ((identity as { ok?: unknown }).ok !== true) {
    console.error("[liff] identity lookup returned an unexpected shape");
    return failure(503, "LINE_UNAVAILABLE", "Could not sign in with LINE. Try again shortly.");
  }

  // Anything the database returns that is not the shape the token is built from
  // is a fault, not something to sign.
  if (
    typeof user?.id !== "string" ||
    !user.id ||
    typeof user.google_sub !== "string" ||
    typeof user.email !== "string" ||
    typeof user.display_name !== "string" ||
    typeof ledgerId !== "string" ||
    !UUID_PATTERN.test(ledgerId) ||
    !(LOCALES as readonly string[]).includes(locale)
  ) {
    console.error("[liff] identity lookup returned an unexpected shape");
    return failure(503, "LINE_UNAVAILABLE", "Could not sign in with LINE. Try again shortly.");
  }

  const now = options.now ?? Date.now();
  const token = createLiffToken(
    {
      auth_user_id: user.id,
      google_sub: user.google_sub,
      email: user.email,
      display_name: user.display_name,
      ...(user.avatar_url ? { avatar_url: user.avatar_url } : {}),
      ledger_id: ledgerId,
      line_sub_hash: subHash,
    },
    options.sessionSecret,
    now,
  );

  return {
    ok: true,
    status: 200,
    // No Set-Cookie, deliberately - see the file comment.
    headers: { ...NO_STORE },
    body: {
      session: {
        token,
        expires_at: new Date(now + LIFF_SESSION_TTL_MS).toISOString(),
        user,
        ledger_id: ledgerId,
        locale: locale as Locale,
      },
    },
  };
}

/**
 * GET /api/v1/line/liff - which LIFF app this deployment serves, or null.
 * Public and unauthenticated: the LIFF ID is not a secret (it is in the LIFF
 * URL), and the page needs it before it has any credential at all. null is the
 * kill switch's visible side: unset LINE_LIFF_ID and every LIFF page degrades to
 * "open in your browser".
 */
export function liffConfigRoute(liffId: string | null) {
  return {
    ok: true as const,
    status: 200 as const,
    headers: { ...NO_STORE },
    body: { liff_id: liffId },
  };
}
