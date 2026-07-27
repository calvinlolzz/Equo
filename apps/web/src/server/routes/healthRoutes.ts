import { columns, limit, query, type PostgrestClient } from "../db/postgrestClient.js";

type RouteOptions = { client: PostgrestClient; now?: number };

export type HealthResult = {
  status: number;
  body: { status: "ok" | "degraded"; database: "ok" | "down" };
};

/**
 * How long a probe result is reused. This endpoint is unauthenticated by
 * necessity — an uptime monitor cannot log in — so without a cache anyone
 * could turn a monitoring URL into a database load generator. One probe per
 * window per instance costs nothing and is still far finer-grained than the
 * minute-scale interval monitors actually poll at.
 */
export const HEALTH_CACHE_MS = 10_000;

let cached: { at: number; result: HealthResult } | null = null;

/** Test seam: drop the memoised probe so each case starts cold. */
export function resetHealthCache(): void {
  cached = null;
}

/**
 * GET /api/v1/health — liveness for an external uptime monitor.
 *
 * Checks the database, not just the process: the front end is static and keeps
 * being served from the edge even when Supabase is unreachable or the free-tier
 * project has been auto-paused, so a monitor pointed at `/` would stay green
 * through exactly the outage worth paging about.
 *
 * Deliberately says nothing beyond up/down — no version, no counts, no
 * configuration — since it is world-readable.
 */
export async function healthRoute(options: RouteOptions): Promise<HealthResult> {
  const now = options.now ?? Date.now();

  if (cached && now - cached.at < HEALTH_CACHE_MS) {
    return cached.result;
  }

  let result: HealthResult;
  try {
    // Cheapest read that proves the whole path (PostgREST + Postgres + auth):
    // a single indexed column, capped at one row, no user data in the response.
    await options.client.select("users", query(columns("id"), limit(1)));
    result = { status: 200, body: { status: "ok", database: "ok" } };
  } catch (error) {
    console.error("[health] database probe failed:", error);
    // 503 rather than a 200 carrying {status:"degraded"} — monitors alert on
    // the status code, and a soft-200 outage is one nobody gets told about.
    result = { status: 503, body: { status: "degraded", database: "down" } };
  }

  cached = { at: now, result };
  return result;
}
