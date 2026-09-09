#!/usr/bin/env node
/**
 * Give the three crawlable pages heads of their own, and the landing page its
 * structured data.
 *
 * What this fixes
 * ---------------
 *
 * Equo is one SPA behind a catch-all rewrite, so `/privacy` and `/terms` were
 * served the byte-identical index.html the home page is served. Which means
 * both of them carried:
 *
 *     <link rel="canonical" href="https://equo-mu.vercel.app/" />
 *     <title>Equo — 輕鬆分帳</title>
 *
 * A canonical pointing somewhere else is not a small thing. It is the page
 * telling Google "I am a duplicate of that one, index that instead" — about
 * two documents that sitemap.xml explicitly lists, and that the Google OAuth
 * consent screen points at. They were asking not to exist.
 *
 * So: build-time copies of index.html with their own head. Not a router, not
 * SSR — the body is still the same empty #root and the same entry chunk, and
 * the SPA still renders the document client-side from resolvePublicPage(). The
 * only thing that differs is what a crawler reads before any of that runs.
 *
 * vercel.json rewrites /privacy → /privacy.html and /terms → /terms.html ahead
 * of the SPA catch-all. Rewrites do not change the address bar, so the app
 * still sees /privacy and still renders the right document.
 *
 * Why the copy lives here and not in the app
 * ------------------------------------------
 *
 * This runs on the built output, where the app's TypeScript no longer exists
 * as anything it could import. Rather than parse the dictionaries with a
 * regex and hope, the strings are written out below and prerenderedPages.test.ts
 * asserts every one of them against the module it came from. Drift fails the
 * suite rather than the page.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "apps", "web", "dist");

export const SITE_ORIGIN = "https://equo-mu.vercel.app";

/**
 * The head each public page gets.
 *
 * `title` and `description` are the two a search result is actually built out
 * of, and both were the home page's on all three.
 */
export const PUBLIC_PAGES = [
  {
    file: "privacy.html",
    path: "/privacy",
    title: "隱私權政策 — Equo",
    description: "Equo 蒐集什麼資料、存在哪裡、誰看得到，以及怎麼刪除帳號。包含掃描收據會把照片送給哪個第三方 AI 服務。",
  },
  {
    file: "terms.html",
    path: "/terms",
    title: "服務條款 — Equo",
    description: "使用 Equo 的條款：帳號、你的內容、我們不做什麼，以及責任範圍。",
  },
];

/**
 * The FAQ, as structured data.
 *
 * The biggest block on the landing page is five questions and five answers,
 * which is the exact shape FAQPage exists to describe. Google requires the
 * marked-up text to be the text on the page, so these are the strings from
 * uiText — pinned by the test, because a copy edit that left this behind would
 * turn a correct annotation into a wrong one.
 *
 * Answers are trimmed to their first sentence only where the full answer would
 * be misleading out of context — they are not. They are the full answers.
 */
export const FAQ = [
  {
    q: "要付費嗎？",
    a: "不用。目前完全免費，也沒有廣告。",
  },
  {
    q: "一定要用 Google 登入嗎？",
    a: "目前只有 Google 一種。這樣群組裡的人知道彼此是誰，你也不用再記一組密碼。",
  },
  {
    q: "朋友沒有帳號，可以一起分嗎？",
    a: "可以。群組裡能建立「虛擬成員」，沒有帳號的人一樣能被記帳、被分攤。",
  },
  {
    q: "需要下載 App 嗎？",
    a: "不用，瀏覽器打開就能用。想要的話可以「加到主畫面」，用起來跟 App 一樣。",
  },
  {
    q: "我的資料誰看得到？",
    a: "只有同一個群組的成員看得到那個群組的帳。我們不賣資料、不放廣告，你也可以隨時在個人資料頁刪掉整個帳號。用掃描收據時，那張照片會送給 Google Gemini 辨識，Google 可能拿它改善產品、也可能有人員讀到——不想這樣就用表單裡的照片功能，照片一樣附在支出上但不會送出去。詳見隱私權政策第 3 節。",
  },
];

/** What the landing page is, in the vocabulary a search engine indexes. */
export function buildJsonLd() {
  return [
    {
      "@context": "https://schema.org",
      "@type": "WebApplication",
      name: "Equo",
      url: `${SITE_ORIGIN}/`,
      applicationCategory: "FinanceApplication",
      operatingSystem: "Web",
      inLanguage: "zh-Hant",
      description: "和朋友、室友、旅伴輕鬆記帳分帳，自動算出誰欠誰、一鍵結清。",
      // Free is the single most load-bearing fact on the page and the first
      // thing the FAQ answers, so it is said here in the form that can be read
      // without parsing prose.
      offers: { "@type": "Offer", price: "0", priceCurrency: "TWD" },
    },
    {
      "@context": "https://schema.org",
      "@type": "FAQPage",
      mainEntity: FAQ.map((entry) => ({
        "@type": "Question",
        name: entry.q,
        acceptedAnswer: { "@type": "Answer", text: entry.a },
      })),
    },
  ];
}

/**
 * `</script>` inside JSON would end the block early, and `<!--` would open a
 * comment. Both are escaped rather than stripped: the text has to survive
 * intact, it just must not be parseable as markup.
 */
function safeJson(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

/** Swap one tag's content, failing loudly rather than silently doing nothing. */
export function replaceTag(html, pattern, replacement, what) {
  if (!pattern.test(html)) {
    throw new Error(`prerender: could not find ${what} in index.html — the head changed shape`);
  }
  return html.replace(pattern, replacement);
}

export function renderPublicPage(indexHtml, page) {
  let html = indexHtml;

  html = replaceTag(html, /<title>[^<]*<\/title>/, `<title>${page.title}</title>`, "<title>");
  html = replaceTag(
    html,
    /<meta name="description" content="[^"]*" \/>/,
    `<meta name="description" content="${page.description}" />`,
    "the description meta",
  );
  html = replaceTag(
    html,
    /<link rel="canonical" href="[^"]*" \/>/,
    `<link rel="canonical" href="${SITE_ORIGIN}${page.path}" />`,
    "the canonical link",
  );
  // The social card follows the page too. A privacy policy shared into a chat
  // announcing itself as the product's home page is a small lie that the
  // crawler caches for months.
  html = replaceTag(
    html,
    /<meta property="og:title" content="[^"]*" \/>/,
    `<meta property="og:title" content="${page.title}" />`,
    "og:title",
  );
  html = replaceTag(
    html,
    /<meta property="og:url" content="[^"]*" \/>/,
    `<meta property="og:url" content="${SITE_ORIGIN}${page.path}" />`,
    "og:url",
  );
  html = replaceTag(
    html,
    /<meta property="og:description" content="[^"]*" \/>/,
    `<meta property="og:description" content="${page.description}" />`,
    "og:description",
  );
  // These two are for a reader who arrived from a search; the pages are one
  // document each and there is nothing on them to rank for beyond themselves.
  html = replaceTag(html, /<meta property="og:type" content="[^"]*" \/>/, `<meta property="og:type" content="article" />`, "og:type");

  return html;
}

export function injectJsonLd(indexHtml, blocks) {
  const script = blocks
    .map((block) => `    <script type="application/ld+json">${safeJson(block)}</script>`)
    .join("\n");

  if (!indexHtml.includes("</head>")) {
    throw new Error("prerender: index.html has no </head>");
  }

  return indexHtml.replace("</head>", `${script}\n  </head>`);
}

function main() {
  const indexPath = join(DIST, "index.html");
  const original = readFileSync(indexPath, "utf8");

  // The landing page keeps its own head and gains the structured data.
  writeFileSync(indexPath, injectJsonLd(original, buildJsonLd()), "utf8");

  // The legal pages are the same document with a different head. Built from
  // the ORIGINAL, not from the file just written: the FAQ markup describes the
  // landing page, and repeating it on the policy would be describing the wrong
  // page's content.
  for (const page of PUBLIC_PAGES) {
    writeFileSync(join(DIST, page.file), renderPublicPage(original, page), "utf8");
  }

  console.log(`PASS: prerendered ${PUBLIC_PAGES.map((page) => page.path).join(", ")} and injected ${buildJsonLd().length} JSON-LD blocks`);
}

// Importable for the tests, executable for the build.
if (process.argv[1] && process.argv[1].endsWith("prerender-public-pages.mjs")) {
  main();
}
