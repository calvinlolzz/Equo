import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

/**
 * The bottom bar's destinations have to be warm before they are tapped.
 *
 * Asserted against App.tsx's source because that is where the two lists live
 * and the bug was that they disagreed: every panel behind the bottom bar is
 * a lazy chunk, but only two of them were being prefetched. The sheet shell is
 * NOT lazy, so a cold chunk does not delay the sheet - it opens an empty one
 * and leaves it at the bottom of the screen until the fetch lands (measured at
 * 2.5s on a real phone).
 */
const app = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "App.tsx"), "utf8");

/** The modules `prefetchOverlayChunks` warms. */
function warmed(): string[] {
  const body = /function prefetchOverlayChunks\(\): void \{([\s\S]*?)\n\}/.exec(app)?.[1] ?? "";
  return [...body.matchAll(/import\("\.\/(\w+)"\)/g)].map(([, name]) => name);
}

describe("the chunks behind the bottom bar", () => {
  test("every one of them is warmed on idle", () => {
    // 記錄, 分析 and the + button, plus the two sheets one tap deeper. Adding a
    // destination to the bar without adding it here is the bug this catches.
    for (const panel of ["RecordsPanel", "AnalysisPanel", "ExpenseComposerSheet", "ProfileDialog"]) {
      expect(warmed()).toContain(panel);
    }
  });

  test("warming never takes the page down with it", () => {
    // Speculative: a stale chunk here must not reload the page out from under
    // somebody who has not asked for that sheet. Every warm import is caught.
    const body = /function prefetchOverlayChunks\(\): void \{([\s\S]*?)\n\}/.exec(app)?.[1] ?? "";
    const imports = [...body.matchAll(/import\("\.\/\w+"\)(\.catch\(\(\) => \{\}\))?/g)];

    expect(imports.length).toBeGreaterThan(0);
    for (const [, caught] of imports) expect(caught).toBeTruthy();
  });

  test("a panel that is still arriving holds the sheet open", () => {
    // `null` here is what left an empty strip at the bottom of the screen.
    for (const panel of ["RecordsPanel", "AnalysisPanel"]) {
      const site = new RegExp(String.raw`<Suspense fallback=\{([^}]*)\}>\s*<${panel}`).exec(app)?.[1];
      expect(site).toBe("<PanelSkeleton />");
    }
  });
});
