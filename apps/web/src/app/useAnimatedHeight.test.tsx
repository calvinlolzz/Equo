// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useAnimatedHeight } from "./useAnimatedHeight";

/**
 * jsdom lays nothing out, so both measurements the hook depends on are faked:
 * `scrollHeight` (what the new content wants) and the box's own height (where
 * an in-flight animation currently sits). That is enough to hold the part that
 * matters — the order of the writes — which is also the part that is easy to
 * get subtly wrong and impossible to see in a diff.
 */
let contentHeight = 0;

function Box({ label }: { label: string }) {
  const ref = useAnimatedHeight<HTMLDivElement>();
  return (
    <div ref={ref} data-testid="box">
      {label}
    </div>
  );
}

function boxOf(container: HTMLElement) {
  return container.querySelector<HTMLDivElement>('[data-testid="box"]')!;
}

beforeEach(() => {
  vi.useFakeTimers();
  contentHeight = 100;
  // Every element reports the current fixture height unless an inline height
  // pins it - which is what the real scrollHeight does under overflow: hidden.
  Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
    configurable: true,
    get(this: HTMLElement) {
      return this.style.height ? Number.parseFloat(this.style.height) : contentHeight;
    },
  });
  HTMLElement.prototype.getBoundingClientRect = function (this: HTMLElement) {
    const height = this.style.height ? Number.parseFloat(this.style.height) : contentHeight;
    return { height, width: 0, top: 0, left: 0, right: 0, bottom: height, x: 0, y: 0, toJSON: () => ({}) } as DOMRect;
  };
  vi.stubGlobal("matchMedia", (query: string) => ({ matches: false, media: query, addEventListener() {}, removeEventListener() {} }));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("useAnimatedHeight", () => {
  test("the first render is left alone", () => {
    // There is no previous height to come from, and animating from zero would
    // make every mount unfold.
    const { container } = render(<Box label="one" />);

    expect(boxOf(container).style.height).toBe("");
  });

  test("a content change starts at the old height and ends at the new one", () => {
    const { container, rerender } = render(<Box label="one" />);
    const box = boxOf(container);

    contentHeight = 480;
    rerender(<Box label="two" />);

    // The end state is what the browser animates towards; the start had to be
    // written and committed first, or there is nothing to animate FROM.
    expect(box.style.height).toBe("480px");
    expect(box.style.transition).toContain("height");
    expect(box.style.overflow).toBe("hidden");
  });

  test("it hands the box back to the layout when the transition ends", () => {
    // Left clipped, the panel could never grow again - a row whose text wraps
    // to two lines would be cut off with no way back.
    const { container, rerender } = render(<Box label="one" />);
    const box = boxOf(container);

    contentHeight = 480;
    rerender(<Box label="two" />);
    box.dispatchEvent(new Event("transitionend"));

    expect(box.style.height).toBe("");
    expect(box.style.overflow).toBe("");
    expect(box.style.transition).toBe("");
  });

  test("a transition that never fires still releases the box", () => {
    const { container, rerender } = render(<Box label="one" />);
    const box = boxOf(container);

    contentHeight = 480;
    rerender(<Box label="two" />);
    vi.runAllTimers();

    expect(box.style.height).toBe("");
  });

  test("a second switch mid-animation aims at the new height, not the pinned one", () => {
    // Tapping the tab twice quickly. The box is still pinned to an inline
    // height from the first animation, and scrollHeight is at least the
    // element's own height — so measuring without releasing it first reports
    // the OLD tall box, the shrink looks like "no change", and the panel stays
    // stuck open. This is the case the release-then-measure order exists for.
    const { container, rerender } = render(<Box label="one" />);
    const box = boxOf(container);

    contentHeight = 480;
    rerender(<Box label="two" />);
    expect(box.style.height).toBe("480px");

    contentHeight = 63;
    rerender(<Box label="one again" />);

    expect(box.style.height).toBe("63px");
  });

  test("shrinking animates too", () => {
    // The measurement trap: scrollHeight is at least the element's own height,
    // so measuring while an inline height is still pinned reports the OLD tall
    // box and the shrink looks like "no change".
    const { container, rerender } = render(<Box label="tall" />);
    const box = boxOf(container);

    contentHeight = 480;
    rerender(<Box label="taller" />);
    box.dispatchEvent(new Event("transitionend"));

    contentHeight = 63;
    rerender(<Box label="short" />);

    expect(box.style.height).toBe("63px");
    expect(box.style.transition).toContain("height");
  });

  test("reduced motion gets the jump, not a slow one", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("prefers-reduced-motion"),
      media: query,
      addEventListener() {},
      removeEventListener() {},
    }));
    const { container, rerender } = render(<Box label="one" />);
    const box = boxOf(container);

    contentHeight = 480;
    rerender(<Box label="two" />);

    expect(box.style.height).toBe("");
    expect(box.style.transition).toBe("");
  });
});

describe("while a box is resizing", () => {
  test("the page is marked, so the glass can stop re-blurring", () => {
    // Same bargain as scrolling: a box whose height animates has its backdrop
    // re-blurred every frame, and the sheet this runs inside is the largest
    // blurred surface in the app.
    const { container, rerender } = render(<Box label="one" />);
    const box = boxOf(container);

    contentHeight = 480;
    rerender(<Box label="two" />);
    expect(document.documentElement.hasAttribute("data-resizing")).toBe(true);

    box.dispatchEvent(new Event("transitionend"));
    expect(document.documentElement.hasAttribute("data-resizing")).toBe(false);
  });

  test("two boxes at once do not clear it early", () => {
    // The attribute is shared, so it is counted rather than owned: the first
    // one to finish must not un-mark a page that is still moving.
    const { container: a, rerender: rerenderA } = render(<Box label="a" />);
    const { container: b, rerender: rerenderB } = render(<Box label="b" />);

    contentHeight = 480;
    rerenderA(<Box label="a2" />);
    rerenderB(<Box label="b2" />);

    boxOf(a).dispatchEvent(new Event("transitionend"));
    expect(document.documentElement.hasAttribute("data-resizing")).toBe(true);

    boxOf(b).dispatchEvent(new Event("transitionend"));
    expect(document.documentElement.hasAttribute("data-resizing")).toBe(false);
  });

  test("unmounting mid-animation still clears it", () => {
    const { container, rerender, unmount } = render(<Box label="one" />);
    expect(boxOf(container)).toBeTruthy();

    contentHeight = 480;
    rerender(<Box label="two" />);
    unmount();

    expect(document.documentElement.hasAttribute("data-resizing")).toBe(false);
  });
});
