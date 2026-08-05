import type { PostgrestClient } from "../db/postgrestClient.js";
import type { GoogleTokenVerifier } from "../auth/google.js";
import { buildAuthContext } from "../auth/routeContext.js";
import { createSupabaseCatalogRepository } from "../repositories/supabaseCatalogRepository.js";

type RouteOptions = {
  client: PostgrestClient;
  verifier: GoogleTokenVerifier;
  idToken: string;
  now?: number;
  /** Test seam: the upstream call. Defaults to the public exchangerate feed. */
  fetchRates?: UpstreamFetch;
};

export type ExchangeRatesBody = {
  base: string;
  /** The upstream's own publication date (YYYY-MM-DD), not "when we fetched". */
  date: string;
  /** quote code -> units of quote per 1 base. Always includes base: 1. */
  rates: Record<string, number>;
  /** true when the upstream was unreachable and this is a kept-past-TTL copy. */
  stale: boolean;
};

export type ExchangeRatesResult =
  | { status: 200; body: ExchangeRatesBody }
  | { status: 400 | 401 | 503; body: unknown };

type UpstreamFetch = (base: string) => Promise<{ date: string; rates: Record<string, number> }>;

/**
 * Which currencies are worth carrying. The composer's picker is a fixed list
 * (see App.tsx's currencyOptions), and the upstream answers with ~160 codes -
 * no reason to ship the other 155 to every phone that opens the sheet.
 *
 * A code missing from here is not an error anywhere: the client falls back to
 * the manual rate field, which is what shipped before this endpoint existed.
 */
export const SUPPORTED_RATE_CODES: readonly string[] = ["TWD", "JPY", "USD", "KRW", "EUR"];

/**
 * How long one base's rates are reused per serverless instance.
 *
 * Daily reference rates that move by fractions of a percent; six hours is far
 * inside the precision anyone splitting a dinner cares about, and it keeps a
 * busy day at a handful of upstream calls per instance rather than one per
 * composer open.
 */
export const EXCHANGE_RATE_CACHE_MS = 6 * 60 * 60 * 1000;

/**
 * How long a cached copy stays usable once the upstream starts failing. The
 * alternative to a two-day-old rate is no rate at all (the field goes back to
 * manual entry), so serving one flagged as stale is strictly better - but not
 * forever, hence the ceiling.
 */
export const EXCHANGE_RATE_STALE_MS = 3 * 24 * 60 * 60 * 1000;

/** Upstream timeout. The composer opens without the rate and fills it in later, so waiting is never worth it. */
const UPSTREAM_TIMEOUT_MS = 4_000;

const cache = new Map<string, { at: number; body: ExchangeRatesBody }>();

/** Test seam: drop the memoised rates so each case starts cold. */
export function resetExchangeRateCache(): void {
  cache.clear();
}

export function isValidCurrencyCode(value: string): boolean {
  return /^[A-Z]{3}$/.test(value);
}

/**
 * Keep the codes the picker offers, drop the rest, and pin the base at exactly
 * 1 rather than trusting the upstream to have said so.
 */
export function pickSupportedRates(base: string, rates: Record<string, unknown>): Record<string, number> {
  const result: Record<string, number> = { [base]: 1 };

  for (const code of SUPPORTED_RATE_CODES) {
    if (code === base) continue;
    const value = rates[code];
    // A zero or negative rate would divide the composer's math by nothing;
    // treating it as absent puts the field back on manual entry.
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      result[code] = value;
    }
  }

  return result;
}

/**
 * Lay the console's manual rates over the upstream's.
 *
 * Applied AFTER the cache rather than inside it, so an override an admin sets
 * takes effect on the next request instead of up to six hours later - which is
 * the whole reason a manual rate exists (the upstream is wrong or silent right
 * now).
 *
 * An override may name a currency the upstream never quoted, which is the other
 * half of the point: SUPPORTED_RATE_CODES is a filter on the feed, not a limit
 * on what somebody can be told the rate is.
 */
export function applyRateOverrides(
  base: string,
  rates: Record<string, number>,
  overrides: Record<string, unknown>,
): Record<string, number> {
  const merged = { ...rates };

  for (const [quote, raw] of Object.entries(overrides)) {
    if (quote === base) continue;
    // numeric(18,8) comes back from PostgREST as a string.
    const value = typeof raw === "string" ? Number(raw) : raw;
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      merged[quote] = value;
    }
  }

  return merged;
}

async function fetchFromUpstream(base: string): Promise<{ date: string; rates: Record<string, number> }> {
  // open.er-api.com: no API key, no signup, daily refresh, and it carries TWD
  // (the ECB-derived feeds do not, which rules them out for a Taiwan-first app).
  const response = await fetch(`https://open.er-api.com/v6/latest/${base}`, {
    signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    headers: { accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`exchange rate upstream returned ${response.status}`);
  }

  const payload = (await response.json()) as {
    result?: string;
    time_last_update_utc?: string;
    rates?: Record<string, unknown>;
  };

  if (payload.result !== "success" || !payload.rates) {
    throw new Error("exchange rate upstream returned an unsuccessful payload");
  }

  const published = payload.time_last_update_utc ? new Date(payload.time_last_update_utc) : new Date();
  const date = Number.isNaN(published.getTime())
    ? new Date().toISOString().slice(0, 10)
    : published.toISOString().slice(0, 10);

  return { date, rates: pickSupportedRates(base, payload.rates) };
}

/**
 * GET /api/v1/exchange-rates?base=TWD
 *
 * Exists so the composer can pre-fill the 匯率 field instead of asking someone
 * standing in a Tokyo konbini to go look up the rate. It is a server route
 * rather than a fetch from the page because the site's CSP allows connect-src
 * 'self' and Supabase only - reaching a third-party host from the browser
 * would mean widening that for every page.
 *
 * Behind the session wall: not because rates are secret, but so the endpoint
 * cannot be used as an anonymous proxy to the upstream on our IP budget.
 */
export async function exchangeRatesRoute(
  options: RouteOptions,
  baseParam: string | undefined,
): Promise<ExchangeRatesResult> {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { status: 401, body: auth.error };
  }

  const base = (baseParam ?? "TWD").toUpperCase();

  if (!isValidCurrencyCode(base)) {
    return {
      status: 400,
      body: {
        error: {
          code: "MALFORMED_REQUEST",
          message: "base must be a three-letter currency code",
          request_id: "req_exchange_rates",
        },
      },
    };
  }

  const now = options.now ?? Date.now();
  const cached = cache.get(base);

  // Read on every request, cache or no cache: an override is set precisely
  // because the current number is wrong, so it must not wait out the TTL.
  // Fail-open - a missing table (console ahead of its migration) or a slow
  // query degrades to the upstream's own numbers rather than to no rates.
  let overrides: Record<string, unknown> = {};
  try {
    overrides = await createSupabaseCatalogRepository(options.client).getRateOverrides(base);
  } catch (error) {
    console.warn("[exchange-rates] override lookup failed:", error);
  }

  if (cached && now - cached.at < EXCHANGE_RATE_CACHE_MS) {
    return {
      status: 200,
      body: { ...cached.body, rates: applyRateOverrides(base, cached.body.rates, overrides) },
    };
  }

  const fetchRates = options.fetchRates ?? fetchFromUpstream;

  try {
    const { date, rates } = await fetchRates(base);
    const body: ExchangeRatesBody = { base, date, rates, stale: false };
    // Cached WITHOUT the overrides so a later change is not baked in for six
    // hours; the merge happens on the way out, above and below.
    cache.set(base, { at: now, body });
    return { status: 200, body: { ...body, rates: applyRateOverrides(base, rates, overrides) } };
  } catch (error) {
    console.error("[exchange-rates] upstream fetch failed:", error);

    if (cached && now - cached.at < EXCHANGE_RATE_STALE_MS) {
      return {
        status: 200,
        body: { ...cached.body, rates: applyRateOverrides(base, cached.body.rates, overrides), stale: true },
      };
    }

    // The upstream is unreachable and nothing is cached, but an admin has set
    // rates by hand - which is exactly the situation those were set for.
    const manual = applyRateOverrides(base, { [base]: 1 }, overrides);
    if (Object.keys(manual).length > 1) {
      return {
        status: 200,
        body: { base, date: new Date(now).toISOString().slice(0, 10), rates: manual, stale: true },
      };
    }

    return {
      status: 503,
      body: {
        error: {
          code: "EXCHANGE_RATE_UNAVAILABLE",
          message: "Exchange rates are temporarily unavailable.",
          request_id: "req_exchange_rates",
        },
      },
    };
  }
}
