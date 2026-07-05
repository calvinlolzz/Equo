export type GoogleIdentity = {
  auth_user_id: string;
  google_sub: string;
  email: string;
  display_name: string;
  avatar_url?: string;
  /**
   * Set only when this identity was decoded from an already-verified Equo
   * session token (see sessionToken.ts's verifySessionToken), never for a
   * freshly-exchanged Google/Supabase token. A session token is signed by us
   * after the user row was already resolved/created, so auth_user_id here is
   * guaranteed to be a real public.users.id - callers can build
   * AuthenticatedContext straight from this identity and skip the
   * upsertUserByGoogleIdentity DB round-trip that a fresh login still needs.
   */
  resolved_user_id?: string;
};

export type GoogleTokenVerifier = (idToken: string) => Promise<GoogleIdentity | null>;

export async function verifyGoogleIdToken(
  idToken: string,
  verifier: GoogleTokenVerifier,
): Promise<GoogleIdentity | null> {
  // Google-only MVP: keep provider parsing isolated so the rest of the API never accepts email magic links.
  if (!idToken.trim()) {
    return null;
  }

  return verifier(idToken);
}
