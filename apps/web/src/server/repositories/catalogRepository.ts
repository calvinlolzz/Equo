/**
 * Master data the app renders itself from: expense categories and the currency
 * picker's options.
 *
 * Read-only from the app's side. Everything that changes it lives in the admin
 * console (see AdminRepository's catalog methods), which is the whole point of
 * the table existing.
 */

export type CatalogCategoryRecord = {
  /** The value stored in expenses.category. */
  key: string;
  label: string;
  /** Hex, used by the analysis donut. */
  color: string;
};

export type CatalogCurrencyRecord = {
  code: string;
  label: string;
};

export type CatalogRecord = {
  categories: CatalogCategoryRecord[];
  currencies: CatalogCurrencyRecord[];
};

export type CatalogRepository = {
  /** Enabled rows only, in display order. */
  getCatalog(): Promise<CatalogRecord>;
  /**
   * Manual rates for one base, as { quote: rate }. Empty when nothing has been
   * overridden, which is the normal case.
   */
  getRateOverrides(base: string): Promise<Record<string, number>>;
};
