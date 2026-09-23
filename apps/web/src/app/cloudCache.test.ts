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

  describe("personalShares", () => {
    const personalShares = {
      month: "2026-09",
      groups: [
        {
          groupId: "group_1",
          name: "Tokyo Trip",
          currency: "TWD",
          archived: false,
          shareMinor: 135000,
          expenseCount: 3,
          byCategory: [{ category: "food", totalMinor: 135000 }],
        },
      ],
    };

    test("round-trips", () => {
      const storage = memoryStorage();
      const snapshot = makeSnapshot({ personalShares });

      saveCloudCache(snapshot, storage);

      expect(loadCloudCache("user_1", storage)?.personalShares).toEqual(personalShares);
    });

    test("null round-trips as null", () => {
      const storage = memoryStorage();
      saveCloudCache(makeSnapshot({ personalShares: null }), storage);

      expect(loadCloudCache("user_1", storage)?.personalShares).toBeNull();
    });

    // [MV]
    test("a malformed personalShares is dropped while groups/groupDetails survive", () => {
      const storage = memoryStorage();
      const snapshot = makeSnapshot();
      storage.setItem(
        "equo.clean.cloud_cache",
        JSON.stringify({ ...snapshot, version: 2, personalShares: { month: "not-a-month", groups: "nope" } }),
      );

      const loaded = loadCloudCache("user_1", storage);

      expect(loaded?.personalShares).toBeUndefined();
      expect(loaded?.groups).toEqual(snapshot.groups);
      expect(loaded?.groupDetails).toEqual(snapshot.groupDetails);
    });

    test("an old cache with no personalShares key at all still loads", () => {
      const storage = memoryStorage();
      const snapshot = makeSnapshot();
      storage.setItem("equo.clean.cloud_cache", JSON.stringify({ ...snapshot, version: 2 }));

      const loaded = loadCloudCache("user_1", storage);

      expect(loaded?.personalShares).toBeUndefined();
      expect(loaded?.groups).toEqual(snapshot.groups);
    });
  });
});
