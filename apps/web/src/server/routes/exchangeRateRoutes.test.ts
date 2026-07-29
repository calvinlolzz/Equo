import { beforeEach, describe, expect, test, vi } from "vitest";
import { createFakePostgrest } from "../db/fakePostgrest.js";
import {
  EXCHANGE_RATE_CACHE_MS,
  EXCHANGE_RATE_STALE_MS,
  exchangeRatesRoute,
  isValidCurrencyCode,
  pickSupportedRates,
  resetExchangeRateCache,
} from "./exchangeRateRoutes.js";

const verifier = async (idToken: string) => ({
  auth_user_id: idToken,
  google_sub: idToken,
  email: "alice@example.com",
  display_name: "Alice",
  resolved_user_id: idToken,
});

function makeClient() {
  return createFakePostgrest({
    select: (table) => (table === "users" ? [{ id: "user_alice", deleted_at: null }] : []),
  });
}

function options(overrides: Partial<Parameters<typeof exchangeRatesRoute>[0]> = {}) {
  return {
    client: makeClient(),
    verifier,
    idToken: "user_alice",
    now: 0,
    fetchRates: async () => ({ date: "2026-07-30", rates: { TWD: 1, JPY: 4.7 } }),
    ...overrides,
  };
}

beforeEach(() => {
  resetExchangeRateCache();
});

describe("pickSupportedRates", () => {
  test("keeps only the codes the picker offers and pins the base at 1", () => {
    const rates = pickSupportedRates("TWD", { TWD: 0.99, JPY: 4.7, USD: 0.031, ZWL: 12, EUR: 0.028 });

    expect(rates).toEqual({ TWD: 1, JPY: 4.7, USD: 0.031, EUR: 0.028 });
  });

  test("drops values that would break the composer's arithmetic", () => {
    const rates = pickSupportedRates("TWD", { JPY: 0, USD: -1, KRW: "42", EUR: Number.NaN });

    expect(rates).toEqual({ TWD: 1 });
  });
});

describe("isValidCurrencyCode", () => {
  test("accepts exactly a three-letter uppercase code", () => {
    expect(isValidCurrencyCode("TWD")).toBe(true);
    expect(isValidCurrencyCode("TW")).toBe(false);
    expect(isValidCurrencyCode("TWDX")).toBe(false);
    expect(isValidCurrencyCode("../etc")).toBe(false);
  });
});

describe("exchangeRatesRoute", () => {
  test("answers with the upstream's rates for the requested base", async () => {
    const result = await exchangeRatesRoute(options(), "TWD");

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ base: "TWD", date: "2026-07-30", rates: { TWD: 1, JPY: 4.7 }, stale: false });
  });

  test("requires a session, so the endpoint is not an open proxy", async () => {
    const result = await exchangeRatesRoute(options({ verifier: async () => null, idToken: "" }), "TWD");

    expect(result.status).toBe(401);
  });

  test("rejects a base that is not a currency code", async () => {
    const result = await exchangeRatesRoute(options(), "not-a-code");

    expect(result.status).toBe(400);
  });

  test("normalizes the base's case rather than missing the cache", async () => {
    let calls = 0;
    const fetchRates = async () => {
      calls += 1;
      return { date: "2026-07-30", rates: { TWD: 1, JPY: 4.7 } };
    };

    await exchangeRatesRoute(options({ fetchRates }), "twd");
    const second = await exchangeRatesRoute(options({ fetchRates }), "TWD");

    expect(calls).toBe(1);
    expect(second.status).toBe(200);
  });

  test("reuses one upstream answer for the whole cache window, then refetches", async () => {
    let calls = 0;
    const fetchRates = async () => {
      calls += 1;
      return { date: "2026-07-30", rates: { TWD: 1, JPY: calls } };
    };

    await exchangeRatesRoute(options({ fetchRates, now: 0 }), "TWD");
    await exchangeRatesRoute(options({ fetchRates, now: EXCHANGE_RATE_CACHE_MS - 1 }), "TWD");
    expect(calls).toBe(1);

    await exchangeRatesRoute(options({ fetchRates, now: EXCHANGE_RATE_CACHE_MS + 1 }), "TWD");
    expect(calls).toBe(2);
  });

  test("serves the last good copy, flagged stale, when the upstream fails", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await exchangeRatesRoute(options({ now: 0 }), "TWD");

    const result = await exchangeRatesRoute(
      options({
        now: EXCHANGE_RATE_CACHE_MS + 1,
        fetchRates: async () => {
          throw new Error("upstream down");
        },
      }),
      "TWD",
    );

    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ rates: { JPY: 4.7 }, stale: true });
    logged.mockRestore();
  });

  test("gives up once the cached copy is older than the stale ceiling", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    await exchangeRatesRoute(options({ now: 0 }), "TWD");

    const result = await exchangeRatesRoute(
      options({
        now: EXCHANGE_RATE_STALE_MS + 1,
        fetchRates: async () => {
          throw new Error("upstream down");
        },
      }),
      "TWD",
    );

    // 503 rather than a week-old rate: the client's fallback is the manual
    // field, which is honest about not knowing.
    expect(result.status).toBe(503);
    logged.mockRestore();
  });

  test("never puts the upstream's failure in the response body", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const result = await exchangeRatesRoute(
      options({
        fetchRates: async () => {
          throw new Error("https://user:hunter2@rates.internal timed out");
        },
      }),
      "TWD",
    );

    expect(JSON.stringify(result.body)).not.toContain("hunter2");
    expect(JSON.stringify(result.body)).not.toContain("rates.internal");
    logged.mockRestore();
  });

  test("defaults to TWD when no base is given", async () => {
    const result = await exchangeRatesRoute(options(), undefined);

    expect(result.status).toBe(200);
    expect((result.body as { base: string }).base).toBe("TWD");
  });
});
