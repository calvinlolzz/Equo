import { useCallback, useEffect, useRef, useState } from "react";

/** Pointer travel (px) past which a press counts as a drag, not a tap. */
const DRAG_SLOP = 4;

function clamp(value: number, min: number, max: number) {
  return value < min ? min : value > max ? max : value;
}

/**
 * Makes a horizontal strip (the home screen's date chips) pannable with every
 * input a user might have, since touch is the only one the browser handles for
 * free:
 *
 * - **Touch (H5 / installed app)**: left alone. Native overflow scrolling is
 *   smoother than anything JS can fake, and the strip's `overflow-y: hidden`
 *   already keeps a vertical drag from moving the row instead of the page.
 * - **Mouse drag (web)**: press-and-drag pans the strip. A drag past DRAG_SLOP
 *   swallows the click that follows, so dragging across the chips never
 *   silently changes the selected date.
 * - **Wheel (web)**: a vertical wheel pans horizontally - the convention for
 *   x-only scrollers. At either end we bow out without preventDefault so the
 *   page keeps scrolling normally.
 *
 * `keepVisibleKey` re-runs the "scroll the selected chip into view" pass
 * whenever it changes. That matters because the strip is right-aligned via an
 * auto margin rather than `justify-content: flex-end` (which pushes the
 * overflow out the *start* edge, where it is unreachable - all the older days
 * were unscrollable before). Alignment therefore no longer implies scroll
 * position: today sits at the far end and has to be scrolled to.
 */
export function useDragScrollX(keepVisibleKey?: string) {
  const [node, setNode] = useState<HTMLElement | null>(null);
  /** Pointer origin + the scrollLeft it started from; null when not dragging. */
  const drag = useRef<{ pointerId: number; x: number; scrollLeft: number } | null>(null);
  const dragged = useRef(false);

  useEffect(() => {
    if (!node) return;

    const onWheel = (event: WheelEvent) => {
      // Leave pinch-zoom and genuinely horizontal trackpad swipes to the browser.
      if (event.ctrlKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) return;
      const max = node.scrollWidth - node.clientWidth;
      if (max <= 0 || event.deltaY === 0) return;
      const next = clamp(node.scrollLeft + event.deltaY, 0, max);
      // Already pinned at that end - let the wheel fall through to the page.
      if (next === node.scrollLeft) return;
      node.scrollLeft = next;
      event.preventDefault();
    };

    const onPointerDown = (event: PointerEvent) => {
      if (event.pointerType === "touch" || event.button !== 0) return;
      if (node.scrollWidth <= node.clientWidth) return;
      drag.current = { pointerId: event.pointerId, x: event.clientX, scrollLeft: node.scrollLeft };
      dragged.current = false;
    };

    const onPointerMove = (event: PointerEvent) => {
      const start = drag.current;
      if (!start || event.pointerId !== start.pointerId) return;
      const deltaX = event.clientX - start.x;
      if (!dragged.current) {
        if (Math.abs(deltaX) < DRAG_SLOP) return;
        dragged.current = true;
        node.classList.add("dragging");
        // Capture so a fast drag that leaves the 190px strip keeps panning.
        if (node.hasPointerCapture?.(event.pointerId) === false) node.setPointerCapture?.(event.pointerId);
      }
      node.scrollLeft = start.scrollLeft - deltaX;
      // Stop the drag doubling as a text/image selection.
      event.preventDefault();
    };

    const endDrag = (event: PointerEvent) => {
      const start = drag.current;
      if (!start || event.pointerId !== start.pointerId) return;
      drag.current = null;
      node.classList.remove("dragging");
      if (node.hasPointerCapture?.(event.pointerId)) node.releasePointerCapture?.(event.pointerId);
    };

    // Capture phase + one shot: kills only the click that closes out a drag,
    // leaving an ordinary tap on a chip to select its date as usual.
    const onClickCapture = (event: MouseEvent) => {
      if (!dragged.current) return;
      dragged.current = false;
      event.preventDefault();
      event.stopPropagation();
    };

    // Non-passive: both the wheel and the drag need preventDefault.
    node.addEventListener("wheel", onWheel, { passive: false });
    node.addEventListener("pointerdown", onPointerDown);
    node.addEventListener("pointermove", onPointerMove, { passive: false });
    node.addEventListener("pointerup", endDrag);
    node.addEventListener("pointercancel", endDrag);
    node.addEventListener("click", onClickCapture, true);
    return () => {
      node.removeEventListener("wheel", onWheel);
      node.removeEventListener("pointerdown", onPointerDown);
      node.removeEventListener("pointermove", onPointerMove);
      node.removeEventListener("pointerup", endDrag);
      node.removeEventListener("pointercancel", endDrag);
      node.removeEventListener("click", onClickCapture, true);
      drag.current = null;
      dragged.current = false;
    };
  }, [node]);

  useEffect(() => {
    if (!node) return;
    const active = node.querySelector<HTMLElement>("[data-active='true']");
    if (!active) return;
    // Rect deltas rather than offsetLeft: the chips are position:relative, so
    // their offsetParent is not the strip. Only scrollLeft is ever written -
    // scrollIntoView() would drag the whole page vertically too.
    const strip = node.getBoundingClientRect();
    const chip = active.getBoundingClientRect();
    const max = node.scrollWidth - node.clientWidth;
    if (max <= 0) return;
    if (chip.right > strip.right) node.scrollLeft = clamp(node.scrollLeft + (chip.right - strip.right), 0, max);
    else if (chip.left < strip.left) node.scrollLeft = clamp(node.scrollLeft - (strip.left - chip.left), 0, max);
  }, [node, keepVisibleKey]);

  return useCallback((next: HTMLElement | null) => setNode(next), []);
}
