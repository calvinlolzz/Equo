import { viewAsAdminId } from "../auth/sessionToken.js";
import { getCookieValue, type HttpRuntimeRequest } from "./httpTypes.js";

const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Looking at the app as somebody else, read-only.
 *
 * The whole design rests on one idea: a view-as token is shaped exactly like a
 * session, so every read path in the app resolves the target user without any
 * of them knowing this feature exists. Nothing had to learn about impersonation
 * to support it - which is also why the read-only half cannot be left to those
 * same paths, and lives here instead, in front of all of them.
 */

/** The view-as token on this request, if any. Its own cookie, never equo_session. */
export function viewAsToken(request: HttpRuntimeRequest): string {
  return getCookieValue(request, "equo_view_as");
}

/**
 * The admin behind this request, or null when it is an ordinary session.
 *
 * Returns null when there is no secret to check the signature with, which means
 * a deployment with no session secret cannot be talked into honouring a forged
 * view-as cookie.
 */
export function viewingAs(request: HttpRuntimeRequest, sessionSecret: string | undefined, now?: number): string | null {
  const token = viewAsToken(request);
  if (!token || !sessionSecret) return null;
  return viewAsAdminId(token, sessionSecret, now);
}

/**
 * Whether to refuse this request because it would write while viewing as
 * somebody else.
 *
 * **Fails CLOSED**, unlike the maintenance gate next to it. The difference is
 * what an error would cost: maintenance guessing wrong stops everybody working,
 * so it opens; this guessing wrong writes to a stranger's ledger under their
 * name, so it shuts. Anything that is not provably an ordinary session, on a
 * write, is refused.
 *
 * Every write is covered, including the admin console's own: an admin who is
 * mid-view-as is holding somebody else's identity, and "disable this user"
 * issued from inside that is a confusing thing to have in an audit log even
 * when the console would have allowed it anyway. Leave the view first.
 */
export function blocksWrite(request: HttpRuntimeRequest): boolean {
  if (!WRITE_METHODS.has(request.method)) return false;
  // No cookie at all is the overwhelmingly common case and is not view-as.
  if (!viewAsToken(request)) return false;
  // Leaving the view is a DELETE, and it carries the very cookie this gate
  // reacts to - so without this exemption the exit is the one door the mode
  // locks. Same shape of mistake as a maintenance mode that blocks its own
  // off switch; it just hides better, because everything else works.
  if (isStopViewAs(request)) return false;
  // A cookie that is present but does not verify is refused rather than
  // ignored: it is either expired (in which case the reads are failing too and
  // a write should not sneak through) or forged.
  return true;
}

function isStopViewAs(request: HttpRuntimeRequest): boolean {
  return request.method === "DELETE" && request.path === "/api/v1/admin/view-as";
}
