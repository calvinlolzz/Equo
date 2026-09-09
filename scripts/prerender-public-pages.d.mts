/**
 * Types for the build-time prerender script.
 *
 * The script itself is plain `.mjs` because the build runs it with bare `node`
 * after Vite has finished — there is no compile step left at that point to
 * hand it. This file is what lets publicPageSeo.test.ts import it and hold its
 * copy against the app's own modules.
 */
export declare const SITE_ORIGIN: string;

export declare const PUBLIC_PAGES: Array<{
  file: string;
  path: string;
  title: string;
  description: string;
}>;

export declare const FAQ: Array<{ q: string; a: string }>;

/** The WebApplication and FAQPage blocks injected into the landing page. */
export declare function buildJsonLd(): Array<Record<string, unknown>>;

export declare function replaceTag(html: string, pattern: RegExp, replacement: string, what: string): string;

/** index.html with one public page's head swapped in. Throws if the head moved. */
export declare function renderPublicPage(
  indexHtml: string,
  page: { file: string; path: string; title: string; description: string },
): string;

export declare function injectJsonLd(indexHtml: string, blocks: Array<Record<string, unknown>>): string;
