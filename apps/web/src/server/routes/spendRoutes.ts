import type { PostgrestClient } from "../db/postgrestClient.js";
import type { GoogleTokenVerifier } from "../auth/google.js";
import { buildAuthContext } from "../auth/routeContext.js";
import {
  createSupabasePersonalSharesRepository,
  createSupabaseSpendRepository,
} from "../repositories/supabaseSpendRepository.js";
import { handleGetPersonalGroupShares, handleGetSpendBreakdown } from "../handlers/spend.js";

type RouteOptions = {
  client: PostgrestClient;
  verifier: GoogleTokenVerifier;
  idToken: string;
};

/** GET /api/v1/groups/:groupId/spend-breakdown?kind=year|month&key=2026|2026-08 */
export async function getSpendBreakdownRoute(
  options: RouteOptions,
  groupId: string,
  query: { kind?: string; key?: string },
) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false as const, status: 401, body: auth.error };
  }

  return handleGetSpendBreakdown(createSupabaseSpendRepository(options.client), auth.context, groupId, query);
}

/** GET /api/v1/me/group-shares?month=YYYY-MM - read-only, so no view-as special case. */
export async function getPersonalGroupSharesRoute(options: RouteOptions, query: { month?: string }) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false as const, status: 401, body: auth.error };
  }

  return handleGetPersonalGroupShares(createSupabasePersonalSharesRepository(options.client), auth.context, query);
}
