/**
 * URL and storage helpers for the LINE account-link page (/line/link).
 *
 * The linkToken has to survive a Google OAuth round trip exactly like an
 * invite token does (see useInviteFlow.ts) - Supabase's redirect_to is the
 * bare origin, not /line/link, so the token is stashed in sessionStorage
 * before the redirect and the page bounces back to /line/link once a session
 * exists (see useAuthSession.ts's resumePendingLineLink call).
 */

export const LINE_LINK_PATH = "/line/link";

/** Tolerates a trailing slash and any case, same as resolvePublicPage. */
export function isLineLinkPath(pathname: string): boolean {
  return pathname.replace(/\/+$/, "").toLowerCase() === LINE_LINK_PATH;
}

/** Mirrors the server's LINK_TOKEN_PATTERN in server/routes/lineRoutes.ts. */
export const LINE_LINK_TOKEN_PATTERN = /^[A-Za-z0-9._~-]{8,256}$/;

export function readLinkTokenFromSearch(search: string): string {
  const token = new URLSearchParams(search).get("linkToken") ?? "";
  return LINE_LINK_TOKEN_PATTERN.test(token) ? token : "";
}

const PENDING_LINE_LINK_KEY = "equo.clean.pending_line_link";
const PENDING_LINE_LINK_TTL_MS = 10 * 60 * 1000;

type PendingLineLink = { linkToken: string; savedAt: number };

export function stashPendingLineLink(linkToken: string, now: number): void {
  try {
    window.sessionStorage.setItem(PENDING_LINE_LINK_KEY, JSON.stringify({ linkToken, savedAt: now }));
  } catch {
    // Storage blocked (private mode, quota). The token still works from the
    // URL for this same tab; it just won't survive the OAuth round trip.
  }
}

/** The stashed token, or "" when there is none, it's unreadable, or it's older than 10 minutes. */
export function readPendingLineLink(now: number): string {
  try {
    const raw = window.sessionStorage.getItem(PENDING_LINE_LINK_KEY);
    if (!raw) return "";

    const parsed = JSON.parse(raw) as Partial<PendingLineLink>;
    if (typeof parsed.linkToken !== "string" || typeof parsed.savedAt !== "number") return "";
    if (now - parsed.savedAt > PENDING_LINE_LINK_TTL_MS) return "";

    return LINE_LINK_TOKEN_PATTERN.test(parsed.linkToken) ? parsed.linkToken : "";
  } catch {
    return "";
  }
}

export function clearPendingLineLink(): void {
  try {
    window.sessionStorage.removeItem(PENDING_LINE_LINK_KEY);
  } catch {
    // Nothing to clean up if storage isn't reachable.
  }
}

type MinimalLocation = { replace: (url: string) => void };

/**
 * Called once on boot after a session is established (useAuthSession.ts).
 * Bounces back to /line/link when a fresh stash exists, so the OAuth
 * round trip that started there finishes there. Returns true when it did, so
 * the caller can skip the rest of its own post-login work (toast, etc.) -
 * the page is about to navigate away anyway.
 */
export function resumePendingLineLink(now: number, location: MinimalLocation = window.location): boolean {
  if (!readPendingLineLink(now)) return false;
  location.replace(LINE_LINK_PATH);
  return true;
}

const LINE_OA_URL_PATTERN = /^https:\/\/(lin\.ee|line\.me)\//;

/** The official-account add-friend URL, or "" when unset or not a recognised LINE host. */
export function lineOaUrl(): string {
  const raw = import.meta.env.VITE_LINE_OA_URL ?? "";
  return LINE_OA_URL_PATTERN.test(raw) ? raw : "";
}

/** LINE's in-app browser blocks Google OAuth (disallowed_useragent) - detect it to show a hint instead of a dead-end sign-in button. */
export function isLineInAppBrowser(ua: string): boolean {
  return /\bLine\//i.test(ua);
}
