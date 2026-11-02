import { createHmac, timingSafeEqual } from "node:crypto";
import type { GoogleIdentity } from "./google.js";

/**
 * The session a LINE ID token buys: Equo opened INSIDE LINE (LIFF), where the
 * Google sign-in cannot run (it is an embedded webview and Google refuses it).
 *
 * It is deliberately NOT a session token. Every route accepts
 * `verifySessionToken(t) ?? options.verifier(t)`, so anything that verified as
 * `equo1` would be a full session - admin routes, DELETE /me, every group.
 * This token therefore differs in three ways, each of which is enough on its own
 * to keep it out of that path:
 *
 *   1. its own prefix, `equoL1.`, which verifySessionToken rejects on the first
 *      comparison;
 *   2. its own signing key, DERIVED from the session secret with a fixed label,
 *      so even a payload re-prefixed as `equo1.` fails the session signature
 *      check, and a LIFF payload signed with the raw secret fails here;
 *   3. a `scope` claim of "liff" plus the single ledger it may touch, which
 *      http/liffGate.ts turns into an allowlist in front of the router.
 *
 * It lives for an hour, is held only in page memory by the client, and is
 * revoked the moment the LINE link it was minted from stops existing (the gate
 * re-checks that on every request - see line_liff_link_live).
 */
export const LIFF_TOKEN_VERSION = "equoL1";
export const LIFF_SESSION_TTL_MS = 60 * 60 * 1_000;

/** Domain separation label for the derived signing key. Versioned: bump with the token version. */
const KEY_LABEL = "equo-liff-session-v1";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

export type LiffClaims = {
  scope: "liff";
  auth_user_id: string;
  google_sub: string;
  email: string;
  display_name: string;
  avatar_url?: string;
  /** The user's personal ledger - the only group this token may name. */
  ledger_id: string;
  /** sha256 hex of the LINE user id the token was minted for; never the id itself. */
  line_sub_hash: string;
  iat: number;
  exp: number;
};

export type LiffTokenInput = Omit<LiffClaims, "scope" | "iat" | "exp">;

function signingKey(sessionSecret: string): Buffer {
  return createHmac("sha256", sessionSecret).update(KEY_LABEL).digest();
}

function sign(signingInput: string, sessionSecret: string): string {
  return createHmac("sha256", signingKey(sessionSecret)).update(signingInput).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length && timingSafeEqual(left, right);
}

export function isLiffTokenShape(token: string): boolean {
  return token.startsWith(`${LIFF_TOKEN_VERSION}.`);
}

export function createLiffToken(claims: LiffTokenInput, sessionSecret: string, now = Date.now()): string {
  const payload: LiffClaims = {
    scope: "liff",
    auth_user_id: claims.auth_user_id,
    google_sub: claims.google_sub,
    email: claims.email,
    display_name: claims.display_name,
    ...(claims.avatar_url ? { avatar_url: claims.avatar_url } : {}),
    ledger_id: claims.ledger_id,
    line_sub_hash: claims.line_sub_hash,
    iat: now,
    exp: now + LIFF_SESSION_TTL_MS,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

  return `${LIFF_TOKEN_VERSION}.${encodedPayload}.${sign(`${LIFF_TOKEN_VERSION}.${encodedPayload}`, sessionSecret)}`;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isLiffClaims(value: unknown): value is LiffClaims {
  if (!value || typeof value !== "object") return false;

  const claims = value as Partial<LiffClaims>;

  return (
    claims.scope === "liff" &&
    isNonEmptyString(claims.auth_user_id) &&
    typeof claims.google_sub === "string" &&
    typeof claims.email === "string" &&
    typeof claims.display_name === "string" &&
    (claims.avatar_url === undefined || typeof claims.avatar_url === "string") &&
    typeof claims.ledger_id === "string" &&
    UUID_PATTERN.test(claims.ledger_id) &&
    typeof claims.line_sub_hash === "string" &&
    SHA256_HEX_PATTERN.test(claims.line_sub_hash) &&
    typeof claims.iat === "number" &&
    Number.isFinite(claims.iat) &&
    typeof claims.exp === "number" &&
    Number.isFinite(claims.exp) &&
    // A token can never claim a longer life than the one we mint.
    claims.exp - claims.iat <= LIFF_SESSION_TTL_MS
  );
}

/**
 * The claims of a valid, unexpired LIFF token, or null for anything else -
 * including every normal session token, which has the wrong prefix.
 */
export function verifyLiffToken(token: string, sessionSecret: string, now = Date.now()): LiffClaims | null {
  if (!sessionSecret) return null;

  const parts = token.split(".");

  if (parts.length !== 3) return null;

  const [version, encodedPayload, signature] = parts;

  if (version !== LIFF_TOKEN_VERSION || !encodedPayload || !signature) return null;

  if (!safeEqual(signature, sign(`${version}.${encodedPayload}`, sessionSecret))) return null;

  try {
    const payload = JSON.parse(Buffer.from(encodedPayload, "base64url").toString("utf8")) as unknown;

    if (!isLiffClaims(payload) || payload.exp <= now) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * The identity the routes see. `resolved_user_id` takes buildAuthContext down
 * the same fast path as a session token (a primary-key read that also refuses a
 * disabled account); `scope` and `liff_ledger_id` are informational - the scope
 * is enforced before routing, not by anything reading these fields.
 */
export function liffIdentity(claims: LiffClaims): GoogleIdentity {
  return {
    auth_user_id: claims.auth_user_id,
    google_sub: claims.google_sub,
    email: claims.email,
    display_name: claims.display_name,
    avatar_url: claims.avatar_url,
    resolved_user_id: claims.auth_user_id,
    scope: "liff",
    liff_ledger_id: claims.ledger_id,
  };
}
