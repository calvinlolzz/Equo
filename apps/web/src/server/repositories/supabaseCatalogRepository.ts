import type { PostgrestClient } from "../db/postgrestClient.js";
import type { CatalogRecord, CatalogRepository } from "./catalogRepository.js";

export function createSupabaseCatalogRepository(client: PostgrestClient): CatalogRepository {
  return {
    getCatalog() {
      return client.rpc<CatalogRecord>("app_catalog", {});
    },

    async getRateOverrides(base) {
      const overrides = await client.rpc<Record<string, number> | null>("exchange_rate_overrides_for", {
        p_base: base,
      });
      return overrides ?? {};
    },
  };
}
