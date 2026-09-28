import { describe, expect, test } from "vitest";
import { readAppStylesheet, ruleFor } from "./cssDeclarations";

/**
 * Fix 4: one primary-action colour (the --cta gradient with --ink text) in
 * both themes, instead of --accent - which passed AA in dark mode but was a
 * real failure in light mode (~3.3:1, saturated blue with white text). See
 * the plan's "one primary colour" rationale and the measured contrast table
 * this file's own test reproduces below.
 */

const homeCss = readAppStylesheet("app-home.css");
const baseCss = readAppStylesheet("app-base.css");
const composerCss = readAppStylesheet("app-composer.css");
const miscCss = readAppStylesheet("app-misc.css");
const dialogsCss = readAppStylesheet("app-dialogs.css");

const PRIMARY_SELECTORS: Array<{ css: string; selector: string }> = [
  { css: homeCss, selector: ".primary-action" },
  { css: baseCss, selector: ".create-submit" },
  { css: composerCss, selector: ".composer-submit-full" },
  { css: composerCss, selector: ".composer-step-next" },
  { css: miscCss, selector: ".install-hint-action" },
  { css: homeCss, selector: ".floating-action" },
  { css: dialogsCss, selector: ".mobile-tab-center" },
];

const NEUTRAL_SELECTORS: Array<{ css: string; selector: string }> = [
  { css: homeCss, selector: ".secondary-action" },
  { css: composerCss, selector: ".composer-mini-action" },
  { css: dialogsCss, selector: ".record-swipe-action" },
];

describe("every primary action shares one colour", () => {
  test.each(PRIMARY_SELECTORS)("$selector uses --cta / --ink", ({ css, selector }) => {
    const rule = ruleFor(css, selector);
    expect(rule.background).toBe("var(--cta)");
    expect(rule.color).toBe("rgb(var(--ink))");
  });
});

describe("the neutral secondary style carries no brand colour", () => {
  test.each(NEUTRAL_SELECTORS)("$selector", ({ css, selector }) => {
    const rule = ruleFor(css, selector);
    const declared = `${rule.background ?? ""} ${rule.color ?? ""}`;
    expect(declared).not.toContain("--gold");
    expect(declared).not.toContain("--accent");
    expect(declared).not.toContain("--cta");
  });

  // [MV]
  test("the light-theme .secondary-action override is gone - colour now comes from the shared rule alone", () => {
    expect(ruleFor(homeCss, ':root[data-theme="light"] .secondary-action').background).toBeUndefined();
  });
});

/** #RRGGBB -> [r, g, b], 0-255 each. */
function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.replace("#", "");
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
}

/** WCAG relative luminance. */
function luminance([r, g, b]: [number, number, number]): number {
  const channel = (value: number) => {
    const v = value / 255;
    return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
  };
  const [rl, gl, bl] = [channel(r), channel(g), channel(b)];
  return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
}

/** WCAG contrast ratio between two sRGB colours. */
function contrast(a: [number, number, number], b: [number, number, number]): number {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

/** The two #hex stops out of `linear-gradient(...deg, #aaa, #bbb)`. */
function gradientStops(value: string): [string, string] {
  const hexes = value.match(/#[0-9a-fA-F]{6}/g);
  if (!hexes || hexes.length !== 2) throw new Error(`expected 2 hex stops in "${value}"`);
  return [hexes[0], hexes[1]];
}

/** --ink's "R G B" triplet as three numbers. */
function inkTriplet(css: string, selector: string): [number, number, number] {
  const value = ruleFor(css, selector)["--ink"];
  if (!value) throw new Error(`no --ink on ${selector}`);
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length !== 3 || parts.some(Number.isNaN)) throw new Error(`unparsable --ink: "${value}"`);
  return parts as [number, number, number];
}

describe("--cta clears AA text contrast against --ink at every stop, in both themes", () => {
  test.each([
    ["dark", ":root"],
    ["light", ':root[data-theme="light"]'],
  ] as const)("%s", (_label, selector) => {
    const cta = ruleFor(baseCss, selector)["--cta"];
    if (!cta) throw new Error(`no --cta on ${selector}`);
    const ink = inkTriplet(baseCss, selector);

    for (const stop of gradientStops(cta)) {
      // [MV]
      expect(contrast(hexToRgb(stop), ink)).toBeGreaterThanOrEqual(4.5);
    }
  });
});
