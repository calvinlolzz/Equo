import { UI_TEXT } from "./uiText";

/**
 * The lists the app renders itself from - expense categories and the currency
 * picker - now that they are rows in a table an admin can edit rather than
 * constants in this bundle.
 *
 * Shaped as a module-level value with getters rather than as React context for
 * one reason: the call sites are `UI_TEXT.categories[key]` lookups scattered
 * through the composer, the records list, the analysis donut and the console,
 * and threading a provider through all of them would be a large refactor to
 * deliver the same lookup. `hydrateCatalog` is called once by the app shell,
 * which re-renders below it, so every consumer picks the new values up on the
 * next paint.
 *
 * The bundled constants remain the fallback, and that matters more than it
 * looks: a first paint, an offline start and a failed request all render the
 * categories the build shipped with instead of an empty picker.
 */

export type CatalogCategory = {
  /** The value stored in expenses.category. */
  key: string;
  label: string;
  /** Hex, used by the analysis donut. */
  color: string;
};

export type CatalogCurrency = {
  code: string;
  label: string;
};

export type Catalog = {
  categories: CatalogCategory[];
  currencies: CatalogCurrency[];
};

/** Colour for a category the server has never heard of. */
export const FALLBACK_CATEGORY_COLOR = "#93A0B5";

/**
 * Exactly what shipped in the bundle before this was a table, and exactly what
 * the migration seeds - so a deployment where the fetch fails looks identical
 * to one where it succeeds.
 */
export const DEFAULT_CATALOG: Catalog = {
  categories: [
    { key: "food", label: UI_TEXT.categories.food, color: "#F0885A" },
    { key: "transport", label: UI_TEXT.categories.transport, color: "#5B9BF0" },
    { key: "lodging", label: UI_TEXT.categories.lodging, color: "#8E7CF0" },
    { key: "shopping", label: UI_TEXT.categories.shopping, color: "#EC6FA6" },
    { key: "general", label: UI_TEXT.categories.general, color: "#4FC59A" },
    { key: "other", label: UI_TEXT.categories.other, color: FALLBACK_CATEGORY_COLOR },
  ],
  currencies: [
    { code: "TWD", label: UI_TEXT.currencies.twd },
    { code: "JPY", label: UI_TEXT.currencies.jpy },
    { code: "USD", label: UI_TEXT.currencies.usd },
    { code: "KRW", label: UI_TEXT.currencies.krw },
    { code: "EUR", label: UI_TEXT.currencies.eur },
  ],
};

const STORAGE_KEY = "equo.clean.catalog";

let active: Catalog = DEFAULT_CATALOG;

function isCatalog(value: unknown): value is Catalog {
  const candidate = value as Catalog | null;
  return Boolean(
    candidate &&
      Array.isArray(candidate.categories) &&
      Array.isArray(candidate.currencies) &&
      // An empty list is a valid answer from the server but a useless one to
      // render, so it is treated as "nothing stored" and the defaults win.
      candidate.categories.length > 0 &&
      candidate.currencies.length > 0,
  );
}

/**
 * Adopt a catalog and remember it.
 *
 * The stored copy is read back at startup so the first paint after a cold
 * start already has the admin's labels rather than the bundle's - the fetch
 * has not returned yet at that point, and a category list that visibly changes
 * a second after the sheet opens is worse than one that is briefly stale.
 */
export function hydrateCatalog(next: unknown): Catalog {
  if (!isCatalog(next)) return active;

  active = {
    categories: next.categories.map((entry) => ({
      key: entry.key,
      label: entry.label,
      color: entry.color || FALLBACK_CATEGORY_COLOR,
    })),
    currencies: next.currencies.map((entry) => ({ code: entry.code, label: entry.label })),
  };

  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(active));
  } catch {
    // Private mode / quota. The catalog is still live for this session.
  }

  return active;
}

/** Load the stored copy, if any. Safe to call before the first fetch. */
export function restoreCatalog(): Catalog {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed: unknown = JSON.parse(raw);
      if (isCatalog(parsed)) {
        active = parsed;
      }
    }
  } catch {
    // Unparseable or unavailable: the defaults are already in place.
  }

  return active;
}

/** Test seam: forget everything learned from the server. */
export function resetCatalog(): void {
  active = DEFAULT_CATALOG;
}

export function getCatalog(): Catalog {
  return active;
}

export function categoryOptions(): CatalogCategory[] {
  return active.categories;
}

/**
 * An expense may hold a category that has since been disabled or renamed away.
 * Its own key is a better answer than a blank, so unknown keys pass through.
 */
export function categoryLabel(key: string): string {
  return active.categories.find((entry) => entry.key === key)?.label ?? key;
}

export function categoryColor(key: string): string {
  return active.categories.find((entry) => entry.key === key)?.color ?? FALLBACK_CATEGORY_COLOR;
}

export function currencyOptions(): CatalogCurrency[] {
  return active.currencies;
}
