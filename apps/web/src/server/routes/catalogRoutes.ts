import type { PostgrestClient } from "../db/postgrestClient.js";
import type { GoogleTokenVerifier } from "../auth/google.js";
import { buildAuthContext } from "../auth/routeContext.js";
import { createSupabaseCatalogRepository } from "../repositories/supabaseCatalogRepository.js";
import type { CatalogRecord } from "../repositories/catalogRepository.js";

type RouteOptions = {
  client: PostgrestClient;
  verifier: GoogleTokenVerifier;
  idToken: string;
};

/**
 * GET /api/v1/catalog - the category and currency lists.
 *
 * Authenticated like everything else, not because the contents are sensitive
 * (they are six category names) but because the app is behind a login wall
 * anyway, so an unauthenticated variant would be a second code path with no
 * caller.
 *
 * The client keeps a copy and falls back to the constants it was built with,
 * so a failure here is invisible - which is why there is no error body worth
 * shaping.
 */
export async function getCatalogRoute(
  options: RouteOptions,
): Promise<{ ok: true; status: number; body: CatalogRecord } | { ok: false; status: number; body: unknown }> {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  const catalog = await createSupabaseCatalogRepository(options.client).getCatalog();
  return { ok: true, status: 200, body: catalog };
}
