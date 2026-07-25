import { createHmac, timingSafeEqual } from "node:crypto";
import type { GoogleIdentity } from "./google.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

type SessionPayload = {
  auth_user_id: string;
  google_sub: string;
  email: string;
  display_name: string;
  avatar_url?: string;
  iat: number;
  exp: number;
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
export function clearSessionCookie(): string {
  return "equo_session=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0";
}
