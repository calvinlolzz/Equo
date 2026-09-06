// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { SCROLLING_ATTR, SETTLE_MS, initScrollActivity } from "./scrollActivity";

let stop: (() => void) | null = null;

function scrollOn(element: EventTarget) {
  // Exactly how the browser dispatches it: scroll does NOT bubble.
  element.dispatchEvent(new Event("scroll", { bubbles: false }));
}

beforeEach(() => {
  vi.useFakeTimers();
  stop = initScrollActivity();
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
  document.body.innerHTML = "";
});

describe("scroll activity", () => {
  test("nothing is set on a still page", () => {
    expect(document.documentElement.hasAttribute(SCROLLING_ATTR)).toBe(false);
  });

  test("a scroll anywhere marks the page as moving", () => {
    scrollOn(document);

    expect(document.documentElement.hasAttribute(SCROLLING_ATTR)).toBe(true);
  });

  test("a sheet scrolling inside itself counts too", () => {
    // The reason the listener captures: `scroll` does not bubble, so a listener
    // waiting for it to arrive would only ever hear the page, and every bottom
    // sheet in this app has its own scroller.
    const sheet = document.createElement("div");
    document.body.appendChild(sheet);

    scrollOn(sheet);

    expect(document.documentElement.hasAttribute(SCROLLING_ATTR)).toBe(true);
  });

  test("it clears once the scrolling stops", () => {
    scrollOn(document);
    vi.advanceTimersByTime(SETTLE_MS + 1);

    expect(document.documentElement.hasAttribute(SCROLLING_ATTR)).toBe(false);
  });

  test("a long scroll never lets it clear halfway", () => {
    scrollOn(document);
    for (let i = 0; i < 20; i += 1) {
      vi.advanceTimersByTime(SETTLE_MS - 20);
      scrollOn(document);
      expect(document.documentElement.hasAttribute(SCROLLING_ATTR)).toBe(true);
    }

    vi.advanceTimersByTime(SETTLE_MS + 1);
    expect(document.documentElement.hasAttribute(SCROLLING_ATTR)).toBe(false);
  });

  test("the attribute is written once per gesture, not once per event", () => {
    // Every write is a style recalculation over the very elements this exists
    // to make cheaper; a per-event write would cost more than it saves.
    const setAttribute = vi.spyOn(document.documentElement, "setAttribute");

    for (let i = 0; i < 30; i += 1) scrollOn(document);

    expect(setAttribute).toHaveBeenCalledTimes(1);
  });

  test("stopping puts everything back", () => {
    scrollOn(document);
    stop?.();
    stop = null;
    scrollOn(document);

    expect(document.documentElement.hasAttribute(SCROLLING_ATTR)).toBe(false);
  });
});
