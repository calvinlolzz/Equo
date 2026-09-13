import { describe, expect, test } from "vitest";
import { webpSize } from "./assetProbe";
import { insideAtRule, readAppFile, readAppStylesheet, ruleFor } from "./cssDeclarations";

/**
 * The hero: two columns once there is room, and a product shot that is sharp
 * on a phone.
 *
 * The shot's sizing came out of a measurement at 1280×900: on a phone it is
 * drawn at 232 CSS px, which a 3× screen paints with 696 device pixels from a
 * 390px file — a 1.78× upscale of the only product image on the public page,
 * which is why hero-home@2x.webp exists. The two-column split used to be
 * between the sign-in card and that shot; the shot has since moved into the
 * value section (see LandingPage.test.tsx), and the hero's right column is
 * now the illustrated chat card, or the invite card when one is present.
 */
const landingCss = readAppStylesheet("app-landing.css");
const desktop = insideAtRule(landingCss, "(min-width: 900px)");
const wide = insideAtRule(landingCss, "(min-width: 760px)");
const page = readAppFile("LandingPage.tsx");

describe("the product shot is sharp on a retina phone", () => {
  test("both densities ship, and the 2x really is twice the 1x", () => {
    const one = webpSize("screenshots/hero-home.webp");
    const two = webpSize("screenshots/hero-home@2x.webp");

    expect(one).toMatchObject({ width: 390, height: 416 });
    expect(two).toMatchObject({ width: 780, height: 832 });
  });

  test("780px covers the densest phone this is drawn on", () => {
    // 232 CSS px at the mobile size (measured), times a 3x screen.
    expect(webpSize("screenshots/hero-home@2x.webp").width).toBeGreaterThanOrEqual(232 * 3);
  });

  test("the extra file is worth what it costs", () => {
    // The point of the pair is that a 1x screen never pays for the 2x. If the
    // 2x ever grows past ~60 kB, re-encode rather than ship it.
    expect(webpSize("screenshots/hero-home@2x.webp").bytes).toBeLessThan(60_000);
    expect(webpSize("screenshots/hero-home.webp").bytes).toBeLessThan(webpSize("screenshots/hero-home@2x.webp").bytes);
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

  test("it is served at its native size on a wide screen, so nothing downscales it", () => {
    expect(ruleFor(wide, ".landing-shot").width).toBe("390px");
    expect(webpSize("screenshots/hero-home.webp").width).toBe(390);
  });
});

describe("the hero is two columns on a desktop", () => {
  test("there is a wrapper for the copy column", () => {
    // Without it the hero's children are grid items with nothing tying the
    // eyebrow, headline, lede and button together as one column.
    expect(page).toContain('className="landing-hero-copy"');
    expect(ruleFor(landingCss, ".landing-hero-copy").display).toBe("grid");
  });

  test("the columns only appear when there is room for both at full size", () => {
    expect(desktop).toBeTruthy();
    expect(ruleFor(desktop, ".landing-hero")["grid-template-columns"]).toContain("390px");
  });

  test("the copy and the aside are placed explicitly, not by DOM order", () => {
    // The invite card and the chat card never render together, so they can
    // share a cell — but a phone needs the invite FIRST in the DOM (so it
    // leads on mobile) while a desktop needs it on the right regardless. That
    // is only possible with explicit placement, not grid-auto-flow.
    expect(ruleFor(desktop, ".landing-hero-copy")["grid-column"]).toBe("1");
    expect(ruleFor(desktop, ".landing-chat")["grid-column"]).toBe("2");
    expect(ruleFor(desktop, ".landing-hero .landing-invite")["grid-column"]).toBe("2");
  });

  test("mobile keeps the single stacked column", () => {
    // The hero's own base rule must not carry the desktop layout, or a phone
    // gets it too.
    const hero = ruleFor(landingCss, ".landing-hero");
    expect(hero["grid-template-columns"]).toBeUndefined();
    expect(hero.display).toBe("grid");
  });

  test("an invite arrives in the same column as the chat card it replaces", () => {
    // Not the bare .landing-invite selector: the width that actually cascades
    // here comes from the more specific .landing-hero .landing-invite rule
    // (100% of the fixed 390px track), so a rule on the bare class would be
    // dead weight the cascade never reaches.
    expect(ruleFor(landingCss, ".landing-hero .landing-invite").width).toBe("100%");
  });
});

describe("the sign-in button is allowed to be the width it declares", () => {
  test("full width on a phone, where every pixel is its own", () => {
    expect(ruleFor(landingCss, ".landing-cta").width).toBe("100%");
  });

  test("its own size once the row has room to spare", () => {
    expect(ruleFor(wide, ".landing-cta").width).toBe("auto");
  });
});

describe("the landing stylesheet is written in tokens, not the design's hex", () => {
  test("no hex colour literal survives the port", () => {
    // The mockup this was built from used literal hex everywhere. Every one
    // of them had to be translated to an app token (rgb(var(--x))) so the
    // page actually follows the app's real light/dark theming instead of
    // being frozen to one palette.
    const withoutComments = landingCss.replace(/\/\*[\s\S]*?\*\//g, "");
    const hexLiterals = withoutComments.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [];

    expect(hexLiterals).toEqual([]);
  });
});

describe("the chat card carries the app's own surface", () => {
  test("it is glass, like every other card on the page", () => {
    // Left as a flat box it would only ever look right in one theme — the
    // theme the mockup happened to be reviewed in.
    expect(page).toContain('className="landing-chat glass-panel"');
  });
});

describe("the disclosure label stays readable", () => {
  test("it is not fainter than the demo label it replaced", () => {
    // Pinned, not just "present": a first pass shipped this at 0.45, which
    // measured under AA against a light-theme card. 0.6 is what the demo
    // card's own label used, and is the floor for the one string on the page
    // whose whole job is to stop four invented lines from being read as real.
    expect(ruleFor(landingCss, ".landing-chat-label").color).toBe("rgb(var(--fg) / 0.6)");
  });
});

describe("the invite card is centred on a phone, not shoved to one side", () => {
  test("the gutter is not subtracted twice", () => {
    // .landing-invite's own width formula (kept untouched below) assumes a
    // hero with no horizontal padding of its own — true before this hero
    // grew one to host the full-width chat card. Without the override this
    // rule adds, a 375px phone at the 20px gutter floor computes
    // min(400, 375 - 40) = 335px against a hero that is ALSO already inset
    // by the gutter: 40px too narrow, sitting flush left instead of centred.
    expect(ruleFor(landingCss, ".landing-hero .landing-invite").width).toBe("100%");
    // The rule it overrides is still there, untouched, for anything that
    // might use .landing-invite outside this hero someday.
    expect(ruleFor(landingCss, ".landing-invite").width).toBe("min(400px, calc(100% - 2 * var(--landing-gutter)))");
  });
});
