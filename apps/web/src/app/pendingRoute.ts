const PENDING_ROUTE_KEY = "equo.clean.pending_route";

/**
 * Only a group deep link is worth restoring, and only in the exact shape
 * useGroupRoute writes. Anything else - a full URL, a protocol-relative "//evil",
 * a path with a query or fragment - is refused rather than trusted, so a
 * tampered storage value can never turn into a navigation target.
 */
function isRestorableRoute(path: string): boolean {
  return /^\/group\/[^/?#]+$/.test(path);
}

/**
 * Remember where the user was headed before the OAuth round-trip.
 *
 * A shared link like /group/abc used to be lost: the login redirect always
 * returns to the origin, so after signing in you landed on your most recent
 * group instead of the one you were invited to look at. The token is stashed
 * here rather than passed as `redirect_to` because every distinct redirect URL
 * has to be in Supabase's allowlist - a per-group URL never could be.
 * (?invite= already does the same thing; see useInviteFlow.)
 */
export function stashPendingRoute(path: string = window.location.pathname): void {
  if (!isRestorableRoute(path)) return;
  try {
    window.localStorage.setItem(PENDING_ROUTE_KEY, path);
  } catch {
    // Private mode / storage disabled: the deep link is simply not restored.
  }
}

/** Read and consume the stashed route. Empty when there is nothing valid to go back to. */
export function takePendingRoute(): string {
  try {
    const path = window.localStorage.getItem(PENDING_ROUTE_KEY) ?? "";
    window.localStorage.removeItem(PENDING_ROUTE_KEY);
    return isRestorableRoute(path) ? path : "";
  } catch {
    return "";
  }
}
