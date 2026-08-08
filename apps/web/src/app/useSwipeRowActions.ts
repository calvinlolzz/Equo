import { useCallback, useEffect, useRef, type TouchEvent as ReactTouchEvent } from "react";

const MOBILE_QUERY = "(max-width: 620px)";

/** Past this much horizontal travel the gesture is a swipe, not a tap or a scroll. */
const AXIS_SLOP = 8;

function isMobile() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(MOBILE_QUERY).matches;
}

type Options = {
  /** How far the row slides to uncover the action tray. */
  revealWidth: number;
  /** Whether THIS row is the open one — the list keeps that state so only one is. */
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
};

/**
 * Swipe-left on a list row to uncover its actions.
 *
 * Mobile only, and touch only: editing and deleting are already one tap away
 * through the detail dialog on every device, so this is a shortcut rather than
 * the only route — which is also what keeps it accessible without the gesture.
 *
 * Same axis-claiming rule as useSwipeToDismissX: a drag is ignored until it is
 * clearly more horizontal than vertical, so scrolling a long list never
 * accidentally peels rows open. Once claimed, the gesture is owned completely
 * (preventDefault on a non-passive listener) — letting the browser scroll on
 * the wobbly half of a drag is what makes these feel broken.
 *
 * The transform is written imperatively rather than through state: a list of
 * forty rows re-rendering on every touchmove is the difference between this
 * feeling native and feeling like a web page.
 */
export function useSwipeRowActions({ revealWidth, open, onOpen, onClose }: Options) {
  const node = useRef<HTMLElement | null>(null);
  const startX = useRef<number | null>(null);
  const startY = useRef(0);
  const offset = useRef(0);
  /** null = undecided, true = horizontal (ours), false = vertical (the list's). */
  const horizontal = useRef<boolean | null>(null);
  const detach = useRef<(() => void) | null>(null);

  const applyOffset = useCallback((x: number, animate: boolean) => {
    const el = node.current;
    if (!el) return;
    el.style.transition = animate ? "transform 180ms cubic-bezier(0.4, 0, 0.2, 1)" : "none";
    el.style.transform = x !== 0 ? `translateX(${x}px)` : "";
  }, []);

  // The list closes rows by flipping `open` (opening another row, scrolling,
  // or acting on this one), so the animation back has to live here.
  useEffect(() => {
    if (open) {
      offset.current = -revealWidth;
      applyOffset(-revealWidth, true);
    } else if (offset.current !== 0) {
      offset.current = 0;
      applyOffset(0, true);
    }
  }, [open, revealWidth, applyOffset]);

  function onTouchStart(event: ReactTouchEvent<HTMLElement>) {
    if (!isMobile()) return;
    startX.current = event.touches[0].clientX;
    startY.current = event.touches[0].clientY;
    horizontal.current = null;
  }

  function onTouchMove(event: ReactTouchEvent<HTMLElement>) {
    if (startX.current === null) return;
    const deltaX = event.touches[0].clientX - startX.current;
    const deltaY = event.touches[0].clientY - startY.current;

    if (horizontal.current === null) {
      if (Math.abs(deltaX) < AXIS_SLOP && Math.abs(deltaY) < AXIS_SLOP) return;
      horizontal.current = Math.abs(deltaX) > Math.abs(deltaY);
    }
    if (!horizontal.current) return;

    // Start from wherever the row already sits, so dragging an open row closed
    // tracks the finger instead of jumping.
    const base = open ? -revealWidth : 0;
    // Rubber-band past the tray and refuse to open rightwards: there is nothing
    // under that edge to reveal.
    const next = Math.min(0, Math.max(base + deltaX, -revealWidth - 24));
    offset.current = next;
    applyOffset(next, false);
  }

  function onTouchEnd() {
    if (startX.current === null) return;
    startX.current = null;
    const wasHorizontal = horizontal.current;
    horizontal.current = null;
    if (!wasHorizontal) return;

    // Past halfway the tray stays; short of it the row springs back. Using the
    // midpoint rather than a fixed distance means the same flick works whether
    // the row was opening or closing.
    if (offset.current <= -revealWidth / 2) {
      offset.current = -revealWidth;
      applyOffset(-revealWidth, true);
      onOpen();
    } else {
      offset.current = 0;
      applyOffset(0, true);
      onClose();
    }
  }

  const setNode = useCallback((next: HTMLElement | null) => {
    if (detach.current) {
      detach.current();
      detach.current = null;
    }
    node.current = next;
    startX.current = null;
    horizontal.current = null;
    offset.current = 0;
    if (!next) return;
    const onNativeMove = (event: TouchEvent) => {
      if (startX.current === null || !horizontal.current) return;
      if (event.cancelable) event.preventDefault();
    };
    next.addEventListener("touchmove", onNativeMove, { passive: false });
    detach.current = () => next.removeEventListener("touchmove", onNativeMove);
  }, []);

  return {
    /** Spread onto the row element. */
    swipeProps: {
      ref: setNode,
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: onTouchEnd,
    },
    /** True while the row is displaced — used to suppress the tap it would otherwise fire. */
    isOpen: open,
  };
}
