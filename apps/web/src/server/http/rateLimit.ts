import type { PostgrestClient } from "../db/postgrestClient.js";
import { verifySessionToken } from "../auth/sessionToken.js";
import { getAuthToken, getClientIp, type HttpRuntimeRequest } from "./httpTypes.js";
import { rateLimitBucket, resolveRateLimitRule } from "./rateLimitPolicy.js";

export type RateLimitDecision = { allowed: true } | { allowed: false; retryAfterSeconds: number };

const ALLOWED: RateLimitDecision = { allowed: true };

/**
 * Who to charge this request to.
 *
 * Only the locally-signed session token is checked, never the Google fallback
 * the routes accept: this runs on every write, and verifying a session is pure
 * HMAC with no I/O, whereas the Google path is a network call. A request that
 * only carries a Google id token therefore charges its IP instead of its user,
 * which is the safe direction to be wrong in.
 */
function identify(request: HttpRuntimeRequest, sessionSecret: string | undefined, now?: number) {
  const token = getAuthToken(request);
  const identity = sessionSecret && token ? verifySessionToken(token, sessionSecret, now) : null;

  return { userId: identity?.resolved_user_id ?? null, ip: getClientIp(request) };
}

/**
 * Counts this request against its bucket and says whether to serve it.
 *
 * Fails OPEN. If the counter is unreachable the database is already in trouble,
 * and turning a database blip into a site-wide 429 would be a far worse outage
 * than the flood this is guarding against. The failure is logged rather than
 * swallowed, so a limiter that has quietly stopped limiting is visible.
 */
export async function enforceRateLimit(
  options: { client: PostgrestClient; sessionSecret?: string; now?: number },
  request: HttpRuntimeRequest,
): Promise<RateLimitDecision> {
  const rule = resolveRateLimitRule(request.method, request.path);
  if (!rule) return ALLOWED;

  const bucket = rateLimitBucket(rule, identify(request, options.sessionSecret, options.now));
  if (!bucket) return ALLOWED;

  try {
    const result = await options.client.rpc<{ allowed?: boolean; retry_after?: number }>("consume_rate_limit", {
      p_bucket: bucket,
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });

    if (result?.allowed === false) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(result.retry_after ?? rule.windowSeconds)) };
    }

    return ALLOWED;
  } catch (error) {
    console.error(`[rate_limit] bucket "${rule.name}" could not be counted, allowing request:`, error);
    return ALLOWED;
  }
}
