import { readRouteGroupId } from "./useGroupRoute";

const PENDING_ROUTE_KEY = "equo.clean.pending_route";

/**
 * Carries the group a signed-out visitor was trying to open across the OAuth
 * round-trip.
 *
 * Someone shares `/group/abc`; the recipient isn't signed in, hits the wall,
 * and comes back from Supabase at the bare origin — the path is gone, and they
 * land on whichever group happens to be most recent instead of the one they
 * were sent. Stashing it locally (rather than widening the OAuth `redirect_to`)
 * keeps this working without touching the Supabase redirect allowlist, and
 * mirrors how `?invite=` already survives the same round-trip.
 */
export function stashPendingRoute(): void {
  try {
    const groupId = readRouteGroupId();
    if (groupId) window.localStorage.setItem(PENDING_ROUTE_KEY, groupId);
  } catch {
    // Storage unavailable (private mode / blocked cookies) - the deep link is
    // a nicety, never a reason to block the login itself.
  }
}

/**
 * The stashed group id, WITHOUT consuming it.
 *
 * Deliberately not read-and-clear: the routing effect runs once before the
 * group list has arrived, and a consuming read there would throw the stash
 * away before it could ever match — sending the visitor to their most-recent
 * group instead of the one they were linked to. The caller clears it via
 * clearPendingRoute once it has actually decided what to do with it.
 */
export function readPendingRoute(): string {
  try {
    return window.localStorage.getItem(PENDING_ROUTE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function clearPendingRoute(): void {
  try {
    window.localStorage.removeItem(PENDING_ROUTE_KEY);
  } catch {
    // Nothing to do — a stash we cannot clear is guarded by the membership
    // check at the use site anyway.
  }
}
