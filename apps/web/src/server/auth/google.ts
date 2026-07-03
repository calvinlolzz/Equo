export type GoogleIdentity = {
  auth_user_id: string;
  google_sub: string;
  email: string;
  display_name: string;
  avatar_url?: string;
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
