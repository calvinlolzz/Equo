// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useSwipeToDismiss } from "./useSwipeToDismiss";

/**
 * The dismiss gesture against a sheet that scrolls INSIDE itself, which is
 * every sheet in this app that matters: the stepped composer is
 * `overflow: hidden` and the scrolling happens in a child.
 *
 * The bug this pins: the "only from the top" guard read scrollTop off the sheet
 * the gesture was bound to, which for those sheets is 0 forever. So a downward
 * swipe anywhere in a scrolled sheet dismissed it - and on the composer,
 * dismissing raises the discard confirm.
 */

const THRESHOLD = 120;

/** jsdom has no layout: say so explicitly, since scrollableUnder asks. */
function makeScrollable(element: HTMLElement, scrollHeight = 900, clientHeight = 300) {
  Object.defineProperty(element, "scrollHeight", { value: scrollHeight, configurable: true });
  Object.defineProperty(element, "clientHeight", { value: clientHeight, configurable: true });
  element.style.overflowY = "auto";
}

function Sheet({ onClose }: { onClose: () => void }) {
  const { dragProps } = useSwipeToDismiss(onClose);
  return (
    <section {...dragProps} data-testid="sheet">
      <div data-testid="handle">drag me</div>
      <div data-testid="body">
        <button data-testid="row" type="button">
          a row deep inside the list
        </button>
      </div>
    </section>
  );
}

function mount() {
  const onClose = vi.fn();
  const view = render(<Sheet onClose={onClose} />);
  const sheet = view.getByTestId("sheet");
  const body = view.getByTestId("body");
  makeScrollable(body);
  return { onClose, sheet, body, view };
}

/**
 * Run out the slide-out timer.
 *
 * A dismissal is not synchronous - the sheet animates for durationMs and only
 * then calls onClose - so every assertion here, the negative ones especially,
 * has to be made after the timer would have fired. Otherwise "was not called"
 * is satisfied by a close that simply had not landed yet.
 */
function settle() {
  act(() => {
    vi.advanceTimersByTime(600);
  });
}

/** One downward drag of `distance`, starting on `target`. */
function dragDown(target: HTMLElement, distance: number, startY = 100) {
  fireEvent.touchStart(target, { touches: [{ clientY: startY }] });
  fireEvent.touchMove(target, { touches: [{ clientY: startY + distance / 2 }] });
  fireEvent.touchMove(target, { touches: [{ clientY: startY + distance }] });
  fireEvent.touchEnd(target, { changedTouches: [{ clientY: startY + distance }] });
  settle();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: /max-width/.test(query),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a sheet whose scrolling happens inside it", () => {
  test("does not dismiss when the list under the finger is scrolled", () => {
    const { onClose, body } = mount();
    body.scrollTop = 400;

    dragDown(body, THRESHOLD + 80);

    expect(onClose).not.toHaveBeenCalled();
  });

  test("still dismisses from the top of that list", () => {
    const { onClose, body } = mount();
    body.scrollTop = 0;

    dragDown(body, THRESHOLD + 80);

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("looks past the element actually touched to find what scrolls", () => {
    const { onClose, view, body } = mount();
    body.scrollTop = 400;

    // The touch lands on a button several levels down, not on the scroll box.
    dragDown(view.getByTestId("row"), THRESHOLD + 80);

    expect(onClose).not.toHaveBeenCalled();
  });

  test("a short drag from the top still snaps back rather than closing", () => {
    const { onClose, body } = mount();

    dragDown(body, THRESHOLD - 40);

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("mid-gesture, the finger can change its mind", () => {
  test("scrolling away from the top cancels the drag already in progress", () => {
    const { onClose, sheet, body } = mount();

    fireEvent.touchStart(body, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(body, { touches: [{ clientY: 140 }] });
    expect(sheet.style.transform).toContain("translateY");

    // The list scrolls under the finger; the sheet must go back to where it was.
    body.scrollTop = 200;
    fireEvent.touchMove(body, { touches: [{ clientY: 180 }] });
    expect(sheet.style.transform).toBe("");

    fireEvent.touchEnd(body, { changedTouches: [{ clientY: 180 }] });
    settle();
    expect(onClose).not.toHaveBeenCalled();
  });

  test("distance travelled while scrolling is not banked against the threshold", () => {
    const { onClose, body } = mount();

    // Scroll up a long way (finger travelling down), then land back at the top
    // and carry on a little further. Before the re-baseline that total read as
    // one 300px dismiss drag.
    body.scrollTop = 300;
    fireEvent.touchStart(body, { touches: [{ clientY: 100 }] });
    fireEvent.touchMove(body, { touches: [{ clientY: 250 }] });
    body.scrollTop = 0;
    fireEvent.touchMove(body, { touches: [{ clientY: 330 }] });
    fireEvent.touchEnd(body, { changedTouches: [{ clientY: 330 }] });
    settle();

    // 80px past the handover point, not 230.
    expect(onClose).not.toHaveBeenCalled();
  });
});

/** A downward native touchmove, which is the one the hook may swallow. */
function nativeMoveDown(target: HTMLElement, clientY: number) {
  const move = new Event("touchmove", { bubbles: true, cancelable: true });
  Object.defineProperty(move, "touches", { value: [{ clientY }] });
  target.dispatchEvent(move);
  return move;
}

describe("the non-passive touchmove", () => {
  test("leaves the list alone to scroll when it is not at the top", () => {
    const { body } = mount();
    body.scrollTop = 250;

    fireEvent.touchStart(body, { touches: [{ clientY: 100 }] });

    // Swallowing this is what stopped the list scrolling at all.
    expect(nativeMoveDown(body, 200).defaultPrevented).toBe(false);
  });

  test("and stops swallowing the moment the list scrolls mid-gesture", () => {
    const { body } = mount();
    // Starts at the top, so the drag is live and downward moves are claimed.
    fireEvent.touchStart(body, { touches: [{ clientY: 100 }] });
    expect(nativeMoveDown(body, 150).defaultPrevented).toBe(true);

    // The finger went up, the list scrolled, and now it comes back down. If the
    // hook kept claiming these, the list would be frozen for the rest of the
    // gesture - the exact feel being reported.
    body.scrollTop = 250;
    expect(nativeMoveDown(body, 300).defaultPrevented).toBe(false);
  });

  test("but claims the gesture at the top, so the sheet follows the finger", () => {
    const { sheet } = mount();

    fireEvent.touchStart(sheet, { touches: [{ clientY: 100 }] });

    expect(nativeMoveDown(sheet, 200).defaultPrevented).toBe(true);
  });
});

describe("a sheet that scrolls in its own right still works", () => {
  test("its own scrollTop is what gates the drag", () => {
    const onClose = vi.fn();
    const view = render(<Sheet onClose={onClose} />);
    const sheet = view.getByTestId("sheet");
    makeScrollable(sheet);
    sheet.scrollTop = 300;

    dragDown(sheet, THRESHOLD + 80);

    expect(onClose).not.toHaveBeenCalled();
  });
});
