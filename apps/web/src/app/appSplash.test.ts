// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { dismissAppSplash } from "./appSplash";

function mountSplash(): HTMLElement {
  document.body.innerHTML = `<div id="app-splash"></div><div id="root"></div>`;
  return document.getElementById("app-splash") as HTMLElement;
}

describe("dismissAppSplash", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = "";
  });

  test("fades the splash, then takes it out of the tree", () => {
    const splash = mountSplash();

    dismissAppSplash();

    // The class drives the fade; the node has to survive it to be seen.
    expect(splash.classList.contains("is-ready")).toBe(true);
    expect(document.getElementById("app-splash")).not.toBeNull();

    vi.runAllTimers();

    // Removed, not merely transparent: a fixed inset:0 element left behind is a
    // sheet of glass over the whole app.
    expect(document.getElementById("app-splash")).toBeNull();
  });

  test("transitionend removes it without waiting for the timer", () => {
    const splash = mountSplash();

    dismissAppSplash();
    splash.dispatchEvent(new Event("transitionend"));

    expect(document.getElementById("app-splash")).toBeNull();
  });

  test("the timer still removes it when no transition ever fires", () => {
    // Reduced motion, a backgrounded tab, or the CSS give-up backstop having
    // already hidden it — transitionend is not guaranteed in any of those.
    mountSplash();

    dismissAppSplash();
    vi.runAllTimers();

    expect(document.getElementById("app-splash")).toBeNull();
  });

  test("calling it twice is harmless", () => {
    const splash = mountSplash();

    dismissAppSplash();
    dismissAppSplash();
    splash.dispatchEvent(new Event("transitionend"));
    vi.runAllTimers();

    expect(document.getElementById("app-splash")).toBeNull();
  });

  test("no splash in the document is a no-op, not a crash", () => {
    document.body.innerHTML = `<div id="root"></div>`;

    expect(() => dismissAppSplash()).not.toThrow();
    vi.runAllTimers();
  });
});
