import { describe, expect, test } from "vitest";
import { buildAuthorizeUrl, parseOAuthFragment } from "./supabaseOAuth";

describe("buildAuthorizeUrl", () => {
  test("builds the Supabase Google authorize URL with an encoded redirect_to", () => {
    const url = buildAuthorizeUrl("https://cmfgptuzbayzdrxuoapm.supabase.co", "https://equo-mu.vercel.app");
    expect(url).toBe(
      "https://cmfgptuzbayzdrxuoapm.supabase.co/auth/v1/authorize?provider=google&redirect_to=https%3A%2F%2Fequo-mu.vercel.app",
    );
  });

  test("strips a trailing slash from the supabase URL", () => {
    const url = buildAuthorizeUrl("https://cmfgptuzbayzdrxuoapm.supabase.co/", "http://localhost:14100");
    expect(url).toBe(
      "https://cmfgptuzbayzdrxuoapm.supabase.co/auth/v1/authorize?provider=google&redirect_to=http%3A%2F%2Flocalhost%3A14100",
    );
  });

  test("encodes query characters in the redirect target", () => {
    const url = buildAuthorizeUrl("https://example.supabase.co", "https://equo-mu.vercel.app/?invite=abc&x=1");
    expect(url).toContain(encodeURIComponent("https://equo-mu.vercel.app/?invite=abc&x=1"));
  });
});

describe("parseOAuthFragment", () => {
  test("returns null for an empty hash", () => {
    expect(parseOAuthFragment("")).toBeNull();
    expect(parseOAuthFragment("#")).toBeNull();
  });

  test("returns null when there is no access_token or error", () => {
    expect(parseOAuthFragment("#foo=bar")).toBeNull();
  });

  test("extracts access_token and refresh_token", () => {
    const result = parseOAuthFragment("#access_token=abc123&refresh_token=def456&expires_in=3600&token_type=bearer");
    expect(result).toEqual({ accessToken: "abc123", refreshToken: "def456" });
  });

  test("extracts access_token without a refresh_token", () => {
    const result = parseOAuthFragment("#access_token=abc123&expires_in=3600");
    expect(result).toEqual({ accessToken: "abc123" });
  });

  test("works without a leading #", () => {
    const result = parseOAuthFragment("access_token=abc123");
    expect(result).toEqual({ accessToken: "abc123" });
  });

  test("extracts an OAuth error fragment", () => {
    const result = parseOAuthFragment("#error=access_denied&error_description=User+denied+access");
    expect(result).toEqual({ error: "User denied access" });
  });

  test("falls back to the error code when no description is present", () => {
    const result = parseOAuthFragment("#error=server_error");
    expect(result).toEqual({ error: "server_error" });
  });

  test("prefers the error branch over any access_token present", () => {
    const result = parseOAuthFragment("#error=access_denied&access_token=should-not-be-used");
    expect(result).toEqual({ error: "access_denied" });
  });
});
