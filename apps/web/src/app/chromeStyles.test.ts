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
const homeCss = readAppStylesheet("app-home.css");
const dialogCss = readAppStylesheet("app-dialogs.css");
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

describe("a page in motion", () => {
  test("a resizing sheet drops its shadow too", () => {
    // 0 24px 80px is an 80px blur radius redrawn on every frame the box
    // changes size. Resizing only: a scrolling card keeps its shadow, which is
    // the only thing separating it from the field.
    expect(ruleFor(baseCss, ":root[data-resizing] .glass-panel")["box-shadow"]).toBe("none");
    // Scrolling never had its own shadow rule to begin with - assert the
    // selector itself carries no declarations, not just that one property is
    // missing (which would also be true, vacuously, of a selector that no
    // longer exists at all).
    expect(ruleFor(baseCss, ":root[data-scrolling] .glass-panel")).toEqual({});
  });
});

describe("every surface that shows a group cover", () => {
  /**
   * A cover box must set its own height. Twice now one has not, and both times
   * the symptom was the same: the <img> inside is `height: 100%`, a percentage
   * against an auto height resolves to auto, and the photo's own proportions
   * become the box. A portrait phone shot then turns a 178px preview into a
   * 423px wall — measured — which in the edit dialog pushed the name, the
   * currency, the budget and both buttons off the bottom of the sheet.
   *
   * 16:9 is also the honest shape: it is what the cover is cropped to
   * everywhere it is actually shown.
   */
  test("has a shape of its own, so the photo cannot set it", () => {
    for (const [css, selector] of [
      [homeCss, ".side-cover"],
      [dialogCss, ".group-edit-cover"],
    ] as const) {
      const rule = ruleFor(css, selector);

      expect(rule["aspect-ratio"]).toBe("16 / 9");
      // And a ceiling, so a wide screen does not hand the whole sheet to it.
      expect(rule["max-height"]).toBeTruthy();
    }
  });
});
