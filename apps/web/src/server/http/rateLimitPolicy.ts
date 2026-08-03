/**
 * Which requests are capped, how hard, and what the counter is keyed by.
 *
 * Reads are deliberately absent. Every GET is behind the session wall and
 * group membership, and capping them would add a database round-trip to the
 * app's hottest path in exchange for very little: volumetric read abuse is
 * what Vercel Firewall is for. What is capped is everything that WRITES, plus
 * the two doors an attacker can reach without an account.
 */
export type RateLimitScope = "user" | "ip";

export type RateLimitRule = {
  /**
   * Stable identifier, and the first segment of the bucket key. Renaming one
   * starts a fresh counter rather than silently merging two rules' traffic.
   */
  name: string;
  limit: number;
  windowSeconds: number;
  /**
   * What to key the counter by. "user" falls back to the client IP when the
   * request carries no valid session — an unauthenticated caller is going to
   * be turned away by the route anyway, and until then it must not get an
   * uncapped free ride.
   */
  scope: RateLimitScope;
};

const HOUR = 3_600;
const MINUTE = 60;

/**
 * Anonymous error intake. The browser reporter already caps itself at 5 per
 * page load (see app/errorReporter.ts), so a genuine client stays far under
 * this even while crash-looping; anything near it is not a real browser.
 */
const ERRORS: RateLimitRule = { name: "errors", limit: 30, windowSeconds: HOUR, scope: "ip" };

/**
 * Login token exchange. Tight, and keyed by IP because there is by definition
 * no session yet: this is the one endpoint where an attacker gets to test
 * credentials.
 */
const AUTH: RateLimitRule = { name: "auth", limit: 20, windowSeconds: 10 * MINUTE, scope: "ip" };

/** Human-speed by nature — nobody files ten support notes an hour. */
const FEEDBACK: RateLimitRule = { name: "feedback", limit: 10, windowSeconds: HOUR, scope: "user" };

/**
 * The catch-all for every remaining mutation. Set well above what the UI can
 * produce (each one costs a deliberate tap) but far below what a script can:
 * the point is to bound the damage of a runaway client or a logged-in abuser,
 * not to police normal bursts like adding several expenses in a row.
 */
const WRITE: RateLimitRule = { name: "write", limit: 120, windowSeconds: MINUTE, scope: "user" };

/**
 * Receipt recognition. Its own bucket because it is the one endpoint whose cost
 * is a per-call charge to an upstream model rather than a row in Postgres — the
 * shared write budget of 120/minute would be an expensive thing to leave open.
 * Well clear of a real session (nobody photographs thirty receipts an hour) and
 * far below what a script could spend.
 */
const RECEIPT_SCAN: RateLimitRule = { name: "receiptScan", limit: 30, windowSeconds: HOUR, scope: "user" };

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * The rule for a request, or null when it isn't capped.
 *
 * Matched on method and path alone — deliberately independent of whether the
 * route exists, so probing for unknown endpoints is capped by the same budget
 * as using real ones.
 */
export function resolveRateLimitRule(method: string, path: string): RateLimitRule | null {
  if (!WRITE_METHODS.has(method)) return null;

  if (path === "/api/v1/errors") return ERRORS;
  if (path.startsWith("/api/v1/auth/")) return AUTH;
  if (path === "/api/v1/feedback") return FEEDBACK;
  if (path === "/api/v1/receipts/scan") return RECEIPT_SCAN;

  return WRITE;
}

/**
 * The counter key. Rule name first so one identity's budgets stay separate:
 * hitting the feedback cap must not also lock the user out of recording
 * expenses.
 */
export function rateLimitBucket(rule: RateLimitRule, identity: { userId: string | null; ip: string }): string | null {
  if (rule.scope === "user" && identity.userId) {
    return `${rule.name}:u:${identity.userId}`;
  }
  // No IP means no honest way to tell callers apart — lumping them into one
  // shared bucket would let a single abuser lock out everyone else. Vercel
  // always sets x-forwarded-for in production, so this is local/test only.
  if (!identity.ip) return null;

  return `${rule.name}:ip:${identity.ip}`;
}
