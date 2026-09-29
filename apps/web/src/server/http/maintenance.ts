import type { PostgrestClient } from "../db/postgrestClient.js";

export type SiteNotice = {
  banner: {
    message: string;
    level: "info" | "warning";
    ends_at: string | null;
    /** Whether to show it right now. The server decides, not the client. */
    active: boolean;
  };
  maintenance: {
    enabled: boolean;
    message: string;
  };
};

export const SITE_NOTICE_DEFAULT: SiteNotice = {
  banner: { message: "", level: "info", ends_at: null, active: false },
  maintenance: { enabled: false, message: "" },
};

/**
 * How long a fetched notice is trusted before asking again.
 *
 * Every write request consults this, so reading it from the database each time
 * would put a round trip in front of every expense anybody records. 30 seconds
 * caps that at roughly two reads a minute per warm instance.
 *
 * The cost is that turning maintenance ON takes up to 30s to reach every
 * instance, and turning it OFF likewise. That is the right way round for a
 * planned window (you switch it on, wait, then start work) and acceptable for
 * an unplanned one. It is stated in docs/OPERATIONS.md so nobody starts a
 * migration the instant the toggle flips.
 */
const NOTICE_CACHE_MS = 30_000;

let cached: { at: number; notice: SiteNotice } | null = null;

/** Test seam: drop the cache so a test does not inherit the previous one. */
export function resetSiteNoticeCache(): void {
  cached = null;
}

function normalise(value: unknown): SiteNotice {
  const raw = (value ?? {}) as Partial<SiteNotice>;
  const banner = (raw.banner ?? {}) as Partial<SiteNotice["banner"]>;
  const maintenance = (raw.maintenance ?? {}) as Partial<SiteNotice["maintenance"]>;

  return {
    banner: {
      message: typeof banner.message === "string" ? banner.message : "",
      level: banner.level === "warning" ? "warning" : "info",
      ends_at: typeof banner.ends_at === "string" ? banner.ends_at : null,
      active: banner.active === true,
    },
    maintenance: {
      enabled: maintenance.enabled === true,
      message: typeof maintenance.message === "string" ? maintenance.message : "",
    },
  };
}

/**
 * The current notice, cached.
 *
 * **Fails open**: if the settings read throws, this returns the default, which
 * has maintenance off. The alternative — treating an unreachable database as
 * "we must be in maintenance" — would turn a blip in one query into a total
 * write outage, and would do it at exactly the moment nobody can use the admin
 * console to argue otherwise. Same posture as the rate limiter.
 */
export async function loadSiteNotice(
  client: Pick<PostgrestClient, "rpc" | "select">,
  now = Date.now(),
): Promise<SiteNotice> {
  if (cached && now - cached.at < NOTICE_CACHE_MS) {
    return cached.notice;
  }

  let notice = SITE_NOTICE_DEFAULT;
  try {
    notice = normalise(await client.rpc<unknown>("site_notice_settings", {}));
  } catch (error) {
    console.warn("[site-notice] settings unavailable, treating as no notice:", error);
  }

  cached = { at: now, notice };
  return notice;
}

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Paths that keep working while maintenance is on.
 *
 * The admin console is the important one and the reason this list exists at
 * all: a maintenance mode that blocks the endpoint used to switch it off is a
 * door that locks from the inside. Auth is on the list for the same reason -
 * the person who needs to reach /admin may not be signed in yet.
 *
 * Crash reports stay open because maintenance is exactly when you want to know
 * what is breaking, and a report is a row nobody reads twice.
 */
function isExempt(method: string, path: string): boolean {
  return (
    path.startsWith("/api/v1/admin") ||
    path.startsWith("/api/v1/auth/") ||
    path === "/api/v1/errors" ||
    path === "/api/v1/site-notice" ||
    // Unlinking LINE. Only the DELETE: starting a link (POST .../link) is a
    // write like any other and stays blocked. Being able to disconnect is a
    // LINE platform requirement, and it removes this feature's own rows
    // rather than touching the ledger, so it cannot get in a migration's way.
    (method === "DELETE" && path === "/api/v1/me/line")
  );
}

/**
 * Whether this request should be turned away for maintenance.
 *
 * Reads are always allowed. The point of this mode is to stop the ledger
 * changing under a migration, not to take the site down: somebody who opens the
 * app to check what they owe can still do that, and sees the banner explaining
 * why they cannot record anything.
 */
export function blocksRequest(notice: SiteNotice, method: string, path: string): boolean {
  if (!notice.maintenance.enabled) return false;
  if (!WRITE_METHODS.has(method)) return false;
  return !isExempt(method, path);
}
