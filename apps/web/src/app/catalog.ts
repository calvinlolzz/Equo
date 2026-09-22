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

/**
 * Which ledger kind and composer mode a category is offered on.
 * "shared" = ordinary group expenses, "personal" = personal-ledger expenses
 * (offered alongside "shared" there), "income" = personal-ledger income only.
 * See categoryOptionsFor.
 */
export type CatalogScope = "shared" | "personal" | "income";

export type CatalogCategory = {
  /** The value stored in expenses.category. */
  key: string;
  label: string;
  /** Hex, used by the analysis donut. */
  color: string;
  scope: CatalogScope;
};

/**
 * Anything that isn't a recognised scope becomes "shared" - the conservative
 * default, and the one every category had before this column existed. Covers
 * three real cases: a category from a server predating the category_scope
 * migration (field absent), a copy in localStorage saved before this client
 * shipped (same), and any value neither the server nor this client invented.
 */
export function normalizeScope(value: unknown): CatalogScope {
  return value === "personal" || value === "income" ? value : "shared";
}

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
    { key: "food", label: UI_TEXT.categories.food, color: "#F0885A", scope: "shared" },
    { key: "transport", label: UI_TEXT.categories.transport, color: "#5B9BF0", scope: "shared" },
    { key: "lodging", label: UI_TEXT.categories.lodging, color: "#8E7CF0", scope: "shared" },
    { key: "shopping", label: UI_TEXT.categories.shopping, color: "#EC6FA6", scope: "shared" },
    { key: "general", label: UI_TEXT.categories.general, color: "#4FC59A", scope: "shared" },
    { key: "other", label: UI_TEXT.categories.other, color: FALLBACK_CATEGORY_COLOR, scope: "shared" },
    // Personal ledger expense categories - see
    // supabase/migrations/20260922090100_category_scope.sql, which this must
    // match key-for-key, colour-for-colour, order-for-order (catalogSeed.test.ts).
    { key: "entertainment", label: UI_TEXT.categories.entertainment, color: "#F2B84B", scope: "personal" },
    { key: "home", label: UI_TEXT.categories.home, color: "#3FB6B2", scope: "personal" },
    { key: "bills", label: UI_TEXT.categories.bills, color: "#6B7FD7", scope: "personal" },
    { key: "health", label: UI_TEXT.categories.health, color: "#E5646E", scope: "personal" },
    { key: "education", label: UI_TEXT.categories.education, color: "#A3C95A", scope: "personal" },
    // Personal ledger income categories.
    { key: "salary", label: UI_TEXT.categories.salary, color: "#3DBE8B", scope: "income" },
    { key: "bonus", label: UI_TEXT.categories.bonus, color: "#F0C24B", scope: "income" },
    { key: "investment", label: UI_TEXT.categories.investment, color: "#5AA9E6", scope: "income" },
    { key: "other_income", label: UI_TEXT.categories.other_income, color: "#9AA8BC", scope: "income" },
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
      // A server predating the category_scope migration sends no scope field
      // at all - normalizeScope reads that the same way it reads any other
      // unrecognised value, as "shared".
      scope: normalizeScope((entry as { scope?: unknown }).scope),
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
        // A copy written to localStorage before this client shipped has no
        // per-category scope at all - same normalization as hydrateCatalog,
        // so a cold start from an old stored copy doesn't read every category
        // as personal-or-income just because "scope" happens to be undefined.
        active = {
          categories: parsed.categories.map((entry) => ({
            key: entry.key,
            label: entry.label,
            color: entry.color,
            scope: normalizeScope((entry as { scope?: unknown }).scope),
          })),
          currencies: parsed.currencies,
        };
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
 * The category picker's options for a given ledger kind and composer mode.
 *
 *   - a shared group only ever offers "shared" categories;
 *   - a personal ledger recording an expense offers "shared" AND "personal"
 *     (its expenses aren't a different kind of spending, just untagged as
 *     group-only - see the plan's §4g);
 *   - a personal ledger recording income offers only "income" categories.
 *
 * Falls back to the matching DEFAULT_CATALOG rows when the active catalog has
 * none for the requested scope set - an old server (pre category_scope
 * migration) or an old stored copy would otherwise hand a personal-ledger
 * income entry an empty picker instead of the bundled categories.
 */
export function categoryOptionsFor(options: { personal: boolean; mode?: "expense" | "income" }): CatalogCategory[] {
  const scopes: CatalogScope[] = !options.personal
    ? ["shared"]
    : options.mode === "income"
      ? ["income"]
      : ["shared", "personal"];

  const matches = active.categories.filter((entry) => scopes.includes(entry.scope));
  if (matches.length > 0) return matches;

  return DEFAULT_CATALOG.categories.filter((entry) => scopes.includes(entry.scope));
}

/** The category a fresh composer draft starts with, for this ledger kind/mode. */
export function defaultCategoryKey(options: { personal: boolean; mode?: "expense" | "income" }): string {
  return options.personal && options.mode === "income" ? "other_income" : "general";
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
