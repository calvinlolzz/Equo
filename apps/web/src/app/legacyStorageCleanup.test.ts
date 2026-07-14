import { describe, expect, test } from "vitest";
import { purgeLegacyStorage } from "./legacyStorageCleanup";

/** Minimal in-memory Storage stand-in with the indexable key() walk the purge relies on. */
function makeStorage(initial: Record<string, string>): Storage {
  const map = new Map(Object.entries(initial));
  return {
    get length() {
      return map.size;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    getItem(key: string) {
      return map.has(key) ? (map.get(key) as string) : null;
    },
    setItem(key: string, value: string) {
      map.set(key, value);
    },
    removeItem(key: string) {
      map.delete(key);
    },
    clear() {
      map.clear();
    },
  } as Storage;
}

describe("purgeLegacyStorage", () => {
  test("removes every floatpay-* key and leaves equo.* keys untouched", () => {
    const storage = makeStorage({
      "floatpay-groups": "[]",
      "floatpay-expenses": "[]",
      "floatpay-users": "[]",
      "floatpay-settlements": "[]",
      "floatpay.legacy": "1",
      "equo.clean.session": "{}",
      "equo.recent_groups": "[]",
    });

    purgeLegacyStorage(storage);

    expect(storage.getItem("floatpay-groups")).toBeNull();
    expect(storage.getItem("floatpay-expenses")).toBeNull();
    expect(storage.getItem("floatpay-users")).toBeNull();
    expect(storage.getItem("floatpay-settlements")).toBeNull();
    expect(storage.getItem("floatpay.legacy")).toBeNull();
    // Current-namespace keys survive.
    expect(storage.getItem("equo.clean.session")).toBe("{}");
    expect(storage.getItem("equo.recent_groups")).toBe("[]");
  });

  test("is a safe no-op when there is nothing to purge", () => {
    const storage = makeStorage({ "equo.clean.session": "{}" });

    expect(() => purgeLegacyStorage(storage)).not.toThrow();
    expect(storage.getItem("equo.clean.session")).toBe("{}");
    expect(storage.length).toBe(1);
  });

  test("tolerates a null storage (SSR / storage disabled)", () => {
    expect(() => purgeLegacyStorage(null)).not.toThrow();
  });
});
