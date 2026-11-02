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
  /**
   * Set only on an identity decoded from a LIFF token (auth/liffToken.ts), i.e.
   * a LINE-in-app session limited to one personal ledger. Informational: no
   * route reads it, and none may rely on it for access control - the scope is
   * enforced in front of the router (http/liffGate.ts) and again by the
   * verifier, so a route that forgets about it still cannot be reached.
   */
  scope?: "liff";
  /** The one ledger a LIFF identity may touch. Present exactly when scope is "liff". */
  liff_ledger_id?: string;
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
