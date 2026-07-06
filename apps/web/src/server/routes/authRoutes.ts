import type { GoogleTokenVerifier } from "../auth/google.js";
import { verifyGoogleIdToken } from "../auth/google.js";
import { createSessionCookie, createSessionToken, sessionExpiresAt } from "../auth/sessionToken.js";
import {
  type SupabaseQueryClient,
  upsertUserByGoogleIdentity,
} from "../repositories/supabaseGroupRepository.js";

type AuthGoogleRequest = {
  id_token?: string;
};

type AuthSupabaseRequest = {
  access_token?: string;
};

type AuthRouteOptions = {
  client: SupabaseQueryClient;
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
      status: 401;
      headers: Record<string, string>;
      body: {
        error: {
          code: "UNAUTHENTICATED";
          message: string;
          request_id: string;
        };
      };
    };

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

  const user = await upsertUserByGoogleIdentity(options.client, identity);
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

  const user = await upsertUserByGoogleIdentity(options.client, identity);
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
