/**
 * How much of the screen the on-screen keyboard is covering, as a CSS variable.
 *
 * Every bottom sheet in the app is sized against `dvh`, which is the right unit
 * for the browser's own retracting toolbars and handles them for free. It does
 * NOT handle the keyboard, and the two platforms disagree about that in a way
 * that is easy to miss:
 *
 *  - Android Chrome resizes the layout viewport when the keyboard opens, so
 *    `dvh` shrinks with it and a sheet sized in `dvh` already fits. Nothing to
 *    do — and the measurement below correctly reports ~0 there.
 *  - iOS Safari does not. `dvh` stays the height of the whole screen, so a
 *    full-height sheet keeps its bottom edge underneath the keyboard, taking
 *    the composer's 下一步/儲存 button with it. The stepped composer pins that
 *    button to the bottom of the sheet precisely so it is always reachable,
 *    which is exactly the thing the keyboard then hides.
 *
 * The visual viewport is the only API that reports this, so it is measured and
 * published as `--keyboard-inset` on <html> for the stylesheet to subtract.
 * Nothing here decides what to do about it; that is a CSS question.
 */

/** Below this, it is rounding noise or a toolbar, not a keyboard. */
const MIN_MEANINGFUL_PX = 24;

export type ViewportMetrics = {
  /** window.innerHeight — the layout viewport. */
  innerHeight: number;
  /** visualViewport.height — what is actually visible. */
  viewportHeight: number;
  /** visualViewport.offsetTop — iOS scrolls the visual viewport to reveal a focused field. */
  offsetTop: number;
};

/**
 * The number of pixels hidden below the visible viewport.
 *
 * Clamped at zero and rounded: a negative result (which browsers do produce
 * transiently mid-animation) would grow the sheet rather than shrink it, and
 * sub-pixel jitter on every scroll event would be a layout thrash for no
 * visible gain.
 */
export function keyboardOverlap({ innerHeight, viewportHeight, offsetTop }: ViewportMetrics): number {
  const overlap = Math.round(innerHeight - (viewportHeight + offsetTop));
  return overlap >= MIN_MEANINGFUL_PX ? overlap : 0;
}

/**
 * The seam, narrowed to what is actually used (same shape as autoSync's
 * injectable document/window): the real `VisualViewport` type carries the full
 * overloaded EventTarget signature, which nothing here needs and no test double
 * can satisfy without pretending to be a DOM object.
 */
export type VisualViewportLike = {
  height: number;
  offsetTop: number;
  addEventListener: (type: "resize" | "scroll", listener: () => void) => void;
  removeEventListener: (type: "resize" | "scroll", listener: () => void) => void;
};

/**
 * Start publishing `--keyboard-inset`. Returns a teardown.
 *
 * A browser with no visualViewport (and any non-browser environment) gets a
 * no-op: the variable is simply never set, and every `var(--keyboard-inset, 0px)`
 * in the stylesheet falls back to its zero default. That is also the correct
 * behaviour for desktop, where there is no keyboard to make room for.
 */
export function installKeyboardInset(
  viewport: VisualViewportLike | null = typeof window === "undefined" ? null : window.visualViewport,
  root: HTMLElement | null = typeof document === "undefined" ? null : document.documentElement,
): () => void {
  if (!viewport || !root) return () => {};

  let published = -1;

  const measure = () => {
    const inset = keyboardOverlap({
      innerHeight: window.innerHeight,
      viewportHeight: viewport.height,
      offsetTop: viewport.offsetTop,
    });
    // Write only on change: `scroll` on the visual viewport fires continuously
    // while the keyboard animates in, and re-setting an identical value would
    // invalidate style on every one of those frames.
    if (inset === published) return;
    published = inset;
    root.style.setProperty("--keyboard-inset", `${inset}px`);
  };

  measure();
  viewport.addEventListener("resize", measure);
  // iOS reports a focused field being scrolled into view as a visual-viewport
  // scroll, not a resize, and that shifts offsetTop - so both are needed.
  viewport.addEventListener("scroll", measure);

  return () => {
    viewport.removeEventListener("resize", measure);
    viewport.removeEventListener("scroll", measure);
    root.style.removeProperty("--keyboard-inset");
  };
}
