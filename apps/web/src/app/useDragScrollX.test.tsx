// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useDragScrollX } from "./useDragScrollX";

/**
 * jsdom has no layout, so the strip's geometry is stubbed: a 190px viewport
 * over 360px of chips, i.e. 170px of scrollable travel. Chip rects are faked
 * from a chip's index so the keep-in-view pass has something real to measure.
 */
const VIEWPORT = 190;
const CONTENT = 360;
const CHIP = 38;
const GAP = 8;

function fakeGeometry(strip: HTMLElement) {
  Object.defineProperty(strip, "clientWidth", { configurable: true, value: VIEWPORT });
  Object.defineProperty(strip, "scrollWidth", { configurable: true, value: CONTENT });
  strip.getBoundingClientRect = () => new DOMRect(0, 0, VIEWPORT, 44);
  for (const [index, chip] of [...strip.children].entries()) {
    const left = index * (CHIP + GAP) - strip.scrollLeft;
    (chip as HTMLElement).getBoundingClientRect = () => new DOMRect(left, 0, CHIP, CHIP);
  }
}

function Strip({ activeIndex = 0, chips = 8 }: { activeIndex?: number; chips?: number }) {
  const ref = useDragScrollX(String(activeIndex));
  return (
    <div
      className="date-chip-row"
      ref={(node) => {
        ref(node);
        if (node) fakeGeometry(node);
      }}
    >
      {Array.from({ length: chips }, (_, index) => (
        <button key={index} type="button" data-active={index === activeIndex} data-testid={`chip-${index}`}>
          {index}
        </button>
      ))}
    </div>
  );
}

function mountStrip(props: { activeIndex?: number; chips?: number } = {}) {
  const view = render(<Strip {...props} />);
  const strip = view.container.querySelector<HTMLElement>(".date-chip-row")!;
  // The keep-in-view effect measures on mount; re-stub with final scrollLeft.
  fakeGeometry(strip);
  return { view, strip };
}

/** jsdom lacks PointerEvent, and MouseEvent ignores unknown init keys. */
function pointer(type: string, init: { clientX?: number; button?: number; pointerType?: string } = {}) {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: init.clientX ?? 0, button: init.button ?? 0 });
  Object.defineProperty(event, "pointerId", { value: 1 });
  Object.defineProperty(event, "pointerType", { value: init.pointerType ?? "mouse" });
  return event;
}

function wheel(deltaY: number, extra: { deltaX?: number; ctrlKey?: boolean } = {}) {
  return new WheelEvent("wheel", { bubbles: true, cancelable: true, deltaY, deltaX: extra.deltaX ?? 0, ctrlKey: extra.ctrlKey });
}

describe("useDragScrollX", () => {
  test("mouse drag pans the strip by the pointer travel", () => {
    const { strip } = mountStrip();
    strip.scrollLeft = 100;

    act(() => {
      strip.dispatchEvent(pointer("pointerdown", { clientX: 150 }));
      strip.dispatchEvent(pointer("pointermove", { clientX: 110 }));
    });

    // Dragged 40px left -> the content moves 40px further along.
    expect(strip.scrollLeft).toBe(140);
    expect(strip.classList.contains("dragging")).toBe(true);

    act(() => {
      strip.dispatchEvent(pointer("pointerup", { clientX: 110 }));
    });
    expect(strip.classList.contains("dragging")).toBe(false);
  });

  test("a press that never passes the slop threshold does not scroll", () => {
    const { strip } = mountStrip();
    strip.scrollLeft = 100;

    act(() => {
      strip.dispatchEvent(pointer("pointerdown", { clientX: 150 }));
      strip.dispatchEvent(pointer("pointermove", { clientX: 148 }));
    });

    expect(strip.scrollLeft).toBe(100);
    expect(strip.classList.contains("dragging")).toBe(false);
  });

  test("a drag swallows the click that ends it, a tap does not", () => {
    const { strip } = mountStrip();
    const chip = strip.querySelector<HTMLElement>("[data-testid='chip-2']")!;
    let clicks = 0;
    chip.addEventListener("click", () => {
      clicks += 1;
    });

    act(() => {
      strip.dispatchEvent(pointer("pointerdown", { clientX: 150 }));
      strip.dispatchEvent(pointer("pointermove", { clientX: 110 }));
      strip.dispatchEvent(pointer("pointerup", { clientX: 110 }));
      chip.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(clicks).toBe(0);

    // The next click is an ordinary tap and must select as usual.
    act(() => {
      chip.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    });
    expect(clicks).toBe(1);
  });

  test("touch is left to the browser's native scrolling", () => {
    const { strip } = mountStrip();
    strip.scrollLeft = 100;

    act(() => {
      strip.dispatchEvent(pointer("pointerdown", { clientX: 150, pointerType: "touch" }));
      strip.dispatchEvent(pointer("pointermove", { clientX: 110, pointerType: "touch" }));
    });

    expect(strip.scrollLeft).toBe(100);
  });

  test("vertical wheel pans horizontally and is clamped to the travel", () => {
    const { strip } = mountStrip();
    strip.scrollLeft = 0;

    const down = wheel(60);
    act(() => {
      strip.dispatchEvent(down);
    });
    expect(strip.scrollLeft).toBe(60);
    expect(down.defaultPrevented).toBe(true);

    const far = wheel(9999);
    act(() => {
      strip.dispatchEvent(far);
    });
    expect(strip.scrollLeft).toBe(CONTENT - VIEWPORT);
  });

  test("wheel at the end lets the page scroll instead", () => {
    const { strip } = mountStrip();
    strip.scrollLeft = CONTENT - VIEWPORT;

    const event = wheel(40);
    act(() => {
      strip.dispatchEvent(event);
    });

    expect(strip.scrollLeft).toBe(CONTENT - VIEWPORT);
    expect(event.defaultPrevented).toBe(false);
  });

  test("horizontal trackpad swipes and pinch-zoom are left alone", () => {
    const { strip } = mountStrip();
    strip.scrollLeft = 50;

    const sideways = wheel(10, { deltaX: 40 });
    const pinch = wheel(40, { ctrlKey: true });
    act(() => {
      strip.dispatchEvent(sideways);
      strip.dispatchEvent(pinch);
    });

    expect(strip.scrollLeft).toBe(50);
    expect(sideways.defaultPrevented).toBe(false);
    expect(pinch.defaultPrevented).toBe(false);
  });

  test("the selected chip is scrolled into view on mount", () => {
    // Chip 7 spans 322-360, past the 190px viewport, so the strip must scroll.
    const { strip } = mountStrip({ activeIndex: 7 });
    expect(strip.scrollLeft).toBe(CONTENT - VIEWPORT);
  });

  test("a selected chip already in view leaves the scroll position alone", () => {
    const { strip } = mountStrip({ activeIndex: 1 });
    expect(strip.scrollLeft).toBe(0);
  });

  test("a strip with nothing to scroll ignores drags and wheels", () => {
    const { strip } = mountStrip({ chips: 2 });
    Object.defineProperty(strip, "scrollWidth", { configurable: true, value: VIEWPORT });
    strip.scrollLeft = 0;

    const event = wheel(40);
    act(() => {
      strip.dispatchEvent(pointer("pointerdown", { clientX: 150 }));
      strip.dispatchEvent(pointer("pointermove", { clientX: 110 }));
      strip.dispatchEvent(event);
    });

    expect(strip.scrollLeft).toBe(0);
    expect(event.defaultPrevented).toBe(false);
  });
});
