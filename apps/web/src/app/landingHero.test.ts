import { describe, expect, test } from "vitest";
import { webpSize } from "./assetProbe";
import { insideAtRule, readAppFile, readAppStylesheet, ruleFor } from "./cssDeclarations";

/**
 * The hero: one centred column at every width, and a product shot that is
 * sharp on a phone.
 *
 * The shot's sizing came out of a measurement at 1280×900: on a phone it is
 * drawn at 232 CSS px, which a 3× screen paints with 696 device pixels from a
 * 390px file — a 1.78× upscale of the only product image on the public page,
 * which is why hero-home@2x.webp exists. The hero used to split into two
 * columns on a desktop, between the sign-in card and an illustrated chat
 * card; the phase-four collapse moved the chat card (and the shot, and the
 * value cards) below the fold, leaving the hero nothing to put in a second
 * column, so it is capped at .pizo-home's own 720px width and centred
 * instead — for everybody, invite or not.
 */
const landingCss = readAppStylesheet("app-landing.css");
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

describe("the hero is one centred column at every width", () => {
  test("there is a wrapper for the copy column", () => {
    // Without it the hero's children are grid items with nothing tying the
    // eyebrow, headline, lede and button together as one column.
    expect(page).toContain('className="landing-hero-copy"');
    expect(ruleFor(landingCss, ".landing-hero-copy").display).toBe("grid");
  });

  test("it never grows a second column, at the base rule or the wide one", () => {
    // The phase-four collapse removed what used to sit in a second column —
    // this is a regression guard against it quietly coming back. Checked on
    // both the unqualified rule and the one inside the 760px query: a
    // two-column layout added to either would slip past a check of only one.
    const hero = ruleFor(landingCss, ".landing-hero");
    expect(hero["grid-template-columns"]).toBeUndefined();
    expect(hero.display).toBe("grid");

    expect(wide).toBeTruthy();
    expect(ruleFor(wide, ".landing-hero")["grid-template-columns"]).toBeUndefined();
  });

  test("it caps at the app's own width once there is room to, and centres", () => {
    // 720px is .pizo-home's number (app-base.css): on a wide screen this app
    // spends the room on whitespace, not on a column it has nothing left to
    // fill now that the chat card and the shot both moved below the fold.
    expect(ruleFor(wide, ".landing-hero").width).toBe("min(720px, 100%)");
    expect(ruleFor(wide, ".landing-hero")["justify-items"]).toBe("center");
    expect(ruleFor(wide, ".landing-hero-copy")["justify-items"]).toBe("center");
  });

  test("mobile keeps it ragged left, the way a headline reads best", () => {
    const copy = ruleFor(landingCss, ".landing-hero-copy");
    expect(copy["justify-items"]).toBe("start");
    expect(copy["text-align"]).toBe("start");
  });

  test("an invite card fills the width the hero's own padding leaves it", () => {
    // Not the bare .landing-invite selector: the width that actually cascades
    // here comes from the more specific .landing-hero .landing-invite rule,
    // so a rule on the bare class would be dead weight the cascade never
    // reaches.
    expect(ruleFor(landingCss, ".landing-hero .landing-invite").width).toBe("100%");
  });

  test("but is capped narrow again once the hero itself is wide enough to make 100% too wide", () => {
    // Without this a card meant to be a small, answerable notice would
    // stretch to the same 720px the headline gets.
    expect(ruleFor(wide, ".landing-hero .landing-invite").width).toBe("min(400px, 100%)");
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
