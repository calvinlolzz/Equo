import { useLayoutEffect, useRef } from "react";

/** Matches the height transition below; the timer is its safety net. */
const DURATION_MS = 280;

/**
 * Set on <html> while any box is mid-resize, so the glass can stop re-blurring
 * for the length of it — the same deal scrollActivity makes for a scroll, and
 * for the same reason: a sheet that changes size is a sheet whose backdrop has
 * to be re-blurred every frame, and it is the largest blurred surface here.
 */
const RESIZING_ATTR = "data-resizing";

/** How many boxes are animating right now; the attribute is not theirs alone. */
let animating = 0;

function setResizing(on: boolean): void {
  const root = document.documentElement;

  if (on) {
    animating += 1;
    if (animating === 1) root.setAttribute(RESIZING_ATTR, "1");
    return;
  }

  animating = Math.max(0, animating - 1);
  if (animating === 0) root.removeAttribute(RESIZING_ATTR);
}

/**
 * Let a box's height change be something you can watch rather than a jump.
 *
 * Written for the profile sheet's two tabs, which are 63px and 483px tall: the
 * incoming panel faded in nicely while the sheet itself teleported 420px in a
 * single frame, and the teleport is what the eye reads. Nothing else in the app
 * needs to know — put the ref on the box whose contents swap.
 *
 * Height is animated from JS rather than in CSS because CSS cannot transition
 * to `auto`: the browser needs two concrete numbers, and only the DOM knows what
 * the new content measures. (`interpolate-size` would do it in one line and is
 * years away from Safari, which is where this app lives.)
 */
export function useAnimatedHeight<T extends HTMLElement>(durationMs = DURATION_MS) {
  const ref = useRef<T | null>(null);
  /** The height last settled on, for the common case of a box sitting at auto. */
  const settled = useRef<number | null>(null);
  const stop = useRef<(() => void) | null>(null);

  // No dependency array on purpose: this runs after every render, so `settled`
  // is never stale. A tab switch is not the only thing that changes the height
  // of a panel — a row's text growing does too, and that should animate for the
  // same reason.
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    const clear = () => {
      element.style.height = "";
      element.style.overflow = "";
      element.style.transition = "";
      element.style.contain = "";
    };

    // Where it looks right now. Only meaningful mid-animation - otherwise the
    // box has already been re-laid-out around the new content.
    const onScreen = element.style.height ? element.getBoundingClientRect().height : null;

    // Measure with the box back at auto: scrollHeight is at least the element's
    // own height, so an in-flight inline height would make a SHRINK measure as
    // "no change" and skip the animation entirely.
    stop.current?.();
    clear();

    const to = element.scrollHeight;
    const from = onScreen ?? settled.current;
    settled.current = to;

    if (from === null || Math.round(from) === Math.round(to)) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

    setResizing(true);
    // Height is not a compositor property: every frame of this is a layout and
    // a paint, which is why it stutters where a transform would not. The panel
    // inside is a grid of fixed-height rows whose layout does not depend on
    // this box's height at all, so containment lets the browser skip re-laying
    // it out 60-120 times on the way. Only for the length of the animation:
    // `contain: paint` also clips, and this box has to be free to overflow the
    // rest of the time.
    element.style.contain = "layout paint";
    element.style.overflow = "hidden";
    element.style.height = `${from}px`;
    // Read back, so the start height is a committed style rather than something
    // the browser coalesces with the line after it into "no change at all".
    void element.offsetHeight;
    element.style.transition = `height ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`;
    element.style.height = `${to}px`;

    const settle = () => {
      stop.current = null;
      setResizing(false);
      clear();
    };
    // transitionend does not fire if the transition never runs (a hidden tab,
    // a browser that coalesced it away), and the box must not be left clipped.
    element.addEventListener("transitionend", settle, { once: true });
    const timer = window.setTimeout(settle, durationMs + 120);

    stop.current = () => {
      window.clearTimeout(timer);
      element.removeEventListener("transitionend", settle);
      stop.current = null;
      setResizing(false);
    };
  });

  useLayoutEffect(() => () => stop.current?.(), []);

  return ref;
}
