import { Analytics } from "@vercel/analytics/react";
import { isLineLinkPath } from "./lineLink";
import { isLiffPath } from "./liff/liffPath";

/**
 * Whether page-view analytics may run on this path.
 *
 * Not on /line/link (the linkToken query parameter) and not on /liff (entry
 * keys in the query, and LINE's own tokens can sit in the fragment while its
 * SDK finishes signing in). A beacon can fire before the page has cleaned its
 * address bar, so the only safe answer is not to load the script at all.
 */
export function analyticsAllowedOn(pathname: string): boolean {
  return !isLineLinkPath(pathname) && !isLiffPath(pathname);
}

/** The page-view script, or nothing. See analyticsAllowedOn. */
export function PageAnalytics({ pathname }: { pathname: string }) {
  return analyticsAllowedOn(pathname) ? <Analytics /> : null;
}
