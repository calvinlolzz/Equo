import { describe, expect, test } from "vitest";
import { clearAuthToken, loadAuthToken, saveAuthToken } from "./authSession";

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

describe("authSession", () => {
  test("saves, loads, and clears the Google ID token", () => {
    const storage = memoryStorage();

    saveAuthToken("google-id-token", storage);

    expect(loadAuthToken(storage)).toBe("google-id-token");

    clearAuthToken(storage);

    expect(loadAuthToken(storage)).toBeNull();
  });

  test("ignores blank tokens", () => {
    const storage = memoryStorage();

    saveAuthToken("   ", storage);

    expect(loadAuthToken(storage)).toBeNull();
  });
});
