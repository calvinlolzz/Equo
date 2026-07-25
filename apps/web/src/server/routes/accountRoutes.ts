import type { PostgrestClient } from "../db/postgrestClient.js";
import type { GoogleTokenVerifier } from "../auth/google.js";
import { buildAuthContext } from "../auth/routeContext.js";
import { clearSessionCookie } from "../auth/sessionToken.js";
import { deleteMyAccount } from "../repositories/supabaseGroupRepository.js";

type RouteOptions = {
  client: PostgrestClient;
  verifier: GoogleTokenVerifier;
  idToken: string;
};

/**
 * DELETE /api/v1/me — self-service account deletion.
 *
 * Self-scoped: the account erased is always the authenticated caller's own
 * (auth.context.user.id), never an id from the request, so there is nothing to
 * authorise beyond being signed in. The heavy lifting — detaching the person
 * from shared groups, reassigning owned ones, erasing the identity — is one
 * transactional RPC (see delete_my_account).
 *
 * On success it also clears the equo_session cookie: the account is gone, so
 * the still-valid 7-day session token must stop working immediately rather than
 * lingering as a credential for a user that no longer exists (the next request
 * would 401 anyway once the row is gone, but leaving the cookie set is untidy
 * and confusing).
 */
export async function deleteMyAccountRoute(options: RouteOptions) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false as const, status: 401, body: auth.error };
  }

  const result = await deleteMyAccount(options.client, auth.context.user.id);

  if (result.ok === false) {
    // The only refusal the RPC returns: the caller is the last admin-console
    // owner. Everything else either succeeds or throws (→ 500 via the runtime).
    return {
      ok: false as const,
      status: 409,
      body: {
        error: {
          code: "ACCOUNT_DELETE_BLOCKED",
          message: "You are the last admin console owner; transfer ownership before deleting your account.",
          request_id: "req_account_delete",
        },
      },
    };
  }

  return {
    ok: true as const,
    status: 200,
    headers: { "set-cookie": clearSessionCookie() },
    body: { ok: true },
  };
}
