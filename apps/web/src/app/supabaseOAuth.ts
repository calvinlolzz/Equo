export function buildAuthorizeUrl(supabaseUrl: string, redirectTo: string): string {
  const base = supabaseUrl.replace(/\/+$/, "");
  return `${base}/auth/v1/authorize?provider=google&redirect_to=${encodeURIComponent(redirectTo)}`;
}

export type OAuthFragmentResult =
  | { accessToken: string; refreshToken?: string }
  | { error: string };

/**
 * Parses a location.hash like "#access_token=...&refresh_token=...&expires_in=..."
 * (Supabase implicit OAuth flow) into its tokens, or extracts an OAuth error
 * fragment like "#error=access_denied&error_description=...".
 *
 * Returns null when the hash has neither an access_token nor an error.
 */
export function parseOAuthFragment(hash: string): OAuthFragmentResult | null {
  const trimmed = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!trimmed) return null;

  const params = new URLSearchParams(trimmed);
  const error = params.get("error");
  if (error) {
    const description = params.get("error_description") ?? error;
    return { error: description.replace(/\+/g, " ") };
  }

  const accessToken = params.get("access_token");
  if (!accessToken) return null;

  const refreshToken = params.get("refresh_token") ?? undefined;
  return refreshToken ? { accessToken, refreshToken } : { accessToken };
}
