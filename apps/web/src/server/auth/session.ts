import type { ApiError } from "../../contracts/errors.js";
import type { GoogleIdentity } from "./google.js";

export type AuthenticatedContext = {
  user: {
    id: string;
    google_sub: string;
    email: string;
    display_name: string;
    avatar_url?: string | null;
  };
};

export type AuthResult =
  | { ok: true; context: AuthenticatedContext }
  | { ok: false; error: ApiError };

export type UserResolver = (
  identity: GoogleIdentity,
) => Promise<(AuthenticatedContext["user"] & { deleted_at?: string | null }) | null>;

export async function requireAuthenticatedUser(
  identity: GoogleIdentity | null,
  resolveUser: UserResolver,
  request_id = "req_unknown",
): Promise<AuthResult> {
  if (!identity) {
    return {
      ok: false,
      error: {
        error: {
          code: "UNAUTHENTICATED",
          message: "Please sign in with Google.",
          request_id,
        },
      },
    };
  }

  // Fast path: an identity decoded from an already-verified Equo session
  // token carries a resolved DB user id directly (see GoogleIdentity's
  // resolved_user_id doc), so every authenticated request made with a
  // session token can skip resolveUser's upsertUserByGoogleIdentity DB
  // round-trip entirely. Google-ID-token / Supabase-token identities (fresh
  // logins, no resolved_user_id) still go through resolveUser as before, and
  // any session token signed before this field existed simply omits it and
  // falls back to the same path automatically.
  if (identity.resolved_user_id) {
    return {
      ok: true,
      context: {
        user: {
          id: identity.resolved_user_id,
          google_sub: identity.google_sub,
          email: identity.email,
          display_name: identity.display_name,
          avatar_url: identity.avatar_url,
        },
      },
    };
  }

  const user = await resolveUser(identity);

  if (!user) {
    return {
      ok: false,
      error: {
        error: {
          code: "UNAUTHENTICATED",
          message: "User profile could not be resolved.",
          request_id,
        },
      },
    };
  }

  // Admin-disabled account (users.deleted_at set). Only fresh-token requests
  // pass through here; a pre-existing session token rides the fast path above
  // until it expires, so disabling takes effect on next login at the latest.
  if (user.deleted_at) {
    return {
      ok: false,
      error: {
        error: {
          code: "ACCOUNT_DISABLED",
          message: "此帳號已被停用。",
          request_id,
        },
      },
    };
  }

  const { deleted_at: _deletedAt, ...sessionUser } = user;
  return { ok: true, context: { user: sessionUser } };
}
