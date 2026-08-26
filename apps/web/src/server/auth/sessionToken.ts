import { createHmac, timingSafeEqual } from "node:crypto";
import type { GoogleIdentity } from "./google.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

/**
 * How long an admin may look at the app as one user before it lapses.
 *
 * Minutes, not days, and deliberately far below SESSION_TTL_MS: this is for
 * reproducing "my balance is wrong" while somebody is on the phone, not a mode
 * anybody works in. A forgotten tab stops being a live window into a stranger's
 * ledger a quarter of an hour later, without needing anyone to remember.
 */
export const VIEW_AS_TTL_MS = 15 * 60 * 1_000;

type SessionPayload = {
  auth_user_id: string;
  google_sub: string;
  email: string;
  display_name: string;
  avatar_url?: string;
  iat: number;
  exp: number;
  /**
   * Present only on a view-as token: the admin who opened it.
   *
   * Its presence is what makes a token read-only, so it is not decoration -
   * see the write gate in http/viewAs.ts. It is signed along with everything
   * else, so a caller cannot remove it to get writes back, and cannot add it
   * to their own session to pretend they are somebody else.
   */
  view_as_by?: string;
};

function base64UrlEncode(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function base64UrlDecode(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);

  return left.length === right.length && timingSafeEqual(left, right);
}

function isSessionPayload(value: unknown): value is SessionPayload {
  if (!value || typeof value !== "object") {
    return false;
  }

  const payload = value as Partial<SessionPayload>;
  return (
    typeof payload.auth_user_id === "string" &&
    typeof payload.google_sub === "string" &&
    typeof payload.email === "string" &&
    typeof payload.display_name === "string" &&
    typeof payload.iat === "number" &&
    typeof payload.exp === "number"
  );
}

export function createSessionToken(identity: GoogleIdentity, secret: string, now = Date.now()): string {
  const payload: SessionPayload = {
    auth_user_id: identity.auth_user_id,
    google_sub: identity.google_sub,
    email: identity.email,
    display_name: identity.display_name,
    avatar_url: identity.avatar_url,
    iat: now,
    exp: now + SESSION_TTL_MS,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(encodedPayload, secret);

  return `equo1.${encodedPayload}.${signature}`;
}

/**
 * A token that reads the app as `identity`, opened by `adminUserId`.
 *
 * Same signature scheme and the same shape as a real session, which is the
 * point: every read path already resolves the caller from this payload, so
 * looking through somebody's eyes needs no changes to any of them. What it must
 * NOT do is grant writes, and that is enforced centrally rather than route by
 * route (see http/viewAs.ts).
 */
export function createViewAsToken(
  identity: GoogleIdentity,
  adminUserId: string,
  secret: string,
  now = Date.now(),
): string {
  const payload: SessionPayload = {
    auth_user_id: identity.auth_user_id,
    google_sub: identity.google_sub,
    email: identity.email,
    display_name: identity.display_name,
    avatar_url: identity.avatar_url,
    iat: now,
    exp: now + VIEW_AS_TTL_MS,
    view_as_by: adminUserId,
  };
  const encodedPayload = base64UrlEncode(JSON.stringify(payload));

  return `equo1.${encodedPayload}.${signPayload(encodedPayload, secret)}`;
}

/**
 * The admin behind a view-as token, or null for an ordinary session.
 *
 * Verifies the signature before reading the claim - an unsigned or tampered
 * token returns null, which the caller treats as "not view-as" and therefore
 * writable. That is safe only because such a token also fails
 * verifySessionToken and is not authenticated at all.
 */
export function viewAsAdminId(token: string, secret: string, now = Date.now()): string | null {
  const [version, encodedPayload, signature] = token.split(".");

  if (version !== "equo1" || !encodedPayload || !signature) return null;
  if (!safeEqual(signature, signPayload(encodedPayload, secret))) return null;

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as unknown;
    if (!isSessionPayload(payload) || payload.exp <= now) return null;
    return typeof payload.view_as_by === "string" ? payload.view_as_by : null;
  } catch {
    return null;
  }
}

export function verifySessionToken(token: string, secret: string, now = Date.now()): GoogleIdentity | null {
  const [version, encodedPayload, signature] = token.split(".");

  if (version !== "equo1" || !encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = signPayload(encodedPayload, secret);

  if (!safeEqual(signature, expectedSignature)) {
    return null;
  }

  try {
    const payload = JSON.parse(base64UrlDecode(encodedPayload)) as unknown;

    if (!isSessionPayload(payload) || payload.exp <= now) {
      return null;
    }

    return {
      auth_user_id: payload.auth_user_id,
      google_sub: payload.google_sub,
      email: payload.email,
      display_name: payload.display_name,
      avatar_url: payload.avatar_url,
      // A verified equo1 session token always encodes an already-resolved
      // user (see createSessionToken's callers in authRoutes.ts, which only
      // ever sign a token after upsertUserByGoogleIdentity succeeds) - mark
      // it so route context builders can skip the redundant upsert.
      resolved_user_id: payload.auth_user_id,
    };
  } catch {
    return null;
  }
}

export function createSessionCookie(token: string, now = Date.now()): string {
  const maxAgeSeconds = Math.floor((now + SESSION_TTL_MS - now) / 1_000);
  return `equo_session=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSeconds}`;
}

export function sessionExpiresAt(now = Date.now()): string {
  return new Date(now + SESSION_TTL_MS).toISOString();
}

/**
 * An immediately-expiring equo_session cookie, for the server to send when a
 * session must end server-side — currently account deletion. Same attributes
 * as createSessionCookie so the browser overwrites the live cookie rather than
 * setting a second one; Max-Age=0 clears it.
 */
export function createViewAsCookie(token: string): string {
  // Its own cookie, never equo_session. Overwriting the admin's real session
  // would sign them out of their own account the moment they stopped looking,
  // and a mistake in clearing it would strand them as somebody else.
  return `equo_view_as=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${Math.floor(VIEW_AS_TTL_MS / 1_000)}`;
}

export function clearViewAsCookie(): string {
  return "equo_view_as=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}

export function clearSessionCookie(): string {
  return "equo_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}
