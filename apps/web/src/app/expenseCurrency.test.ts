import { describe, expect, test } from "vitest";
import { convertToGroupAmountMinor, readLastCurrency, writeLastCurrency } from "./expenseCurrency";

function memoryStorage(seed: Record<string, string> = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("the remembered currency", () => {
  test("is scoped per group, so a trip group's JPY is not a rent group's default", () => {
    const storage = memoryStorage();
    writeLastCurrency("group_tokyo", "JPY", storage);
    writeLastCurrency("group_rent", "TWD", storage);

    expect(readLastCurrency("group_tokyo", storage)).toBe("JPY");
    expect(readLastCurrency("group_rent", storage)).toBe("TWD");
  });

  test("reads empty for a group nothing was written for", () => {
    expect(readLastCurrency("group_new", memoryStorage())).toBe("");
  });

  test("survives unreadable storage instead of throwing into the composer", () => {
    expect(readLastCurrency("group_1", memoryStorage({ "equo.clean.last_currency": "{{" }))).toBe("");
    expect(() =>
      writeLastCurrency("group_1", "JPY", {
        getItem: () => null,
        setItem: () => {
          throw new Error("QuotaExceededError");
        },
      }),
    ).not.toThrow();
  });

  test("ignores an empty group id or currency rather than writing a junk key", () => {
    const storage = memoryStorage();
    writeLastCurrency("", "JPY", storage);
    writeLastCurrency("group_1", "", storage);

    expect(readLastCurrency("", storage)).toBe("");
    expect(readLastCurrency("group_1", storage)).toBe("");
  });
});

describe("convertToGroupAmountMinor", () => {
  test("converts a source-currency amount into group-currency minor units", () => {
    expect(convertToGroupAmountMinor({ amount: "10", exchangeRate: "0.23" })).toBe(230);
    expect(convertToGroupAmountMinor({ amount: 100, exchangeRate: 1 })).toBe(10000);
  });

  test("rounds to the nearest minor unit", () => {
    expect(convertToGroupAmountMinor({ amount: "3", exchangeRate: "0.333" })).toBe(100);
  });

  test("falls back to 0 for invalid input", () => {
    expect(convertToGroupAmountMinor({ amount: "abc", exchangeRate: "1" })).toBe(0);
    expect(convertToGroupAmountMinor({ amount: "10", exchangeRate: "" })).toBe(0);
  });
});
