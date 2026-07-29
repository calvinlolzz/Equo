import { describe, expect, test } from "vitest";
import type { ExchangeRatesResponse } from "./apiClient";
import {
  crossRate,
  formatExchangeRate,
  isEntryFresh,
  isEntryUsable,
  loadCrossRate,
  readRatesEntry,
  writeRatesEntry,
  RATES_FRESH_MS,
  RATES_USABLE_MS,
  type RatesEntry,
} from "./exchangeRates";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function memoryStorage(seed: Record<string, string> = {}): Storage {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

function entry(overrides: Partial<RatesEntry> = {}): RatesEntry {
  return {
    base: "TWD",
    date: "2026-07-30",
    rates: { TWD: 1, JPY: 4.7, USD: 0.031, KRW: 42.5 },
    fetchedAt: 1_000_000,
    ...overrides,
  };
}

function response(overrides: Partial<ExchangeRatesResponse> = {}): ExchangeRatesResponse {
  return {
    base: "TWD",
    date: "2026-07-30",
    rates: { TWD: 1, JPY: 4.7 },
    stale: false,
    ...overrides,
  };
}

describe("crossRate", () => {
  test("derives a pair neither of which is the base", () => {
    // 1 JPY = (0.031 USD / 4.7 JPY) per TWD-based table.
    expect(crossRate(entry(), "JPY", "USD")).toBeCloseTo(0.031 / 4.7, 10);
  });

  test("converts a foreign currency back to the base the table is quoted in", () => {
    expect(crossRate(entry(), "JPY", "TWD")).toBeCloseTo(1 / 4.7, 10);
  });

  test("is exactly 1 for a pair with itself, even when the code is missing", () => {
    expect(crossRate(entry({ rates: { TWD: 1 } }), "EUR", "EUR")).toBe(1);
  });

  test("returns null when a leg is missing or nonsensical", () => {
    expect(crossRate(entry(), "EUR", "TWD")).toBeNull();
    expect(crossRate(entry({ rates: { TWD: 1, JPY: 0 } }), "JPY", "TWD")).toBeNull();
    expect(crossRate(entry({ rates: { TWD: 1, JPY: -4 } }), "JPY", "TWD")).toBeNull();
  });
});

describe("formatExchangeRate", () => {
  test("keeps small rates readable rather than rounding them away", () => {
    expect(formatExchangeRate(1 / 42.5)).toBe("0.0235294");
  });

  test("trims float noise", () => {
    expect(formatExchangeRate(0.1 + 0.2)).toBe("0.3");
  });

  test("has no output for a rate that cannot be used", () => {
    expect(formatExchangeRate(0)).toBe("");
    expect(formatExchangeRate(Number.NaN)).toBe("");
  });
});

describe("storage round-trip", () => {
  test("stores one entry per base without dropping the others", () => {
    const storage = memoryStorage();
    writeRatesEntry(entry(), storage);
    writeRatesEntry(entry({ base: "JPY", rates: { JPY: 1, TWD: 0.21 } }), storage);

    expect(readRatesEntry("TWD", storage)?.rates.JPY).toBe(4.7);
    expect(readRatesEntry("JPY", storage)?.rates.TWD).toBe(0.21);
  });

  test("treats unreadable or foreign-versioned storage as empty", () => {
    expect(readRatesEntry("TWD", memoryStorage({ "equo.clean.exchange_rates": "not json" }))).toBeNull();
    expect(
      readRatesEntry("TWD", memoryStorage({ "equo.clean.exchange_rates": JSON.stringify({ version: 99, entries: {} }) })),
    ).toBeNull();
  });

  test("a throwing storage never propagates out of a write", () => {
    const storage: Storage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(() => writeRatesEntry(entry(), storage)).not.toThrow();
  });
});

describe("freshness windows", () => {
  test("fresh inside the refresh window, usable well past it", () => {
    const stored = entry({ fetchedAt: 0 });
    expect(isEntryFresh(stored, RATES_FRESH_MS - 1)).toBe(true);
    expect(isEntryFresh(stored, RATES_FRESH_MS + 1)).toBe(false);
    expect(isEntryUsable(stored, RATES_FRESH_MS + 1)).toBe(true);
    expect(isEntryUsable(stored, RATES_USABLE_MS + 1)).toBe(false);
  });
});

describe("loadCrossRate", () => {
  test("uses a fresh stored table without calling the server", async () => {
    const storage = memoryStorage();
    writeRatesEntry(entry({ fetchedAt: 5_000 }), storage);
    let calls = 0;

    const result = await loadCrossRate({
      base: "TWD",
      from: "JPY",
      to: "TWD",
      fetchRates: async () => {
        calls += 1;
        return response();
      },
      now: () => 5_000,
      storage,
    });

    expect(calls).toBe(0);
    expect(result?.rate).toBeCloseTo(1 / 4.7, 10);
    expect(result?.date).toBe("2026-07-30");
  });

  test("refreshes a stale table and stores what came back", async () => {
    const storage = memoryStorage();
    writeRatesEntry(entry({ fetchedAt: 0, rates: { TWD: 1, JPY: 9 } }), storage);
    const now = RATES_FRESH_MS + 1;

    const result = await loadCrossRate({
      base: "TWD",
      from: "JPY",
      to: "TWD",
      fetchRates: async () => response({ date: "2026-07-31", rates: { TWD: 1, JPY: 4 } }),
      now: () => now,
      storage,
    });

    expect(result?.rate).toBeCloseTo(0.25, 10);
    expect(readRatesEntry("TWD", storage)).toEqual({
      base: "TWD",
      date: "2026-07-31",
      rates: { TWD: 1, JPY: 4 },
      fetchedAt: now,
    });
  });

  test("falls back to an aged copy when the request fails", async () => {
    const storage = memoryStorage();
    writeRatesEntry(entry({ fetchedAt: 0 }), storage);

    const result = await loadCrossRate({
      base: "TWD",
      from: "JPY",
      to: "TWD",
      fetchRates: async () => {
        throw new Error("offline");
      },
      now: () => RATES_FRESH_MS + 1,
      storage,
    });

    expect(result?.rate).toBeCloseTo(1 / 4.7, 10);
  });

  test("gives up rather than pre-filling from a copy past the usable window", async () => {
    const storage = memoryStorage();
    writeRatesEntry(entry({ fetchedAt: 0 }), storage);

    const result = await loadCrossRate({
      base: "TWD",
      from: "JPY",
      to: "TWD",
      fetchRates: async () => {
        throw new Error("offline");
      },
      now: () => RATES_USABLE_MS + 1,
      storage,
    });

    expect(result).toBeNull();
  });

  test("returns null for a pair the table cannot answer, so the field stays manual", async () => {
    const result = await loadCrossRate({
      base: "TWD",
      from: "EUR",
      to: "TWD",
      fetchRates: async () => response(),
      now: () => 0,
      storage: memoryStorage(),
    });

    expect(result).toBeNull();
  });
});
