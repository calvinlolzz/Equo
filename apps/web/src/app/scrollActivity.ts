/** Set on <html> while a scroll is in flight, cleared once it settles. */
export const SCROLLING_ATTR = "data-scrolling";

/** How long after the last scroll event the page counts as still again. */
export const SETTLE_MS = 140;

/**
 * Tell the page when a finger is moving it.
 *
 * There is one thing this app can do that is far more expensive than anything
 * else, and scrolling is exactly when it happens: a `backdrop-filter` has to
 * re-sample and re-blur everything behind an element at its NEW position, every
 * frame. On the group home, 90% of the viewport is inside a blurred surface, so
 * a flick asks the GPU for a 24px gaussian over nearly the whole screen at the
 * display's refresh rate — 120Hz on the phones where this was reported.
 *
 * So the CSS drops the blur (keeping the saturation, which is a per-pixel
 * multiply rather than a 49-tap convolution) while this attribute is set, and
 * the animated field pauses for the same window. Both are invisible at flick
 * speed and both hand the whole GPU budget back to the thing being moved.
 *
 * The attribute is written twice per gesture — once at the start, once at the
 * end — never per event: every write is a style recalculation over the same
 * elements this exists to make cheaper.
 */
export function initScrollActivity(target: Document = document, settleMs = SETTLE_MS): () => void {
  const root = target.documentElement;
  let timer: number | null = null;

  const settle = () => {
    timer = null;
    root.removeAttribute(SCROLLING_ATTR);
  };

  const onScroll = () => {
    if (timer === null) root.setAttribute(SCROLLING_ATTR, "1");
    else window.clearTimeout(timer);
    timer = window.setTimeout(settle, settleMs);
  };

  // Capture, because `scroll` does not bubble: it is dispatched down to the
  // target, so one listener here covers the page AND every sheet that scrolls
  // inside itself. Passive, so this can never delay a frame it exists to help.
  target.addEventListener("scroll", onScroll, { capture: true, passive: true });

  return () => {
    target.removeEventListener("scroll", onScroll, { capture: true });
    if (timer !== null) window.clearTimeout(timer);
    settle();
  };
}
