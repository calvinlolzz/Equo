// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { dismissAppSplash } from "./appSplash";
import { insideAtRule, keyframesBody, readAppFile, ruleFor, styleBlocks } from "./cssDeclarations";

/**
 * The launch screen itself is markup and CSS inside index.html, on purpose:
 * it has to paint from the HTML alone, before this bundle exists. Nothing that
 * mounts a component can see it, so it is asserted against the file.
 */
const indexHtml = readAppFile("..", "..", "index.html");
/** Its rules, lifted out of <style> - see styleBlocks for why that matters. */
const splashCss = styleBlocks(indexHtml);

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
  const track = ruleFor(splashCss, "#app-splash .splash-progress");
  const bar = ruleFor(splashCss, "#app-splash .splash-progress span");

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
    const shuttle = keyframesBody(splashCss, "equo-splash-shuttle");
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

  test("the cover is named, so it reads as an app opening", () => {
    // A mark on its own is a shape you have to already recognise. The name is
    // what separates "Equo is starting" from "this page failed to load", which
    // is what the near-black version kept being reported as.
    expect(indexHtml).toContain('<div class="splash-wordmark"');
    expect(ruleFor(splashCss, "#app-splash .splash-wordmark").font).toContain("800");
  });

  test("the cover is the app's own field, not a flat black", () => {
    const shell = ruleFor(splashCss, "#app-splash");

    // Same recipe as `body` in app-base.css, so lifting the cover reveals the
    // same background instead of cutting between two different darks.
    expect(shell.background).toContain("radial-gradient");
    expect(shell.background).toContain("109, 226, 184");
    expect(shell.background).toContain("255, 214, 122");
  });

  test("the mark turns, and only after it has finished being drawn", () => {
    const ring = ruleFor(splashCss, "#app-splash .splash-ring");
    const arc = ruleFor(splashCss, "#app-splash path");
    const gold = ruleFor(splashCss, "#app-splash .splash-arc-gold");

    expect(keyframesBody(splashCss, "equo-splash-spin")).toContain("rotate");

    // Arithmetic, not a copied number: the second arc starts late, so the draw
    // is over at (its delay + the duration). Starting the spin before that
    // rotates a half-drawn mark.
    const [drawMs] = timings(arc.animation ?? "");
    const [staggerMs] = timings(gold["animation-delay"] ?? "0s");
    const [, spinDelay] = timings(ring.animation ?? "");

    expect(drawMs).toBeGreaterThan(0);
    expect(spinDelay).toBeGreaterThanOrEqual(drawMs + staggerMs);
  });

  test("the plate stays put while the ring turns", () => {
    // The rotation is on the group around the two arcs. Put it on the <svg>
    // and the rounded plate turns with them, which is a box tumbling rather
    // than something loading.
    expect(ruleFor(splashCss, "#app-splash svg").animation).toBeUndefined();
    expect(ruleFor(splashCss, "#app-splash .splash-ring").animation).toBeTruthy();
  });

  test("reduced motion still shows something alive, without moving anything", () => {
    const calm = insideAtRule(splashCss, "prefers-reduced-motion");
    const reduced = ruleFor(calm, "#app-splash .splash-progress span");
    const name = (reduced.animation ?? "").split(" ")[0];

    // Not "no animation": somebody who asked for less motion still has to be
    // able to tell loading apart from hung.
    expect(name).toBeTruthy();
    expect(keyframesBody(splashCss, name)).not.toContain("transform");
    expect(keyframesBody(splashCss, name)).toContain("opacity");

    // The spin, though, is exactly the kind of thing they turned off.
    expect(ruleFor(calm, "#app-splash .splash-ring").animation).toBe("none");
  });
});
