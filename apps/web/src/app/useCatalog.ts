import { useEffect, useState } from "react";
import type { EquoApiClient } from "./apiClient";
import { getCatalog, hydrateCatalog, restoreCatalog, type Catalog } from "./catalog";

/**
 * Keep the master-data lists current.
 *
 * Fetched once per session rather than polled: categories and currencies change
 * when somebody in the console decides they should, which is rare enough that
 * "next time you open the app" is soon enough, and a picker whose options move
 * while a sheet is open would be worse than stale.
 *
 * Returns the catalog so the component tree re-renders when it arrives; the
 * lookups themselves go through catalog.ts, which every call site already
 * reaches directly.
 */
export function useCatalog(client: EquoApiClient | null, enabled: boolean): Catalog {
  // Seeded from the stored copy so the first paint after a cold start already
  // has the admin's labels instead of the bundle's.
  const [catalog, setCatalog] = useState<Catalog>(() => restoreCatalog());

  useEffect(() => {
    if (!client || !enabled) return;
    let cancelled = false;

    client
      .getCatalog()
      .then((next) => {
        if (cancelled) return;
        setCatalog(hydrateCatalog(next));
      })
      .catch(() => {
        // Fail-silent: the bundled defaults (or the stored copy) are already
        // rendering, and there is nothing a user could do about this.
        if (!cancelled) setCatalog(getCatalog());
      });

    return () => {
      cancelled = true;
    };
  }, [client, enabled]);

  return catalog;
}
