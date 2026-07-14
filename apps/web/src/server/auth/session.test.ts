import { describe, expect, test, vi } from "vitest";
import type { GoogleIdentity } from "./google.js";
import { requireAuthenticatedUser } from "./session.js";

const resolvedIdentity: GoogleIdentity = {
  auth_user_id: "user_1",
  google_sub: "google_1",
  email: "alice@example.com",
  display_name: "Alice",
  resolved_user_id: "user_1",
};

const freshIdentity: GoogleIdentity = {
  auth_user_id: "google_1",
  google_sub: "google_1",
  email: "alice@example.com",
  display_name: "Alice",
};

describe("requireAuthenticatedUser", () => {
  test("returns UNAUTHENTICATED when there is no identity", async () => {
    const resolveUser = vi.fn();

    const result = await requireAuthenticatedUser(null, resolveUser, "req_1");

    expect(result).toEqual({
      ok: false,
      error: { error: { code: "UNAUTHENTICATED", message: "Please sign in with Google.", request_id: "req_1" } },
    });
    expect(resolveUser).not.toHaveBeenCalled();
  });

  test("skips resolveUser entirely for a session-token identity (resolved_user_id present)", async () => {
    const resolveUser = vi.fn();

    const result = await requireAuthenticatedUser(resolvedIdentity, resolveUser);

    expect(resolveUser).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: true,
      context: { user: { id: "user_1", google_sub: "google_1", email: "alice@example.com", display_name: "Alice" } },
    });
  });

  test("carries avatar_url through the session-token fast path", async () => {
    const resolveUser = vi.fn();
    const identityWithAvatar: GoogleIdentity = {
      ...resolvedIdentity,
      avatar_url: "https://cdn.equo.local/avatars/user_1/photo.jpg",
    };

    const result = await requireAuthenticatedUser(identityWithAvatar, resolveUser);

    expect(result.ok).toBe(true);
    expect(result.ok && result.context.user.avatar_url).toBe("https://cdn.equo.local/avatars/user_1/photo.jpg");
  });

  test("still calls resolveUser (the upsert path) for a fresh Google/Supabase identity with no resolved_user_id", async () => {
    const resolveUser = vi.fn(async () => ({
      id: "db_user_1",
      google_sub: "google_1",
      email: "alice@example.com",
      display_name: "Alice",
    }));

    const result = await requireAuthenticatedUser(freshIdentity, resolveUser);

    expect(resolveUser).toHaveBeenCalledTimes(1);
    expect(resolveUser).toHaveBeenCalledWith(freshIdentity);
    expect(result).toEqual({
      ok: true,
      context: { user: { id: "db_user_1", google_sub: "google_1", email: "alice@example.com", display_name: "Alice" } },
    });
  });

  test("refuses a session-token identity whose account has been disabled since the token was signed", async () => {
    const resolveUser = vi.fn();
    const loadSessionUserState = vi.fn(async () => ({ deleted_at: "2026-07-14T00:00:00.000Z" }));

    const result = await requireAuthenticatedUser(resolvedIdentity, resolveUser, "req_3", loadSessionUserState);

    expect(loadSessionUserState).toHaveBeenCalledWith("user_1");
    expect(resolveUser).not.toHaveBeenCalled();
    expect(result).toEqual({
      ok: false,
      error: { error: { code: "ACCOUNT_DISABLED", message: "此帳號已被停用。", request_id: "req_3" } },
    });
  });

  test("refuses a session-token identity whose user row no longer exists", async () => {
    const loadSessionUserState = vi.fn(async () => null);

    const result = await requireAuthenticatedUser(resolvedIdentity, vi.fn(), "req_4", loadSessionUserState);

    expect(result).toEqual({
      ok: false,
      error: { error: { code: "UNAUTHENTICATED", message: "User profile could not be resolved.", request_id: "req_4" } },
    });
  });

  test("admits a session-token identity whose account is still enabled", async () => {
    const loadSessionUserState = vi.fn(async () => ({ deleted_at: null }));

    const result = await requireAuthenticatedUser(resolvedIdentity, vi.fn(), "req_5", loadSessionUserState);

    expect(result.ok).toBe(true);
    expect(result.ok && result.context.user.id).toBe("user_1");
  });

  test("returns UNAUTHENTICATED when resolveUser cannot resolve a fresh identity", async () => {
    const resolveUser = vi.fn(async () => null);

    const result = await requireAuthenticatedUser(freshIdentity, resolveUser, "req_2");

    expect(result).toEqual({
      ok: false,
      error: { error: { code: "UNAUTHENTICATED", message: "User profile could not be resolved.", request_id: "req_2" } },
    });
  });
});
