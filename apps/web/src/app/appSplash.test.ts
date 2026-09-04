// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { dismissAppSplash } from "./appSplash";
import { insideAtRule, keyframesBody, readAppFile, ruleFor } from "./cssDeclarations";

/**
 * The launch screen itself is markup and CSS inside index.html, on purpose:
 * it has to paint from the HTML alone, before this bundle exists. Nothing that
 * mounts a component can see it, so it is asserted against the file.
 */
const indexHtml = readAppFile("..", "..", "index.html");

/** The ms values in an `animation` shorthand, in the order they appear. */
function timings(shorthand: string): number[] {
  return [...shorthand.matchAll(/(\d+(?:\.\d+)?)m?s\b/g)].map(([value]) =>
    value.endsWith("ms") ? Number.parseFloat(value) : Number.parseFloat(value) * 1000,
  );
}

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

describe("the launch screen says it is loading", () => {
  const track = ruleFor(indexHtml, "#app-splash .splash-progress");
  const bar = ruleFor(indexHtml, "#app-splash .splash-progress span");

  test("there is an indicator in the markup, not only a mark", () => {
    // The mark alone was read as a stalled black screen: on this connection the
    // wait is the entry bundle, and a logo breathing at 4.5% does not say why
    // nothing is happening.
    expect(indexHtml).toContain('<div class="splash-progress"');
    expect(track.width).toBeTruthy();
  });

  test("it stays out of the way of a fast load", () => {
    // Hidden until the wait is long enough to be worth explaining - otherwise
    // every quick open gains a progress bar that flashes and leaves.
    expect(track.opacity).toBe("0");

    const [, delay] = timings(track.animation ?? "");
    expect(delay).toBeGreaterThanOrEqual(600);
  });

  test("the bar crosses the whole track, both ends clear of it", () => {
    const shuttle = keyframesBody(indexHtml, "equo-splash-shuttle");
    const [from, to] = [...shuttle.matchAll(/translateX\((-?\d+(?:\.\d+)?)%\)/g)].map(([, value]) =>
      Number.parseFloat(value),
    );

    // translateX is a share of the SPAN's own width, so carrying its near edge
    // across a full track takes 100/width of it. Anything less and the bar
    // parks half-shown at one end instead of passing through - which is what
    // ties these two numbers together and why the check is arithmetic rather
    // than a fixed 223.
    const width = Number.parseFloat(bar.width ?? "0");
    expect(from).toBeLessThanOrEqual(-100);
    expect(to).toBeGreaterThanOrEqual(100 / (width / 100));
  });

  test("the bar does not start moving before its track has arrived", () => {
    // Two animations, one indicator: a stripe sliding across nothing.
    const [, trackDelay] = timings(track.animation ?? "");
    const [, barDelay] = timings(bar.animation ?? "");

    expect(barDelay).toBe(trackDelay);
  });

  test("reduced motion still shows something alive, without moving anything", () => {
    const reduced = ruleFor(insideAtRule(indexHtml, "prefers-reduced-motion"), "#app-splash .splash-progress span");
    const name = (reduced.animation ?? "").split(" ")[0];

    // Not "no animation": somebody who asked for less motion still has to be
    // able to tell loading apart from hung.
    expect(name).toBeTruthy();
    expect(keyframesBody(indexHtml, name)).not.toContain("transform");
    expect(keyframesBody(indexHtml, name)).toContain("opacity");
  });
});
