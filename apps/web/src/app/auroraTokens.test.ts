import { describe, expect, test } from "vitest";
import { readAppFile, readAppStylesheet, ruleFor } from "./cssDeclarations";

/**
 * The 極光 (aurora) redesign, stage 1: static CSS gradients instead of the
 * WebGL field, and a re-tuned palette. Nothing here guards the OLD token
 * values (chromeStyles.test.ts and enterTransitions.test.tsx already cover
 * the blur budget) - this file is about the NEW surface: the tokens exist in
 * both themes, the body gradient is static, the glass panel has no blur left
 * to drop, and the one colour that has to agree across four unrelated files
 * actually does.
 */
const baseCss = readAppStylesheet("app-base.css");
const miscCss = readAppStylesheet("app-misc.css");
const dialogsCss = readAppStylesheet("app-dialogs.css");

/** Custom-property names (the `--x` keys) declared directly on a selector. */
function customPropertyNames(css: string, selector: string): string[] {
  return Object.keys(ruleFor(css, selector)).filter((key) => key.startsWith("--"));
}

describe("aurora tokens", () => {
  const NEW_TOKENS = [
    "--card-solid",
    "--card-big",
    "--edge",
    "--edge-2",
    "--member-1",
    "--member-2",
    "--member-3",
    "--cta",
    "--amount-glow",
    "--r-card",
    "--r-card-lg",
    "--r-button",
    "--r-tabbar",
  ];

  const darkKeys = customPropertyNames(baseCss, ":root");
  const lightKeys = customPropertyNames(baseCss, ':root[data-theme="light"]');

  test(":root declares every new aurora token", () => {
    for (const token of NEW_TOKENS) {
      expect(darkKeys).toContain(token);
    }
  });

  test(":root[data-theme=\"light\"] declares the same key set as :root", () => {
    // Symmetric difference, not a subset check either way: a token missing
    // from one side is exactly the bug this guards - a variable that resolves
    // to nothing (falls through to `unset`) the moment the theme flips.
    const onlyInDark = darkKeys.filter((key) => !lightKeys.includes(key));
    const onlyInLight = lightKeys.filter((key) => !darkKeys.includes(key));

    expect(onlyInDark).toEqual([]);
    expect(onlyInLight).toEqual([]);
  });
});

describe("the body field", () => {
  const body = ruleFor(baseCss, "body");

  test("is three radial gradients over the page's base gradient", () => {
    const layers = (body.background ?? "").match(/radial-gradient/g) ?? [];
    expect(layers.length).toBe(3);
    expect(body.background).toContain("linear-gradient");
  });

  test("is static - no animation, no will-change", () => {
    expect(body.animation).toBeUndefined();
    expect(body["will-change"]).toBeUndefined();
  });

  test("light mode keeps the same three-blob recipe, just quieter", () => {
    const light = ruleFor(baseCss, ':root[data-theme="light"] body');
    const layers = (light.background ?? "").match(/radial-gradient/g) ?? [];

    expect(layers.length).toBe(3);
    expect(light.animation).toBeUndefined();
    expect(light["will-change"]).toBeUndefined();
  });
});

describe(".glass-panel", () => {
  test("carries no backdrop-filter at all - there is no blur left to drop", () => {
    expect(ruleFor(baseCss, ".glass-panel")["backdrop-filter"]).toBeUndefined();
  });
});

describe("--page-1 agrees everywhere it is duplicated", () => {
  // The token itself is the only source of truth for the app's own paint;
  // these four other places all have to be handed the same colour by hand
  // because none of them can read a CSS custom property (a pre-JS <meta>, a
  // pre-JS inline <style>, and two files that are not CSS at all).
  test("app-base.css, themeStore.ts, index.html and site.webmanifest match, both themes", () => {
    const page1Dark = ruleFor(baseCss, ":root")["--page-1"];
    const page1Light = ruleFor(baseCss, ':root[data-theme="light"]')["--page-1"];

    const themeStoreTs = readAppFile("themeStore.ts");
    const indexHtml = readAppFile("..", "..", "index.html");
    const manifest = readAppFile("..", "..", "public", "site.webmanifest");

    expect(page1Dark).toBeTruthy();
    expect(page1Light).toBeTruthy();

    // themeStore.ts: THEME_COLORS = { dark: "#...", light: "#..." }
    expect(themeStoreTs).toContain(`dark: "${page1Dark}"`);
    expect(themeStoreTs).toContain(`light: "${page1Light}"`);

    // index.html only ships before JS runs, so it only ever shows the dark
    // (default) colour - both the <meta> and the splash's own gradient.
    expect(indexHtml).toContain(`<meta name="theme-color" content="${page1Dark}"`);
    expect(indexHtml).toContain(`linear-gradient(145deg, ${page1Dark}`);

    // site.webmanifest has one theme_color/background_color pair - the
    // dark/default launch colour, same reasoning as index.html above.
    const manifestJson = JSON.parse(manifest) as { theme_color: string; background_color: string };
    expect(manifestJson.theme_color.toUpperCase()).toBe(page1Dark.toUpperCase());
    expect(manifestJson.background_color.toUpperCase()).toBe(page1Dark.toUpperCase());
  });
});

describe("buttons inherit their ink", () => {
  /**
   * A <button> with no `color` of its own falls back to the UA's `buttontext`
   * — black — because this app never declares a color-scheme. Every button
   * class happened to set its own colour, so the hole stayed invisible until
   * the 極光 group-home rows shipped: 成員列 and the two 摘要行 toggles landed
   * in production with black names on a #10131A card. The base rule now
   * inherits, which is what every caller already assumed.
   */
  test("the base button rule sets color: inherit", () => {
    expect(ruleFor(baseCss, "button")["color"]).toBe("inherit");
  });
});

describe("warning-semantic rules use --warning, not the lavender --gold", () => {
  /**
   * --gold/--gold-ink carry the aurora lavender now (the secondary-button
   * hue), so a warning styled with them reads as a secondary button, not a
   * warning. These are every selector that used to borrow --gold/--gold-ink
   * for an offline/pending/over-budget/site-notice-warning/view-as state -
   * they must all point at the dedicated --warning/--warning-fill pair
   * instead, on every colour declaration the rule sets.
   */
  const cases: { css: string; selector: string; properties: string[] }[] = [
    { css: miscCss, selector: ".site-notice--warning", properties: ["border-color", "background"] },
    { css: miscCss, selector: ".site-notice--view-as", properties: ["border-color", "background"] },
    { css: miscCss, selector: ".site-notice-action", properties: ["background"] },
    { css: miscCss, selector: ".offline-banner", properties: ["border"] },
    { css: dialogsCss, selector: ".record-pending-badge", properties: ["background"] },
    { css: dialogsCss, selector: ".spend-period-change--up", properties: ["color"] },
    {
      css: dialogsCss,
      selector: ".spend-budget--over .spend-budget-bar > span",
      properties: ["background"],
    },
    { css: dialogsCss, selector: ".spend-budget--over .spend-budget-line", properties: ["color"] },
  ];

  for (const { css, selector, properties } of cases) {
    test(`${selector} reads --warning, not --gold`, () => {
      const declarations = ruleFor(css, selector);

      for (const property of properties) {
        const value = declarations[property];
        expect(value).toBeTruthy();
        expect(value).toContain("--warning");
        expect(value).not.toContain("--gold");
      }
    });
  }
});
