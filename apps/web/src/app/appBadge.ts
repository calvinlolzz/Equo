/**
 * The count on the installed app's home-screen icon (Badging API).
 *
 * The app already knows how much is unread — the bell shows a number and the
 * group rail shows a dot — but that knowledge died at the edge of the window:
 * an installed Equo sitting on a home screen looked identical whether three
 * people had recorded something or nobody had. This puts the same number on the
 * icon, which is the only surface a closed app still owns.
 *
 * Deliberately fire-and-forget. Every call is best-effort decoration:
 *
 *  - Unsupported browsers (all of desktop Firefox, Safari outside standalone)
 *    simply have no method to call, and a missing badge must never be an error
 *    the caller has to think about.
 *  - iOS honours the API only for an installed PWA that has been granted
 *    notification permission, and *rejects* otherwise. That rejection is
 *    routine, not a fault, so it is swallowed rather than reported.
 *
 * The service worker sets the badge too, on push (see sw.js) — that is what
 * keeps it current while the app is closed. This module is the authority
 * whenever the app is actually open: it writes the exact number and, just as
 * importantly, clears it the moment the inbox is read.
 */

/** The slice of `navigator` this uses; both methods are optional by design. */
export type BadgeNavigator = {
  setAppBadge?: (count?: number) => Promise<void> | void;
  clearAppBadge?: () => Promise<void> | void;
};

function defaultNavigator(): BadgeNavigator | null {
  return typeof navigator === "undefined" ? null : (navigator as BadgeNavigator);
}

/**
 * Show `count` on the app icon, or take the badge off entirely when there is
 * nothing to show.
 *
 * Zero clears rather than badging "0": a badge is a claim that something is
 * waiting, and a dot reading zero is a worse lie than no dot at all. Negative
 * and non-finite counts are treated the same as zero — a NaN slipping in from
 * an arithmetic edge case should blank the badge, never render as one.
 */
export function syncAppBadge(count: number, nav: BadgeNavigator | null = defaultNavigator()): void {
  if (!nav) return;

  const safe = Number.isFinite(count) ? Math.max(Math.floor(count), 0) : 0;

  try {
    if (safe > 0) {
      // Promise-returning on every browser that implements it, but typed as
      // possibly-void here (and some polyfills are), hence the guarded catch.
      void Promise.resolve(nav.setAppBadge?.(safe)).catch(() => {});
    } else {
      void Promise.resolve(nav.clearAppBadge?.()).catch(() => {});
    }
  } catch {
    // A synchronous throw (an implementation that rejects by throwing, or a
    // locked-down WebView) is the same non-event as an unsupported browser.
  }
}
