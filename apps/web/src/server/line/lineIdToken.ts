/**
 * Verifying a LINE Login ID token, the credential a LIFF page can produce.
 *
 * LINE does the cryptography: POST the token and our channel id to its verify
 * endpoint and it answers with the claims, or an error. Only the channel ID is
 * sent - the channel SECRET is not involved anywhere in this flow and must never
 * be added to it (https://developers.line.biz/en/reference/line-login/#verify-id-token).
 *
 * LINE's answer is not taken on faith, though. `iss`, `aud`, `exp` and the `sub`
 * format are checked here as well: a token minted for a DIFFERENT channel (any
 * other LIFF app, any other LINE Login product) would otherwise be a way to
 * become one of our users, and "the verify endpoint said 200" is exactly one
 * configuration mistake away from not meaning that.
 *
 * Never logs the token, the claims or `sub`: a LINE user id is a stable
 * per-provider identifier, and an ID token is a bearer credential until `exp`.
 */

export type LineIdTokenClaims = {
  iss: string;
  sub: string;
  aud: string;
  exp: number;
  iat: number;
};

export type LineIdTokenResult =
  | { ok: true; claims: LineIdTokenClaims }
  | { ok: false; reason: "expired" | "invalid" | "unavailable" };

export const LINE_VERIFY_URL = "https://api.line.me/oauth2/v2.1/verify";
export const LINE_ID_TOKEN_ISSUER = "https://access.line.me";

/** The shape of a LINE user id, and of the webhook's source.userId (line_accounts.line_user_id's CHECK). */
export const LINE_USER_ID_PATTERN = /^U[0-9a-f]{32}$/;

const DEFAULT_TIMEOUT_MS = 5_000;

type VerifierOptions = {
  /** The LINE Login channel's numeric id, the `client_id` LINE checks `aud` against. */
  channelId: string;
  fetcher?: typeof fetch;
  timeoutMs?: number;
  now?: () => number;
};

/**
 * The claims an ID token CLAIMS, read without checking the signature. Used
 * only to turn away tokens that cannot be ours before LINE is asked - never to
 * accept one: every accepted token still goes through LINE's verify and the
 * checks after it. Null when the token is not a JWT with a JSON-object payload.
 */
function peekPayload(idToken: string): Record<string, unknown> | null {
  const parts = idToken.split(".");

  if (parts.length !== 3 || !parts[1]) return null;

  try {
    const decoded: unknown = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));

    return isRecord(decoded) ? decoded : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function createLineIdTokenVerifier(options: VerifierOptions): (idToken: string) => Promise<LineIdTokenResult> {
  const fetcher = options.fetcher ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const now = options.now ?? Date.now;

  return async function verifyLineIdToken(idToken) {
    // Before any outbound call: junk that merely looks like a JWT, a token for
    // another channel or issuer, and an expired one are refused here, so a flood
    // of them from many addresses cannot make us hammer LINE's verify endpoint
    // (and get this server throttled into 503s for real users). The same
    // checks run again on LINE's answer below.
    const claimed = peekPayload(idToken);

    if (!claimed) return { ok: false, reason: "invalid" };
    if (claimed.iss !== LINE_ID_TOKEN_ISSUER || claimed.aud !== options.channelId) return { ok: false, reason: "invalid" };
    if (typeof claimed.exp !== "number" || !Number.isFinite(claimed.exp)) return { ok: false, reason: "invalid" };
    if (claimed.exp * 1_000 <= now()) return { ok: false, reason: "expired" };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    let response: Response;
    let payload: unknown;

    try {
      response = await fetcher(LINE_VERIFY_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ id_token: idToken, client_id: options.channelId }).toString(),
        signal: controller.signal,
        // LINE answers this endpoint directly. A redirect would carry the token
        // (and our channel id) to wherever it points: refuse to follow one.
        redirect: "error",
      });
      // Still under the timeout: a response whose body never arrives is as dead as one that never started.
      payload = await response.json().catch(() => null);
    } catch {
      // Timeout, DNS, TLS, reset: LINE could not be asked, which says nothing about the token.
      return { ok: false, reason: "unavailable" };
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // 429 and 5xx are LINE (or the path to it) failing, not the token.
      if (response.status >= 500 || response.status === 429) {
        return { ok: false, reason: "unavailable" };
      }

      const description = isRecord(payload) ? payload.error_description : undefined;

      return { ok: false, reason: description === "IdToken expired." ? "expired" : "invalid" };
    }

    if (!isRecord(payload)) {
      // A 2xx we cannot read is LINE misbehaving, not proof the token is bad.
      return { ok: false, reason: "unavailable" };
    }

    const { iss, sub, aud, exp, iat } = payload;

    if (typeof exp !== "number" || !Number.isFinite(exp)) return { ok: false, reason: "invalid" };
    if (iss !== LINE_ID_TOKEN_ISSUER) return { ok: false, reason: "invalid" };
    if (typeof aud !== "string" || aud !== options.channelId) return { ok: false, reason: "invalid" };
    if (typeof sub !== "string" || !LINE_USER_ID_PATTERN.test(sub)) return { ok: false, reason: "invalid" };
    if (typeof iat !== "number" || !Number.isFinite(iat)) return { ok: false, reason: "invalid" };
    // `exp` is in seconds. Checked here too: LINE has just said yes, but a
    // clock or caching quirk between us must not extend a credential's life.
    if (exp * 1_000 <= now()) return { ok: false, reason: "expired" };

    return { ok: true, claims: { iss, sub, aud, exp, iat } };
  };
}
