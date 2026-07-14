import { describe, expect, test } from "vitest";
import { clearSession, loadSession, saveSession, type StoredSession } from "./sessionStore";

function memoryStorage() {
  const values = new Map<string, string>();

  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

function makeSession(overrides: Partial<StoredSession> = {}): StoredSession {
  return {
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    user: { id: "user-1", email: "person@example.com", displayName: "小明" },
    ...overrides,
  };
}

describe("sessionStore", () => {
  test("never writes the session token to localStorage", () => {
    const storage = memoryStorage();

    saveSession(makeSession(), storage);

    // The credential belongs in the equo_session HttpOnly cookie and nowhere
    // else. Persisting it here would hand it to any XSS on the page - which is
    // exactly what the cookie's HttpOnly flag exists to prevent, and exactly
    // what this app used to do.
    expect(storage.getItem("equo.clean.session")).not.toContain("token");
  });

  test("purges a token left behind by an older build, on the first load", () => {
    const storage = memoryStorage();
    const legacy = {
      token: "leaked-session-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      user: { id: "user-1", email: "person@example.com", displayName: "小明" },
    };
    storage.setItem("equo.clean.session", JSON.stringify(legacy));

    const loaded = loadSession(Date.now(), storage);

    // The user stays logged in - the cookie still authenticates them - but the
    // copy of the credential sitting in localStorage is gone. Moving the token
    // to an HttpOnly cookie is worth nothing while a readable copy remains.
    expect(loaded?.user.id).toBe("user-1");
    expect(loaded).not.toHaveProperty("token");
    expect(storage.getItem("equo.clean.session")).not.toContain("leaked-session-token");
  });

  test("saves and loads a session that has not expired", () => {
    const storage = memoryStorage();
    const session = makeSession();

    saveSession(session, storage);

    expect(loadSession(Date.now(), storage)).toEqual(session);
  });

  test("returns null when nothing is stored", () => {
    const storage = memoryStorage();

    expect(loadSession(Date.now(), storage)).toBeNull();
  });

  test("returns null and clears storage when the session has expired", () => {
    const storage = memoryStorage();
    const session = makeSession({ expiresAt: new Date(Date.now() - 1_000).toISOString() });

    saveSession(session, storage);

    const now = Date.now();
    expect(loadSession(now, storage)).toBeNull();
    expect(storage.getItem("equo.clean.session")).toBeNull();
  });

  test("treats the expiry boundary as expired", () => {
    const storage = memoryStorage();
    const expiresAt = new Date(Date.now() + 1_000).toISOString();
    const session = makeSession({ expiresAt });

    saveSession(session, storage);

    expect(loadSession(Date.parse(expiresAt), storage)).toBeNull();
  });

  test("clearSession removes the stored session", () => {
    const storage = memoryStorage();
    saveSession(makeSession(), storage);

    clearSession(storage);

    expect(loadSession(Date.now(), storage)).toBeNull();
  });

  test("returns null for malformed JSON", () => {
    const storage = memoryStorage();
    storage.setItem("equo.clean.session", "{not-json");

    expect(loadSession(Date.now(), storage)).toBeNull();
  });

  test("returns null when the shape is missing required fields", () => {
    const storage = memoryStorage();
    storage.setItem("equo.clean.session", JSON.stringify({ token: "abc" }));

    expect(loadSession(Date.now(), storage)).toBeNull();
  });

  test("round-trips a session that carries an avatarUrl", () => {
    const storage = memoryStorage();
    const session = makeSession({
      user: { id: "user-1", email: "person@example.com", displayName: "小明", avatarUrl: "https://cdn.equo.local/avatars/user-1/photo.jpg" },
    });

    saveSession(session, storage);

    expect(loadSession(Date.now(), storage)).toEqual(session);
  });

  test("loads a legacy session with no avatarUrl field at all (backward compat)", () => {
    const storage = memoryStorage();
    const legacySession = {
      token: "session-token",
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
      user: { id: "user-1", email: "person@example.com", displayName: "小明" },
    };
    storage.setItem("equo.clean.session", JSON.stringify(legacySession));

    // Still loads (the user is not logged out by the upgrade), minus the token -
    // see the purge test above.
    expect(loadSession(Date.now(), storage)).toEqual({
      expiresAt: legacySession.expiresAt,
      user: legacySession.user,
    });
  });

  test("rejects a session whose avatarUrl is a non-string, non-null value", () => {
    const storage = memoryStorage();
    storage.setItem(
      "equo.clean.session",
      JSON.stringify({
        token: "session-token",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        user: { id: "user-1", email: "person@example.com", displayName: "小明", avatarUrl: 12345 },
      }),
    );

    expect(loadSession(Date.now(), storage)).toBeNull();
  });
});
