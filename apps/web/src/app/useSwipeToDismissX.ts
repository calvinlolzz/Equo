import { useCallback, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";

export type DismissDirection = "left" | "right";

type Options = {
  /** Horizontal drag distance (px) past which release dismisses. Default 80. */
  threshold?: number;
  /** Slide-out duration (ms) before onClose fires. Keep in sync with the CSS `.closing` transition. Default 220. */
  durationMs?: number;
};

const MOBILE_QUERY = "(max-width: 620px)";

function matches(query: string) {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

/**
 * Horizontal sibling of useSwipeToDismiss for the side drawers: the LEFT
 * drawer (群組列表) dismisses on a leftward swipe, the RIGHT drawer (群組設定)
 * on a rightward one - matching the edge each drawer slides back into.
 *
 * `direction` names the swipe that dismisses. Same design as the vertical
 * hook: imperative transforms so the drawer follows the finger without
 * re-rendering the parent, a non-passive touchmove that preventDefaults only
 * while dragging toward dismissal (so vertical scrolling inside the drawer
 * stays native), mobile-layout gating, and a `.closing` class handoff for the
 * slide-out animation. A drag begun mostly vertically is ignored so list
 * scrolling never accidentally drags the drawer.
 */
export function useSwipeToDismissX(direction: DismissDirection, onClose: () => void, options: Options = {}) {
  const threshold = options.threshold ?? 80;
  const durationMs = options.durationMs ?? 220;
  const sign = direction === "left" ? -1 : 1;

  const [closing, setClosing] = useState(false);
  const closingRef = useRef(false);
  const startX = useRef<number | null>(null);
  const startY = useRef(0);
  const dragX = useRef(0);
  /** null = undecided, true = horizontal drag claimed, false = vertical scroll - leave it alone. */
  const horizontal = useRef<boolean | null>(null);
  const node = useRef<HTMLElement | null>(null);
  const detachListener = useRef<(() => void) | null>(null);
  const closeTimer = useRef<number | null>(null);

  function applyTransform(x: number, animate: boolean) {
    const el = node.current;
    if (!el) return;
    el.style.transition = animate ? "" : "none";
    // Only ever translate toward the dismiss edge; sign already encodes it.
    el.style.transform = x !== 0 ? `translateX(${x}px)` : "";
  }

  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    startX.current = null;
    dragX.current = 0;
    const el = node.current;
    if (el) {
      el.style.transition = "";
      el.style.transform = "";
    }
    if (matches("(prefers-reduced-motion: reduce)")) {
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
    startX.current = event.touches[0].clientX;
    startY.current = event.touches[0].clientY;
    horizontal.current = null;
  }

  function onTouchMove(event: ReactTouchEvent<HTMLElement>) {
    if (startX.current === null) return;
    const deltaX = event.touches[0].clientX - startX.current;
    const deltaY = event.touches[0].clientY - startY.current;

    if (horizontal.current === null) {
      // Claim the gesture only once it is clearly horizontal.
      if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
      horizontal.current = Math.abs(deltaX) > Math.abs(deltaY);
    }
    if (!horizontal.current) return;

    // Progress toward the dismiss edge only (a drag away from it pins at 0).
    const toward = deltaX * sign > 0 ? deltaX : 0;
    dragX.current = toward;
    applyTransform(toward, false);
  }

  function onTouchEnd() {
    if (startX.current === null) return;
    startX.current = null;
    const travelled = Math.abs(dragX.current);
    if (horizontal.current && travelled > threshold) {
      requestClose();
    } else {
      dragX.current = 0;
      applyTransform(0, true);
    }
    horizontal.current = null;
  }

  function onTouchCancel() {
    startX.current = null;
    dragX.current = 0;
    horizontal.current = null;
    applyTransform(0, true);
  }

  const setNode = useCallback((next: HTMLElement | null) => {
    if (detachListener.current) {
      detachListener.current();
      detachListener.current = null;
    }
    node.current = next;
    startX.current = null;
    dragX.current = 0;
    horizontal.current = null;
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
      if (startX.current === null || !horizontal.current) return;
      const deltaX = event.touches[0].clientX - startX.current;
      if (deltaX * sign > 0) event.preventDefault();
    };
    next.addEventListener("touchmove", onNativeMove, { passive: false });
    detachListener.current = () => next.removeEventListener("touchmove", onNativeMove);
    // sign is stable for a given hook instance (direction never changes at a call site).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
