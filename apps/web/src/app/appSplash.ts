/**
 * Taking down the launch screen (the markup and animation live in index.html).
 *
 * The splash exists to cover the stretch before this bundle has run at all, so
 * the only thing left for the bundle to do is get rid of it — once, and only
 * once there is something painted behind it.
 */

const SPLASH_ID = "app-splash";

/** Matches the transition in index.html; the timer below is its safety net. */
const FADE_MS = 260;

/**
 * Fade the splash out and remove it.
 *
 * The node is removed rather than left faded: a `position: fixed; inset: 0`
 * element that is merely transparent is still in the tree, and leaving it there
 * is how a launch screen turns into an invisible sheet of glass over the app.
 * (It carries `pointer-events: none` for that reason too — belt and braces.)
 *
 * Removal is driven by transitionend with a timer behind it, because
 * transitionend does not fire when the transition never runs: the element may
 * already be hidden by the CSS give-up backstop, the tab may be in the
 * background, or the user may have reduced motion down to nothing.
 *
 * Safe to call more than once, and safe to call when there is no splash at all
 * (the admin console renders into the same document without one).
 */
export function dismissAppSplash(doc: Document = document): void {
  const splash = doc.getElementById(SPLASH_ID);
  if (!splash) return;

  splash.classList.add("is-ready");

  const remove = () => splash.remove();
  splash.addEventListener("transitionend", remove, { once: true });
  setTimeout(remove, FADE_MS + 200);
}
