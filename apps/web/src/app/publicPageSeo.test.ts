import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import {
  FAQ,
  PUBLIC_PAGES,
  SITE_ORIGIN,
  buildJsonLd,
  injectJsonLd,
  renderPublicPage,
} from "../../../../scripts/prerender-public-pages.mjs";
import { PRIVACY_POLICY_ZH, TERMS_OF_SERVICE_ZH } from "./i18n/legalZhHant";
import { ZH_HANT } from "./i18n/zhHant";
import { readAppFile } from "./cssDeclarations";
import { readManifest, webpSize } from "./assetProbe";

/**
 * What a crawler is served, which for months was the wrong thing.
 *
 * `/privacy` and `/terms` went through the SPA catch-all, so both were handed
 * the byte-identical index.html — carrying the HOME PAGE's canonical and the
 * home page's title. A canonical pointing elsewhere tells Google the page is a
 * duplicate and should not be indexed, about the two URLs sitemap.xml lists
 * and the Google OAuth consent screen points at.
 *
 * The prerender script that fixes it runs on built output, where the app's
 * modules no longer exist, so its copy is written out by hand. Everything
 * below is what stops that from drifting away from the app it describes.
 */
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const indexHtml = readFileSync(join(ROOT, "apps", "web", "index.html"), "utf8");
const vercelJson = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
const sitemap = readFileSync(join(ROOT, "apps", "web", "public", "sitemap.xml"), "utf8");

const head = (html: string, pattern: RegExp) => pattern.exec(html)?.[1] ?? "";
const titleOf = (html: string) => head(html, /<title>([^<]*)<\/title>/);
const canonicalOf = (html: string) => head(html, /<link rel="canonical" href="([^"]*)"/);
const descriptionOf = (html: string) => head(html, /<meta name="description" content="([^"]*)"/);
const ogDescriptionOf = (html: string) => head(html, /<meta property="og:description" content="([^"]*)"/);
const twitterDescriptionOf = (html: string) => head(html, /<meta name="twitter:description" content="([^"]*)"/);

describe("the legal pages stop claiming to be the home page", () => {
  const rendered = Object.fromEntries(PUBLIC_PAGES.map((page) => [page.path, renderPublicPage(indexHtml, page)] as const));

  test("each one canonicalises to itself", () => {
    expect(canonicalOf(rendered["/privacy"])).toBe(`${SITE_ORIGIN}/privacy`);
    expect(canonicalOf(rendered["/terms"])).toBe(`${SITE_ORIGIN}/terms`);
    // The bug, stated: they were all this.
    expect(canonicalOf(indexHtml)).toBe(`${SITE_ORIGIN}/`);
    expect(canonicalOf(rendered["/privacy"])).not.toBe(canonicalOf(indexHtml));
  });

  test("each one has its own title and description", () => {
    for (const page of PUBLIC_PAGES) {
      expect(titleOf(rendered[page.path])).toBe(page.title);
      expect(titleOf(rendered[page.path])).not.toBe(titleOf(indexHtml));
      expect(descriptionOf(rendered[page.path])).toBe(page.description);
      expect(descriptionOf(rendered[page.path])).not.toBe(descriptionOf(indexHtml));
    }
  });

  test("the title says what the document is actually called", () => {
    // The zh-Hant documents are the ones this HTML is in; legalContent picks a
    // language at runtime and that is not what a crawler gets.
    expect(rendered["/privacy"]).toContain(`<title>${PRIVACY_POLICY_ZH.title} — Equo</title>`);
    expect(rendered["/terms"]).toContain(`<title>${TERMS_OF_SERVICE_ZH.title} — Equo</title>`);
  });

  test("the share card follows the page rather than announcing the product", () => {
    for (const page of PUBLIC_PAGES) {
      expect(rendered[page.path]).toContain(`<meta property="og:url" content="${SITE_ORIGIN}${page.path}" />`);
      expect(rendered[page.path]).toContain(`<meta property="og:title" content="${page.title}" />`);
      expect(rendered[page.path]).toContain('<meta property="og:type" content="article" />');
    }
  });

  test("everything else about the page is untouched — same shell, same bundle", () => {
    const stripHead = (html: string) => html.slice(html.indexOf("</head>"));
    expect(stripHead(rendered["/privacy"])).toBe(stripHead(indexHtml));
  });

  test("a head that changes shape fails the build instead of doing nothing", () => {
    // Every replacement is anchored on a tag that has to be there. Silently
    // producing an unmodified copy is the failure mode worth refusing.
    expect(() => renderPublicPage("<html><head></head><body></body></html>", PUBLIC_PAGES[0])).toThrow(/could not find/);
  });
});

describe("the routes actually reach those files", () => {
  const rewrites: Array<{ source: string; destination: string }> = vercelJson.rewrites;

  test("/privacy and /terms are rewritten before the SPA catch-all swallows them", () => {
    const catchAll = rewrites.findIndex((rule) => rule.destination === "/index.html");
    const privacy = rewrites.findIndex((rule) => rule.source === "/privacy");
    const terms = rewrites.findIndex((rule) => rule.source === "/terms");

    expect(privacy).toBeGreaterThanOrEqual(0);
    expect(terms).toBeGreaterThanOrEqual(0);
    // Order is the whole mechanism: the catch-all matches these paths too.
    expect(privacy).toBeLessThan(catchAll);
    expect(terms).toBeLessThan(catchAll);
    expect(rewrites[privacy].destination).toBe("/privacy.html");
    expect(rewrites[terms].destination).toBe("/terms.html");
  });

  test("the build runs the prerender, or the files those rewrites point at do not exist", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts.build).toContain("prerender-public-pages.mjs");
  });

  test("what the sitemap lists is what the pages canonicalise to", () => {
    for (const page of PUBLIC_PAGES) {
      expect(sitemap).toContain(`<loc>${SITE_ORIGIN}${page.path}</loc>`);
    }
  });
});

describe("the landing page says what it is, in a form a machine reads", () => {
  const blocks = buildJsonLd();
  const injected = injectJsonLd(indexHtml, blocks);

  test("it is valid JSON in a script tag", () => {
    const found = [...injected.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    expect(found).toHaveLength(blocks.length);
    for (const [, json] of found) {
      expect(() => JSON.parse(json.replace(/\\u003c/g, "<"))).not.toThrow();
    }
  });

  test("nothing in it can close the script tag early", () => {
    // The answers are prose written by us, but this is the escaping that makes
    // that not matter.
    const withMarkup = injectJsonLd(indexHtml, [{ evil: "</script><img onerror=x>" }]);
    expect(withMarkup).not.toContain("</script><img");
    expect(withMarkup).toContain("\\u003c/script");
  });

  test("it describes a free web app, which is the page's own first claim", () => {
    const app = blocks.find((block) => block["@type"] === "WebApplication") as { offers: { price: string }; url: string };
    expect(app).toBeTruthy();
    expect(app.offers.price).toBe("0");
    expect(app.url).toBe(`${SITE_ORIGIN}/`);
  });

  // [MV: change one of the four to disagree]
  test("og/twitter/manifest/JSON-LD descriptions all say the same thing, and the meta description just prefixes it", () => {
    const app = blocks.find((block) => block["@type"] === "WebApplication") as { description: string };
    const manifest = readManifest();

    expect(ogDescriptionOf(indexHtml)).toBe(app.description);
    expect(twitterDescriptionOf(indexHtml)).toBe(app.description);
    expect(manifest.description).toBe(app.description);
    expect(descriptionOf(indexHtml)).toBe(`Equo 讓你${app.description}`);
  });

  test("the marked-up FAQ is the FAQ that is on the page", () => {
    // Google's requirement, and the reason this is pinned: markup that does not
    // match the visible text is worse than no markup.
    const faq = blocks.find((block) => block["@type"] === "FAQPage") as {
      mainEntity: Array<{ name: string; acceptedAnswer: { text: string } }>;
    };
    const asked = faq.mainEntity.map((entry) => entry.name);
    const answered = faq.mainEntity.map((entry) => entry.acceptedAnswer.text);

    const landing = ZH_HANT.landing;
    expect(asked).toEqual([landing.faq1Q, landing.faq2Q, landing.faq3Q, landing.faq4Q, landing.faq5Q]);
    expect(answered).toEqual([landing.faq1A, landing.faq2A, landing.faq3A, landing.faq4A, landing.faq5A]);
  });

  test("the FAQ constant in the script is that same list", () => {
    expect(FAQ).toHaveLength(5);
    expect(FAQ.map((entry) => entry.q)).toEqual([
      ZH_HANT.landing.faq1Q,
      ZH_HANT.landing.faq2Q,
      ZH_HANT.landing.faq3Q,
      ZH_HANT.landing.faq4Q,
      ZH_HANT.landing.faq5Q,
    ]);
  });

  test("the legal pages do not carry the landing page's FAQ", () => {
    // They are built from the original index.html for exactly this reason:
    // describing the home page's content on the privacy policy is a wrong
    // annotation, not a bonus one.
    for (const page of PUBLIC_PAGES) {
      expect(renderPublicPage(indexHtml, page)).not.toContain("FAQPage");
    }
  });
});

describe("the page's heading says what the page is", () => {
  const landing = readAppFile("LandingPage.tsx");

  test("the h1 is the proposition, not the brand", () => {
    expect(landing).toContain('<h1 className="landing-hero-title">{text.valueTitle}</h1>');
    // 「自己的錢記清楚，一起花的分清楚」 rather than 「Equo」.
    expect(ZH_HANT.landing.valueTitle.length).toBeGreaterThan(6);
  });

  test("there is exactly one h1 in the landing markup", () => {
    // The brand wordmark in the topbar is a <span>, not a heading — the same
    // property `brandIsHeading={false}` used to protect before the standalone
    // sign-in card (and that prop) were retired.
    const hero = landing.match(/<h1/g) ?? [];
    expect(hero).toHaveLength(1);
    expect(landing).toContain('<span className="landing-topbar-brand">');
  });
});

describe("the header's links point at sections that actually exist", () => {
  const landing = readAppFile("LandingPage.tsx");
  const anchors = [...landing.matchAll(/href="#([\w-]+)"/g)].map((match) => match[1]);

  test("the scan is actually finding anchors", () => {
    expect(anchors.length).toBeGreaterThan(0);
  });

  test("every #id the topbar links to has a matching id in the same file", () => {
    for (const id of anchors) {
      expect(landing).toContain(`id="${id}"`);
    }
  });
});

describe("the FAQ answer about data is as honest as the policy it links to", () => {
  test("it says the receipt photo goes to a third party", () => {
    // The page sells 拍收據，金額自動填 as one of three headline props while
    // this answer stopped at 「只有同一個群組的成員看得到」.
    const answer = ZH_HANT.landing.faq5A;
    expect(answer).toContain("Gemini");
    expect(answer).toContain("隱私權政策");
  });

  test("and it says what to do instead", () => {
    expect(ZH_HANT.landing.faq5A).toContain("不會送出去");
  });
});

describe("what the install prompt is served", () => {
  const manifest = readManifest();

  test("the screenshots are WebP, and every declared size is the file's real one", () => {
    // They were three PNGs totalling 715 kB, and Android fetches them to draw
    // the richer install prompt. Same shots as WebP at TWICE the resolution
    // come to 159 kB.
    for (const shot of manifest.screenshots) {
      expect(shot.type).toBe("image/webp");
      expect(shot.src.endsWith(".webp")).toBe(true);

      const file = webpSize(shot.src.replace(/^\//, ""));
      // A declared size that is not the file's is worse than none: Chrome lays
      // the prompt out from this and then paints something else into it.
      expect(`${file.width}x${file.height}`).toBe(shot.sizes);
    }
  });

  test("they are cheaper than the PNGs they replaced, at higher resolution", () => {
    const total = manifest.screenshots.reduce((sum, shot) => sum + webpSize(shot.src.replace(/^\//, "")).bytes, 0);
    expect(total).toBeLessThan(300_000);
    // 2x captures: a phone screenshot declared at 390x844 was being drawn on a
    // 3x screen out of 390 pixels.
    const narrow = manifest.screenshots.filter((shot) => shot.form_factor === "narrow");
    expect(narrow.length).toBeGreaterThanOrEqual(2);
    for (const shot of narrow) {
      expect(webpSize(shot.src.replace(/^\//, "")).width).toBeGreaterThanOrEqual(780);
    }
  });

  test("each form factor still has a label a person can read", () => {
    for (const shot of manifest.screenshots) {
      expect(shot.label.length).toBeGreaterThan(4);
      expect(["narrow", "wide"]).toContain(shot.form_factor);
    }
  });
});
