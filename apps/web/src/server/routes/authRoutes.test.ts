import { describe, expect, test } from "vitest";
import { authGoogleRoute } from "./authRoutes.js";
import { verifySessionToken } from "../auth/sessionToken.js";
import type { SupabaseQueryClient } from "../repositories/supabaseGroupRepository.js";

function makeClient(overrides: { deleted_at?: string | null } = {}): SupabaseQueryClient {
  return {
    async one() {
      return {
        id: "google_1",
        google_sub: "google_1",
        email: "alice@example.com",
        display_name: "Alice",
        avatar_url: "https://cdn.equo.local/avatars/google_1/photo.jpg",
        deleted_at: overrides.deleted_at ?? null,
      } as never;
    },
    async maybeOne() {
      return null;
    },
    async exec() {},
  };
}

describe("authGoogleRoute", () => {
  test("exchanges a Google ID token for a signed Equo session", async () => {
    const result = await authGoogleRoute(
      {
        client: makeClient(),
        verifier: async (idToken) => ({
          auth_user_id: idToken,
          google_sub: idToken,
          email: "alice@example.com",
          display_name: "Alice",
        }),
        sessionSecret: "session-secret",
        now: 1_000,
      },
      { id_token: "google_1" },
    );

    expect(result.status).toBe(200);
    if (!result.ok) {
      throw new Error("expected authGoogleRoute to exchange a session");
    }

    expect(result.headers["set-cookie"]).toContain("equo_session=");
    expect(result.body.session.user.email).toBe("alice@example.com");
    expect(result.body.session.user.avatar_url).toBe("https://cdn.equo.local/avatars/google_1/photo.jpg");
    expect(verifySessionToken(result.body.session.token, "session-secret", 1_000)?.email).toBe(
      "alice@example.com",
    );
  });

  test("refuses to issue a session for an admin-disabled account", async () => {
    const result = await authGoogleRoute(
      {
        client: makeClient({ deleted_at: "2026-07-11T00:00:00.000Z" }),
        verifier: async (idToken) => ({
          auth_user_id: idToken,
          google_sub: idToken,
          email: "alice@example.com",
          display_name: "Alice",
        }),
        sessionSecret: "session-secret",
        now: 1_000,
      },
      { id_token: "google_1" },
    );

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    if (result.ok) {
      throw new Error("expected authGoogleRoute to refuse a disabled account");
    }
    expect(result.body.error.code).toBe("ACCOUNT_DISABLED");
    expect(result.headers["set-cookie"]).toBeUndefined();
  });
});
