import type { ApiError } from "../../contracts/errors.js";
import type { GoogleIdentity } from "./google.js";

export type AuthenticatedContext = {
  user: {
    id: string;
    google_sub: string;
    email: string;
    display_name: string;
  };
};

export type AuthResult =
  | { ok: true; context: AuthenticatedContext }
  | { ok: false; error: ApiError };

export type UserResolver = (identity: GoogleIdentity) => Promise<AuthenticatedContext["user"] | null>;

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

  return { ok: true, context: { user } };
}
