import { useCallback, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";

type Options = {
  /** Downward drag distance (px) past which release dismisses. Default 120. */
  threshold?: number;
  /** Slide-out duration (ms) before onClose fires. Keep in sync with the CSS `.closing` transition. Default 260. */
  durationMs?: number;
  /**
   * Return true to hand `onClose` control immediately instead of animating out
   * first. For a sheet whose `onClose` may decline to close and put a question
   * on top instead (the composer's discard confirm): animating would slide the
   * sheet away and then snap it back under the dialog.
   */
  closeInstantly?: () => boolean;
};

/** The gesture only applies on the mobile bottom-sheet layout; the `.closing` visuals live in the same media query. */
const MOBILE_QUERY = "(max-width: 620px)";

function matches(query: string) {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

/**
 * The box that actually scrolls under the finger, searched from where the touch
 * landed up to the sheet itself.
 *
 * This used to read `scrollTop` off the sheet, which is right only when the
 * sheet is its own scroll surface. The stepped composer is not: the sheet is
 * `overflow: hidden` and the scrolling happens in `.composer-step-body` inside
 * it — so the sheet's scrollTop was 0 no matter how far down the content was,
 * the "only from the top" guard never fired, and every downward swipe anywhere
 * in a scrolled sheet was a dismissal. Reported as 「展開後上下滑動容易整個項下滑
 * 掉觸發放棄紀錄」, which is the worst version of it: the discard confirm.
 */
function scrollableUnder(target: EventTarget | null, sheet: HTMLElement): HTMLElement | null {
  let element = target instanceof HTMLElement ? target : null;

  while (element) {
    if (element.scrollHeight > element.clientHeight) {
      const overflowY = window.getComputedStyle(element).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") return element;
    }
    if (element === sheet) return null;
    element = element.parentElement;
  }

  return null;
}

/**
 * Drag-to-dismiss gesture for mobile bottom-sheet dialogs.
 *
 * Spread `dragProps` onto the sheet element and add the `closing` class to both
 * the sheet and its backdrop in CSS: the sheet translates off-screen (e.g.
 * `translateY(110%)`) and the backdrop fades, over `durationMs`.
 *
 * The drag transform is applied imperatively to the node (no React re-render
 * per touchmove — important when the hook lives in a large parent), so the sheet
 * follows the finger 1:1. Releasing past `threshold` animates it out and calls
 * `onClose`; a short drag or a cancelled gesture snaps back. A non-passive
 * `touchmove` listener (React's are passive) preventDefaults while dragging down
 * so iOS/Android don't steal the gesture with native overscroll.
 *
 * Gated to the mobile layout via `matchMedia`, so touch-capable desktops are
 * unaffected. Safe to keep permanently mounted and reuse across open/close
 * cycles (e.g. a single shared dialog shell): a fresh mount cancels any in-
 * flight close timer and resets state, and the native listener re-attaches via
 * a callback ref every time the node mounts.
 */
export function useSwipeToDismiss(onClose: () => void, options: Options = {}) {
  const threshold = options.threshold ?? 120;
  const durationMs = options.durationMs ?? 260;

  const [closing, setClosing] = useState(false);
  // Guards requestClose against double-firing and lets touch handlers bail once
  // a close is in flight, without depending on render timing.
  const closingRef = useRef(false);
  const dragStart = useRef<number | null>(null);
  const dragY = useRef(0);
  const node = useRef<HTMLElement | null>(null);
  /** What is scrolling under this gesture, resolved once per touch. */
  const scroller = useRef<HTMLElement | null>(null);
  const detachListener = useRef<(() => void) | null>(null);
  const closeTimer = useRef<number | null>(null);
  // Read through a ref so requestClose's identity (and every listener keyed to
  // it) doesn't churn as the caller's condition changes.
  const closeInstantlyRef = useRef(options.closeInstantly);
  closeInstantlyRef.current = options.closeInstantly;

  /** Imperatively position the sheet. `animate` false = follow finger 1:1; true = let CSS ease it. */
  function applyTransform(y: number, animate: boolean) {
    const el = node.current;
    if (!el) return;
    el.style.transition = animate ? "" : "none";
    el.style.transform = y > 0 ? `translateY(${y}px)` : "";
  }

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    dragStart.current = null;
    dragY.current = 0;
    // Drop the inline drag styles so the `.closing` CSS (transform + transition) drives the slide-out.
    const el = node.current;
    if (el) {
      el.style.transition = "";
      el.style.transform = "";
    }
    if (closeInstantlyRef.current?.() || matches("(prefers-reduced-motion: reduce)") || !matches(MOBILE_QUERY)) {
      // Reduced motion, or desktop (the `.closing` animation lives only in the
      // ≤620px media query): close immediately rather than sit through the
      // delay — otherwise Escape on desktop freezes the dialog for durationMs.
      closingRef.current = false;
      onClose();
      return;
    }
    setClosing(true);
    closeTimer.current = window.setTimeout(() => {
      closeTimer.current = null;
      closingRef.current = false;
      setClosing(false);
      onClose();
    }, durationMs);
  }, [durationMs, onClose]);

  function onTouchStart(event: ReactTouchEvent<HTMLElement>) {
    if (closingRef.current) return;
    if (!matches(MOBILE_QUERY)) return;
    // Resolved once, then consulted on every move below. One rule, checked
    // continuously, rather than a gate at touchstart AND a correction later:
    // the two would shadow each other, so neither could be tested on its own.
    scroller.current = scrollableUnder(event.target, event.currentTarget);
    dragStart.current = event.touches[0].clientY;
  }

  function onTouchMove(event: ReactTouchEvent<HTMLElement>) {
    if (dragStart.current === null) return;

    // While the box under the finger is off its top, the gesture belongs to
    // that box and not to this sheet. The baseline moves with the finger rather
    // than the gesture being dropped, so that scrolling back to the top and
    // carrying on downwards hands over to the drag — and so that the distance
    // already travelled is not banked: a 200px scroll up would otherwise
    // dismiss on the way back down.
    if ((scroller.current?.scrollTop ?? 0) > 0) {
      dragStart.current = event.touches[0].clientY;
      if (dragY.current !== 0) {
        dragY.current = 0;
        applyTransform(0, false);
      }
      return;
    }

    const delta = event.touches[0].clientY - dragStart.current;
    dragY.current = delta > 0 ? delta : 0;
    applyTransform(dragY.current, false);
  }

  function onTouchEnd() {
    if (dragStart.current === null) return;
    dragStart.current = null;
    if (dragY.current > threshold) {
      requestClose();
    } else {
      dragY.current = 0;
      applyTransform(0, true);
    }
  }

  function onTouchCancel() {
    if (dragStart.current === null) return;
    dragStart.current = null;
    dragY.current = 0;
    applyTransform(0, true);
  }

  // Callback ref: (re)attach a non-passive touchmove whenever the node mounts,
  // detach when it unmounts. A fresh mount also cancels any stale close timer
  // and clears state so a reused shell never opens mid-animation.
  const setNode = useCallback((next: HTMLElement | null) => {
    if (detachListener.current) {
      detachListener.current();
      detachListener.current = null;
    }
    node.current = next;
    scroller.current = null;
    dragStart.current = null;
    dragY.current = 0;
    // Cancel any in-flight close and reset state on both detach and (re)attach,
    // so a reused shell never opens mid-animation and no orphan timer lingers.
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current);
      closeTimer.current = null;
    }
    if (closingRef.current) {
      closingRef.current = false;
      setClosing(false);
    }
    if (!next) return;
    const onNativeMove = (event: TouchEvent) => {
      if (dragStart.current === null) return;
      // Same test as the handler above, and for a sharper reason: swallowing
      // downward moves while the list is scrolled does not merely dismiss by
      // accident, it stops the list scrolling at all.
      if ((scroller.current?.scrollTop ?? 0) > 0) return;
      const delta = event.touches[0].clientY - dragStart.current;
      if (delta > 0) event.preventDefault();
    };
    next.addEventListener("touchmove", onNativeMove, { passive: false });
    detachListener.current = () => next.removeEventListener("touchmove", onNativeMove);
  }, []);

  const dragProps = {
    ref: setNode,
    onTouchStart,
    onTouchMove,
    onTouchEnd,
    onTouchCancel,
  };

  return { closing, requestClose, dragProps };
}
