import { describe, expect, test } from "vitest";
import { insideAtRule, readAppStylesheet, ruleFor } from "./cssDeclarations";

/**
 * The band behind the status bar, asserted against the stylesheet.
 *
 * It exists because a standalone PWA paints under the status bar, so the clock
 * and the battery would otherwise sit on the drifting field. It is easy to get
 * wrong in one direction only: too heavy. The first version was fully opaque
 * for its top 62% and then ramped to nothing, which against a bright field read
 * as a black slab pasted across the top of the screen — reported as
 * 「上面那排黑色層有點怪怪的」.
 */
const mobileCss = insideAtRule(readAppStylesheet("app-composer.css"), "max-width: 620px");
const baseCss = readAppStylesheet("app-base.css");
const band = ruleFor(mobileCss, ".top-bar::before");

/** The alphas of the `--card-base` stops in a gradient, in order. */
function stopAlphas(background: string): number[] {
  return [...background.matchAll(/rgb\(var\(--card-base\)(?:\s*\/\s*([\d.]+))?\s*\)/g)].map(([, alpha]) =>
    alpha === undefined ? 1 : Number.parseFloat(alpha),
  );
}

describe("the status bar band", () => {
  const alphas = stopAlphas(band.background ?? "");

  test("there is one, and it is a gradient rather than a filled bar", () => {
    expect(band.background).toContain("linear-gradient");
    expect(alphas.length).toBeGreaterThanOrEqual(4);
  });

  test("it is dark enough where the clock sits", () => {
    // The whole reason it exists. Anything much lighter and the system text is
    // back on the moving field.
    expect(alphas[0]).toBeGreaterThanOrEqual(0.85);
  });

  test("and gone by the bottom, with no step on the way", () => {
    // Ends at nothing: a band that stops at a non-zero alpha draws a line
    // across the screen. Monotonic: a stop that goes back UP is a visible
    // seam in the middle of the fade.
    expect(alphas.at(-1)).toBe(0);
    expect([...alphas].sort((a, b) => b - a)).toEqual(alphas);
  });

  test("at least half of it is spent fading", () => {
    // The reported bug in one number. A two-stop ramp over the last third
    // banded visibly and put an edge where the eye lands; most of this box is
    // the app's own title row, whose text was legible on the bare field before
    // the band existed at all.
    const positions = [...(band.background ?? "").matchAll(/(\d+(?:\.\d+)?)%/g)].map(([, value]) =>
      Number.parseFloat(value),
    );
    const firstBelowFull = positions[alphas.findIndex((alpha) => alpha < (alphas[0] ?? 1))];

    expect(firstBelowFull).toBeLessThanOrEqual(50);
  });
});

describe("a sheet in motion", () => {
  test("does not carry its backdrop blur while it travels", () => {
    // A composited transform is nearly free; a backdrop blur on the same
    // element is not — it re-samples and re-blurs everything behind the panel
    // at its new position, every frame. These sheets are the largest blurred
    // surfaces in the app and the ones that move furthest, so the frost is
    // dropped for the 260ms it is moving and restored when it lands.
    // The class itself is put on by useDialogChrome; without this rule it is
    // a flag that costs a render and buys nothing.
    for (const selector of [".glass-panel.is-entering", ".glass-panel.closing"]) {
      expect(ruleFor(mobileCss, selector)["backdrop-filter"]).toBe("none");
    }
  });
});

describe("a page in motion", () => {
  test("the glass stops re-blurring while it is scrolled", () => {
    // 90% of the group home's viewport is inside a blurred surface, and a
    // backdrop-filter re-blurs what is behind the element at its NEW position -
    // so a flick convolves nearly the whole screen, every frame, at up to
    // 120Hz. Dropped for the length of the gesture and back at rest.
    const moving = ruleFor(baseCss, ":root[data-scrolling] .glass-panel")["backdrop-filter"] ?? "";

    expect(moving).not.toContain("blur");
    // The saturation stays: it is a per-pixel multiply, and it is what gives
    // the card its colour over the field. Dropping it too would visibly tint
    // the panel the moment a scroll started.
    expect(moving).toContain("saturate");
  });

  test("and while a sheet is changing size, for the same reason", () => {
    // useAnimatedHeight marks the page with data-resizing; without the selector
    // here that mark is a DOM write that buys nothing. The profile sheet's two
    // tabs are 420px apart, so this is a 280ms resize of the largest blurred
    // surface in the app.
    for (const theme of ["", '[data-theme="light"]']) {
      const moving = ruleFor(baseCss, `:root[data-resizing]${theme} .glass-panel`)["backdrop-filter"] ?? "";
      expect(moving).not.toContain("blur");
      expect(moving).toContain("saturate");
    }
  });

  test("a resizing sheet drops its shadow too", () => {
    // 0 24px 80px is an 80px blur radius redrawn on every frame the box
    // changes size. Resizing only: a scrolling card keeps its shadow, which is
    // the only thing separating it from the field.
    expect(ruleFor(baseCss, ":root[data-resizing] .glass-panel")["box-shadow"]).toBe("none");
    expect(ruleFor(baseCss, ":root[data-scrolling] .glass-panel")["box-shadow"]).toBeUndefined();
  });

  test("both themes, because the light one has its own glass", () => {
    const light = ruleFor(baseCss, ':root[data-scrolling][data-theme="light"] .glass-panel')["backdrop-filter"] ?? "";

    expect(light).not.toContain("blur");
    expect(light).toContain("saturate");
  });

  test("the surfaces with real content behind them keep their blur", () => {
    // The tab bar has rows scrolling under it and the scrims have the whole
    // app behind them. Those blurs are doing work you can see.
    expect(ruleFor(readAppStylesheet("app-home.css"), ".mobile-tab-bar")["backdrop-filter"]).toContain("blur");
    expect(ruleFor(readAppStylesheet("app-dialogs.css"), ".modal-backdrop")["backdrop-filter"]).toContain("blur");
  });
});
