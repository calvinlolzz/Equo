import { useLayoutEffect, useRef } from "react";

/**
 * Matches the height transition below; the timer is its safety net.
 *
 * Deliberately the same 260ms as `.enter-content`, the fade the panel inside
 * plays at the same moment. They were 280 and 260: close enough to look like a
 * mistake rather than a decision, and far enough apart that the box finished
 * arriving while its contents were still appearing.
 */
const DURATION_MS = 260;

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
/**
 * ⚠️ PREVIEW BRANCH ONLY — do not merge.
 * ?resize=fast  — the same height animation, 170ms instead of 260ms.
 * ?resize=slide — no height animation at all: the box snaps to its new size and
 *                 the SHEET is slid back into place with a transform, which is
 *                 the only way to move it without a layout per frame. The cost
 *                 is that everything moves, including the bottom edge, so a
 *                 shrink lifts the sheet off the bottom of the screen for the
 *                 length of it.
 */
function previewMode(): { mode: "height" | "fast" | "slide"; asked: boolean } {
  const asked = new URLSearchParams(window.location.search).get("resize");
  if (asked === "fast" || asked === "slide" || asked === "height") return { mode: asked, asked: true };
  return { mode: "height", asked: false };
}

/** ⚠️ PREVIEW BRANCH ONLY: says which one you are looking at. */
function showModeBadge(mode: string): void {
  const id = "resize-mode-badge";
  if (document.getElementById(id)) return;
  const badge = document.createElement("div");
  badge.id = id;
  badge.textContent = { height: "高度動畫 260ms（目前正式站）", fast: "高度動畫 170ms", slide: "transform 位移（不做 layout）" }[mode] ?? mode;
  badge.style.cssText =
    "position:fixed;left:50%;transform:translateX(-50%);top:calc(8px + env(safe-area-inset-top));z-index:99999;padding:6px 12px;border-radius:999px;background:rgba(0,0,0,0.72);color:#fff;font:700 12px/1 system-ui,sans-serif;pointer-events:none";
  document.body.appendChild(badge);
}

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

    // ⚠️ TEMPORARY — see previewMode above. The badge only appears for someone
    // who asked for a mode by hand; nobody else sees any of this.
    const { mode, asked } = previewMode();
    if (asked) showModeBadge(mode);

    if (mode === "slide") {
      // The box is already at its new size, so the sheet's top edge has
      // already moved. Put it back with a transform and let the compositor
      // walk it home: no layout, no paint, one texture moving.
      const sheet = element.closest<HTMLElement>(".flow-dialog");
      if (!sheet) return;

      setResizing(true);
      sheet.style.transition = "none";
      sheet.style.transform = `translateY(${to - from}px)`;
      void sheet.offsetHeight;
      sheet.style.transition = `transform ${durationMs}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      sheet.style.transform = "";

      const done = () => {
        stop.current = null;
        setResizing(false);
        sheet.style.transition = "";
        sheet.style.transform = "";
      };
      sheet.addEventListener("transitionend", done, { once: true });
      const slideTimer = window.setTimeout(done, durationMs + 120);
      stop.current = () => {
        window.clearTimeout(slideTimer);
        sheet.removeEventListener("transitionend", done);
        stop.current = null;
        setResizing(false);
      };
      return;
    }

    if (mode === "fast") durationMs = 170;

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
