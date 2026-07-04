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
    token: "session-token",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    user: { id: "user-1", email: "person@example.com", displayName: "小明" },
    ...overrides,
  };
}

describe("sessionStore", () => {
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
});
