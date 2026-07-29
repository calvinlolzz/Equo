import type { ExchangeRatesResponse } from "./apiClient";

/**
 * Client-side cache for the composer's auto-filled 匯率.
 *
 * The server already caches per instance (see server/routes/exchangeRateRoutes),
 * so this layer is not about sparing the upstream - it is about the composer
 * opening with a rate already in the field on a subway platform with one bar of
 * signal. A stored copy is used immediately and refreshed in the background;
 * nothing here ever blocks the sheet from opening.
 */

const STORAGE_KEY = "equo.clean.exchange_rates";
const STORAGE_VERSION = 1;

/** How long a stored copy is used without asking the server again. */
export const RATES_FRESH_MS = 12 * 60 * 60 * 1000;

/**
 * How long a stored copy is still worth showing while offline. Past this the
 * field goes back to manual entry rather than pre-filling a number that could
 * be a week wrong without saying so.
 */
export const RATES_USABLE_MS = 7 * 24 * 60 * 60 * 1000;

export type RatesEntry = {
  base: string;
  /** The upstream's publication date (YYYY-MM-DD), shown next to the field. */
  date: string;
  /** quote code -> units of quote per 1 base. */
  rates: Record<string, number>;
  /** When this copy was stored, in epoch ms. */
  fetchedAt: number;
};

type StoredRates = {
  version: number;
  entries: Record<string, RatesEntry>;
};

type RatesStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): RatesStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function isRatesEntry(value: unknown): value is RatesEntry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.base === "string" &&
    typeof candidate.date === "string" &&
    typeof candidate.fetchedAt === "number" &&
    Boolean(candidate.rates) &&
    typeof candidate.rates === "object"
  );
}

export function readRatesEntry(base: string, storage: RatesStorage | null = browserStorage()): RatesEntry | null {
  if (!storage) return null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredRates;
    if (!parsed || parsed.version !== STORAGE_VERSION) return null;
    const entry = parsed.entries?.[base];
    return isRatesEntry(entry) ? entry : null;
  } catch {
    return null;
  }
}

export function writeRatesEntry(entry: RatesEntry, storage: RatesStorage | null = browserStorage()): void {
  if (!storage) return;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as StoredRates) : null;
    const entries = parsed?.version === STORAGE_VERSION && parsed.entries ? parsed.entries : {};
    const next: StoredRates = { version: STORAGE_VERSION, entries: { ...entries, [entry.base]: entry } };
    storage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // A full or disabled localStorage costs nothing here - the rate is fetched
    // again next time. Never let it break opening the composer.
  }
}

export function isEntryFresh(entry: RatesEntry, nowMs: number): boolean {
  return nowMs - entry.fetchedAt < RATES_FRESH_MS;
}

export function isEntryUsable(entry: RatesEntry, nowMs: number): boolean {
  return nowMs - entry.fetchedAt < RATES_USABLE_MS;
}

/**
 * Units of `to` per 1 unit of `from`, derived from one base's table.
 *
 * Both legs are quoted against the same base, so the cross rate is just their
 * ratio - which also means a single stored base covers every pair the picker
 * can produce. Returns null when either leg is missing or unusable, and the
 * caller leaves the field on manual entry.
 */
export function crossRate(entry: RatesEntry, from: string, to: string): number | null {
  if (from === to) return 1;
  const fromRate = entry.rates[from];
  const toRate = entry.rates[to];
  if (!Number.isFinite(fromRate) || !Number.isFinite(toRate)) return null;
  if (!fromRate || fromRate <= 0 || !toRate || toRate <= 0) return null;
  return toRate / fromRate;
}

/**
 * The rate as it goes into the text field. Six significant digits: enough that
 * a KRW rate (~0.0234) keeps its precision and a JPY one (~0.213) is not
 * rounded into visibly wrong territory, without pasting float noise into an
 * input the user is expected to be able to read and correct.
 */
export function formatExchangeRate(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return Number(value.toPrecision(6)).toString();
}

/**
 * The rate to pre-fill for `from` -> `to`, refreshing the stored table when it
 * has aged out. Resolves to null whenever there is nothing trustworthy to show
 * (no session, upstream down and no usable copy, unsupported pair) - the
 * caller's fallback is the manual field that existed before this.
 */
export async function loadCrossRate({
  base,
  from,
  to,
  fetchRates,
  now = () => Date.now(),
  storage = browserStorage(),
}: {
  base: string;
  from: string;
  to: string;
  fetchRates: (base: string) => Promise<ExchangeRatesResponse>;
  now?: () => number;
  storage?: RatesStorage | null;
}): Promise<{ rate: number; date: string } | null> {
  const cached = readRatesEntry(base, storage);

  if (cached && isEntryFresh(cached, now())) {
    const rate = crossRate(cached, from, to);
    return rate === null ? null : { rate, date: cached.date };
  }

  try {
    const response = await fetchRates(base);
    const entry: RatesEntry = {
      base: response.base,
      date: response.date,
      rates: response.rates,
      fetchedAt: now(),
    };
    writeRatesEntry(entry, storage);
    const rate = crossRate(entry, from, to);
    return rate === null ? null : { rate, date: entry.date };
  } catch {
    // Offline, or the upstream is down with nothing cached server-side. An
    // aged local copy still beats an empty field, up to RATES_USABLE_MS.
    if (cached && isEntryUsable(cached, now())) {
      const rate = crossRate(cached, from, to);
      return rate === null ? null : { rate, date: cached.date };
    }
    return null;
  }
}
