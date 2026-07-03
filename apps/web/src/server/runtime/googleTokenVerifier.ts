import type { GoogleIdentity, GoogleTokenVerifier } from "../auth/google.js";

type GoogleTokenInfo = {
  sub?: string;
  aud?: string;
  email?: string;
  email_verified?: string | boolean;
  name?: string;
  picture?: string;
};

type FetchLike = (url: string) => Promise<{
  ok: boolean;
  json(): Promise<GoogleTokenInfo>;
}>;

function isEmailVerified(value: GoogleTokenInfo["email_verified"]): boolean {
  return value === true || value === "true";
}

export function createGoogleTokenVerifier(
  clientId: string,
  fetchImpl: FetchLike = fetch,
): GoogleTokenVerifier {
  // Google-only MVP: verify the ID token against Google's tokeninfo endpoint before mapping identity.
  return async function verifyGoogleToken(idToken: string): Promise<GoogleIdentity | null> {
    if (!idToken.trim()) {
      return null;
    }

    const response = await fetchImpl(
      `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
    );

    if (!response.ok) {
      return null;
    }

    const tokenInfo = await response.json();

    if (tokenInfo.aud !== clientId || !tokenInfo.sub || !tokenInfo.email || !isEmailVerified(tokenInfo.email_verified)) {
      return null;
    }

    return {
      auth_user_id: tokenInfo.sub,
      google_sub: tokenInfo.sub,
      email: tokenInfo.email,
      display_name: tokenInfo.name ?? tokenInfo.email,
      avatar_url: tokenInfo.picture,
    };
  };
}
