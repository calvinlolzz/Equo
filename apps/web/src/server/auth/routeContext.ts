import {
  findUserAuthState,
  upsertUserByGoogleIdentity,
  type SupabaseQueryClient,
} from "../repositories/supabaseGroupRepository.js";
import { verifyGoogleIdToken, type GoogleTokenVerifier } from "./google.js";
import { requireAuthenticatedUser, type AuthResult } from "./session.js";

export type AuthContextOptions = {
  client: SupabaseQueryClient;
  verifier: GoogleTokenVerifier;
  idToken: string;
};

/**
 * The one place a request turns into an AuthenticatedContext. Every route
 * module used to carry its own byte-identical copy of this (buildRouteContext,
 * buildExpenseRouteContext, buildImageRouteContext, ...), which meant an
 * authentication rule could be tightened in one of them and silently missed in
 * the other five - exactly what happened with the admin-disabled check, which
 * only ever ran on the fresh-login path.
 *
 * Both arms of requireAuthenticatedUser are wired here:
 *  - fresh Google/Supabase token -> upsertUserByGoogleIdentity (creates the
 *    user row on first login, refreshes the profile fields after that);
 *  - Equo session token -> findUserAuthState, a primary-key read that confirms
 *    the account still exists and has not been disabled since the token was
 *    signed.
 */
export async function buildAuthContext(
  options: AuthContextOptions,
  request_id = "req_unknown",
): Promise<AuthResult> {
  const identity = await verifyGoogleIdToken(options.idToken, options.verifier);

  return requireAuthenticatedUser(
    identity,
    (googleIdentity) => upsertUserByGoogleIdentity(options.client, googleIdentity),
    request_id,
    (userId) => findUserAuthState(options.client, userId),
  );
}
