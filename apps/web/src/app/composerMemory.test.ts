import { describe, expect, test } from "vitest";
import { readGroupMemory, readLastCategory, writeGroupMemory, writeLastCategory } from "./composerMemory";

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
  };
}

describe("readGroupMemory / writeGroupMemory", () => {
  test("round-trips a value per group under one key", () => {
    const storage = memoryStorage();
    writeGroupMemory("k", "group_1", "value_1", storage);
    writeGroupMemory("k", "group_2", "value_2", storage);

    expect(readGroupMemory("k", "group_1", storage)).toBe("value_1");
    expect(readGroupMemory("k", "group_2", storage)).toBe("value_2");
  });

  test("missing group / missing key / blank storage all read back empty", () => {
    const storage = memoryStorage();
    expect(readGroupMemory("k", "group_1", storage)).toBe("");
    expect(readGroupMemory("k", "", storage)).toBe("");
    expect(readGroupMemory("k", "group_1", null)).toBe("");
  });

  test("writing an empty value is a no-op (never overwrites with blank)", () => {
    const storage = memoryStorage();
    writeGroupMemory("k", "group_1", "value_1", storage);
    writeGroupMemory("k", "group_1", "", storage);
    expect(readGroupMemory("k", "group_1", storage)).toBe("value_1");
  });
});

describe("readLastCategory / writeLastCategory scope", () => {
  // [MV]
  test("expense and income categories are remembered under separate keys, so one doesn't clobber the other", () => {
    const storage = memoryStorage();

    writeLastCategory("group_1", "食物", storage, "expense");
    writeLastCategory("group_1", "薪資", storage, "income");

    expect(readLastCategory("group_1", storage, "expense")).toBe("食物");
    expect(readLastCategory("group_1", storage, "income")).toBe("薪資");
  });

  test("scope defaults to expense when omitted, matching pre-existing call sites", () => {
    const storage = memoryStorage();
    writeLastCategory("group_1", "食物", storage);
    expect(readLastCategory("group_1", storage)).toBe("食物");
    expect(readLastCategory("group_1", storage, "expense")).toBe("食物");
    expect(readLastCategory("group_1", storage, "income")).toBe("");
  });

  test("writing an income category after an expense category leaves the remembered expense category untouched", () => {
    const storage = memoryStorage();
    writeLastCategory("group_1", "食物", storage, "expense");

    writeLastCategory("group_1", "薪資", storage, "income");

    expect(readLastCategory("group_1", storage, "expense")).toBe("食物");
  });
});
