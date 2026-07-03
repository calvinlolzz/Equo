import type { GoogleIdentity } from "../auth/google.js";

type SupabaseUserResponse = {
  id: string;
  email?: string;
  user_metadata?: {
    avatar_url?: string;
    email?: string;
    full_name?: string;
    name?: string;
    picture?: string;
    sub?: string;
  };
  identities?: Array<{
    provider?: string;
    identity_data?: {
      avatar_url?: string;
      email?: string;
      full_name?: string;
      name?: string;
      picture?: string;
      sub?: string;
    };
  }>;
};

function pickIdentityData(user: SupabaseUserResponse) {
  return user.identities?.find((identity) => identity.provider === "google")?.identity_data ?? user.user_metadata ?? {};
}

export function createSupabaseAccessTokenVerifier(url: string, apiKey: string, fetcher: typeof fetch = fetch) {
  return async function verifySupabaseAccessToken(accessToken: string): Promise<GoogleIdentity | null> {
    const token = accessToken.trim();

    if (!token) {
      return null;
    }

    const response = await fetcher(`${url.replace(/\/$/, "")}/auth/v1/user`, {
      headers: {
        apikey: apiKey,
        authorization: `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const user = (await response.json()) as SupabaseUserResponse;
    const identityData = pickIdentityData(user);
    const email = user.email ?? identityData.email;

    if (!email) {
      return null;
    }

    return {
      auth_user_id: user.id,
      google_sub: identityData.sub ?? user.id,
      email,
      display_name: identityData.full_name ?? identityData.name ?? email,
      avatar_url: identityData.avatar_url ?? identityData.picture,
    };
  };
}
