import { describe, expect, test } from "vitest";
import { clearCloudCache, loadCloudCache, saveCloudCache, type CloudCacheSnapshot } from "./cloudCache";

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

function makeSnapshot(overrides: Partial<CloudCacheSnapshot> = {}): CloudCacheSnapshot {
  return {
    userId: "user_1",
    groups: [{ id: "group_1", name: "Tokyo Trip", currency: "TWD", coverImageUrl: undefined }],
    groupDetails: {
      group_1: {
        group: { id: "group_1", name: "Tokyo Trip", currency: "TWD" },
        members: [{ id: "member_1", name: "Alice", role: "owner", virtual: false, userId: "user_1" }],
        expenses: [],
        balances: [{ memberId: "member_1", balance: { amount_minor: 0, currency: "TWD" } }],
        aggregates: { expenseCount: 0, spendTotalMinor: 0, spendByDay: [], spendByCategory: [], memberDayShares: [] },
      },
    },
    ...overrides,
  };
}

describe("cloudCache", () => {
  test("saves and loads a cache snapshot for the same user", () => {
    const storage = memoryStorage();
    const snapshot = makeSnapshot();

    saveCloudCache(snapshot, storage);

    expect(loadCloudCache("user_1", storage)).toEqual(snapshot);
  });

  test("returns null when nothing is cached", () => {
    const storage = memoryStorage();

    expect(loadCloudCache("user_1", storage)).toBeNull();
  });

  test("returns null when the cache belongs to a different user", () => {
    const storage = memoryStorage();
    saveCloudCache(makeSnapshot({ userId: "user_1" }), storage);

    expect(loadCloudCache("user_2", storage)).toBeNull();
  });

  test("returns null for malformed JSON", () => {
    const storage = memoryStorage();
    storage.setItem("equo.clean.cloud_cache", "{not-json");

    expect(loadCloudCache("user_1", storage)).toBeNull();
  });

  test("returns null when the shape is missing required fields", () => {
    const storage = memoryStorage();
    storage.setItem("equo.clean.cloud_cache", JSON.stringify({ userId: "user_1" }));

    expect(loadCloudCache("user_1", storage)).toBeNull();
  });

  test("returns null when the stored version does not match the current format", () => {
    const storage = memoryStorage();
    const snapshot = makeSnapshot();
    storage.setItem("equo.clean.cloud_cache", JSON.stringify({ ...snapshot, version: 999 }));

    expect(loadCloudCache("user_1", storage)).toBeNull();
  });

  test("clearCloudCache removes the stored cache", () => {
    const storage = memoryStorage();
    saveCloudCache(makeSnapshot(), storage);

    clearCloudCache(storage);

    expect(loadCloudCache("user_1", storage)).toBeNull();
  });

  // [MV]
  test("a stage-2 cache carrying personalShares still loads, and the field is dropped", () => {
    const storage = memoryStorage();
    const snapshot = makeSnapshot();
    storage.setItem(
      "equo.clean.cloud_cache",
      JSON.stringify({ ...snapshot, version: 2, personalShares: { month: "2026-09", groups: [] } }),
    );

    const loaded = loadCloudCache("user_1", storage);

    expect(loaded).toEqual(snapshot);
    expect(loaded && "personalShares" in loaded).toBe(false);
  });
});
