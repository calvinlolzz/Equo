import { readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { insideAtRule, readAppFile, readAppStylesheet, ruleFor } from "./cssDeclarations";

/**
 * The hero: two columns once there is room, and a product shot that is sharp on
 * a phone.
 *
 * Both came out of the same measurement at 1280×900. The shot rendered 266×284
 * and the sign-in card 220px wide, stacked in a ~270px ribbon down the middle
 * of a 1265px viewport — while the sections below it ran 860px. And on a phone
 * the shot is drawn at 232 CSS px, which a 3× screen paints with 696 device
 * pixels from a 390px file: a 1.78× upscale of the only product image on the
 * public page.
 */
const landingCss = readAppStylesheet("app-landing.css");
const desktop = insideAtRule(landingCss, "(min-width: 900px)");
const page = readAppFile("LandingPage.tsx");

const SCREENSHOTS = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "public", "screenshots");

/**
 * A WebP's real pixel dimensions, straight out of the file header.
 *
 * Read rather than trusted: the whole defect was a file whose size did not
 * match what the page asked of it, so a test that took the filename's word for
 * it would be checking the same assumption that failed.
 */
function webpSize(name: string): { width: number; height: number; bytes: number } {
  const buffer = readFileSync(join(SCREENSHOTS, name));
  expect(buffer.subarray(0, 4).toString("ascii")).toBe("RIFF");
  expect(buffer.subarray(8, 12).toString("ascii")).toBe("WEBP");
  // Simple lossy VP8: 3-byte frame tag, the 0x9D012A sync code, then two
  // 14-bit dimensions.
  expect(buffer.subarray(12, 16).toString("ascii")).toBe("VP8 ");
  expect([...buffer.subarray(23, 26)]).toEqual([0x9d, 0x01, 0x2a]);
  return {
    width: buffer.readUInt16LE(26) & 0x3fff,
    height: buffer.readUInt16LE(28) & 0x3fff,
    bytes: statSync(join(SCREENSHOTS, name)).size,
  };
}

describe("the product shot is sharp on a retina phone", () => {
  test("both densities ship, and the 2x really is twice the 1x", () => {
    const one = webpSize("hero-home.webp");
    const two = webpSize("hero-home@2x.webp");

    expect(one).toMatchObject({ width: 390, height: 416 });
    expect(two).toMatchObject({ width: 780, height: 832 });
  });

  test("780px covers the densest phone this is drawn on", () => {
    // 232 CSS px at the mobile size (measured), times a 3x screen.
    expect(webpSize("hero-home@2x.webp").width).toBeGreaterThanOrEqual(232 * 3);
  });

  test("the extra file is worth what it costs", () => {
    // The point of the pair is that a 1x screen never pays for the 2x. If the
    // 2x ever grows past ~60 kB, re-encode rather than ship it.
    expect(webpSize("hero-home@2x.webp").bytes).toBeLessThan(60_000);
    expect(webpSize("hero-home.webp").bytes).toBeLessThan(webpSize("hero-home@2x.webp").bytes);
  });

  test("the markup offers both, by density", () => {
    expect(page).toContain('srcSet="/screenshots/hero-home.webp 1x, /screenshots/hero-home@2x.webp 2x"');
    // The plain src stays as the fallback for anything that ignores srcset.
    expect(page).toContain('src="/screenshots/hero-home.webp"');
    // width/height are what reserve the space before it arrives; they describe
    // the 1x, which is what the intrinsic size resolves to under an x
    // descriptor either way.
    expect(page).toContain("width={390}");
    expect(page).toContain("height={416}");
  });
});

describe("the hero is two columns on a desktop", () => {
  test("there is a wrapper for the right column", () => {
    // Without it the four hero children are four grid items, and the three that
    // belong together can only spread down the full height of the shot.
    expect(page).toContain('className="landing-hero-panel"');
    const panel = ruleFor(landingCss, ".landing-hero-panel");
    expect(panel.display).toBe("grid");
    // Same gap as the hero's own, which is what makes the wrapper invisible on
    // a phone: shot, card, pitch, cue, all 18px apart, exactly as before.
    expect(panel.gap).toBe(ruleFor(landingCss, ".landing-hero").gap);
  });

  test("the columns only appear when there is room for both at full size", () => {
    // 390 (shot) + 400 (panel) + gap + gutters does not fit the 760px the
    // sections below switch at.
    expect(desktop).toBeTruthy();
    expect(ruleFor(desktop, ".landing-hero")["grid-auto-flow"]).toBe("column");
    expect(ruleFor(desktop, ".landing-hero")["justify-content"]).toBe("center");
    expect(ruleFor(desktop, ".landing-hero")["align-items"]).toBe("center");
  });

  test("the shot is served at its native size, so nothing downscales it", () => {
    expect(ruleFor(desktop, ".landing-hero-shot").width).toBe("390px");
    expect(webpSize("hero-home.webp").width).toBe(390);
  });

  test("an invite arrives in the same column as the shot it replaces", () => {
    expect(ruleFor(desktop, ".landing-invite").width).toBe("390px");
  });

  test("mobile keeps the single stacked column", () => {
    // The hero's own rule must not carry the desktop flow, or a phone gets it.
    const hero = ruleFor(landingCss, ".landing-hero");
    expect(hero["grid-auto-flow"]).toBeUndefined();
    expect(hero.display).toBe("grid");
  });
});

describe("the sign-in card is allowed to be the width it declares", () => {
  test("the login screen fills the hero so the card's 100% means something", () => {
    // .login-card is width: min(400px, 100%). Inside a shrink-to-fit parent the
    // 100% resolved against the card's own intrinsic width, so it came out at
    // 220px — on a desktop AND on a phone, where the Google button was 162px
    // against a 390px screen.
    expect(ruleFor(landingCss, ".landing-hero .login-screen").width).toBe("100%");
  });

  test("the panel is capped at the card's own maximum", () => {
    expect(ruleFor(landingCss, ".landing-hero-panel").width).toBe("min(400px, 100%)");
    expect(ruleFor(desktop, ".landing-hero-panel").width).toBe("400px");
  });
});
