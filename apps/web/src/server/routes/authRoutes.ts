import type { PostgrestClient } from "../db/postgrestClient.js";
import type { GoogleTokenVerifier } from "../auth/google.js";
import { verifyGoogleIdToken } from "../auth/google.js";
import { createSessionCookie, createSessionToken, sessionExpiresAt } from "../auth/sessionToken.js";
import {
  upsertUserByGoogleIdentity,
} from "../repositories/supabaseGroupRepository.js";

type AuthGoogleRequest = {
  id_token?: string;
};

type AuthSupabaseRequest = {
  access_token?: string;
};

type AuthRouteOptions = {
  client: PostgrestClient;
  verifier: GoogleTokenVerifier;
  sessionSecret: string;
  now?: number;
};

type AuthGoogleRouteResult =
  | {
      ok: true;
      status: 200;
      headers: Record<string, string>;
      body: {
        session: {
          token: string;
          expires_at: string;
          user: { id: string; google_sub: string; email: string; display_name: string; avatar_url?: string | null };
        };
      };
    }
  | {
      ok: false;
      status: 401 | 403;
      headers: Record<string, string>;
      body: {
        error: {
          code: "UNAUTHENTICATED" | "ACCOUNT_DISABLED";
          message: string;
          request_id: string;
        };
      };
    };

/**
 * Shared refusal for admin-disabled accounts (users.deleted_at set): no
 * session token is issued, so the block takes effect at the next login even
 * though the upsert has already refreshed the profile fields.
 */
function accountDisabledResult(request_id: string): AuthGoogleRouteResult {
  return {
    ok: false,
    status: 403,
    headers: {},
    body: {
      error: {
        code: "ACCOUNT_DISABLED",
        message: "此帳號已被停用。",
        request_id,
      },
    },
  };
}

export async function authGoogleRoute(
  options: AuthRouteOptions,
  request: AuthGoogleRequest,
): Promise<AuthGoogleRouteResult> {
  const identity = await verifyGoogleIdToken(request.id_token ?? "", options.verifier);

  if (!identity) {
    return {
      ok: false,
      status: 401,
      headers: {},
      body: {
        error: {
          code: "UNAUTHENTICATED",
          message: "Google ID token is invalid.",
          request_id: "req_auth_google",
        },
      },
    };
  }

  const { deleted_at, ...user } = await upsertUserByGoogleIdentity(options.client, identity);

  if (deleted_at) {
    return accountDisabledResult("req_auth_google");
  }

  const sessionIdentity = {
    auth_user_id: user.id,
    google_sub: user.google_sub,
    email: user.email,
    display_name: user.display_name,
    avatar_url: identity.avatar_url,
  };
  const now = options.now ?? Date.now();
  const token = createSessionToken(sessionIdentity, options.sessionSecret, now);

  return {
    ok: true,
    status: 200,
    headers: {
      "set-cookie": createSessionCookie(token, now),
    },
    body: {
      session: {
        token,
        expires_at: sessionExpiresAt(now),
        user,
      },
    },
  };
}

export async function authSupabaseRoute(
  options: AuthRouteOptions,
  request: AuthSupabaseRequest,
): Promise<AuthGoogleRouteResult> {
  const identity = await options.verifier(request.access_token ?? "");

  if (!identity) {
    return {
      ok: false,
      status: 401,
      headers: {},
      body: {
        error: {
          code: "UNAUTHENTICATED",
          message: "Supabase access token is invalid.",
          request_id: "req_auth_supabase",
        },
      },
    };
  }

  const { deleted_at, ...user } = await upsertUserByGoogleIdentity(options.client, identity);

  if (deleted_at) {
    return accountDisabledResult("req_auth_supabase");
  }

  const sessionIdentity = {
    auth_user_id: user.id,
    google_sub: user.google_sub,
    email: user.email,
    display_name: user.display_name,
    avatar_url: identity.avatar_url,
  };
  const now = options.now ?? Date.now();
  const token = createSessionToken(sessionIdentity, options.sessionSecret, now);

  return {
    ok: true,
    status: 200,
    headers: {
      "set-cookie": createSessionCookie(token, now),
    },
    body: {
      session: {
        token,
        expires_at: sessionExpiresAt(now),
        user,
      },
    },
  };
}
