// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fakeApi, group, groupDetail, renderApp, signIn, stubBrowser } from "./appTestHarness";

/**
 * Which overlay chunks the app actually asked for.
 *
 * Recorded from the mock factories rather than from a spy on `import`: a
 * factory runs exactly once, the first time its module is imported, which is
 * the event this is about. `vi.hoisted` because vi.mock's factories are lifted
 * above the imports and would otherwise close over an undefined binding.
 */
const { warmed } = vi.hoisted(() => ({ warmed: [] as string[] }));

// Literal paths, one call each: vi.mock is hoisted by static analysis of the
// call site, so a helper that builds the specifier from a template literal is
// silently not a mock at all. (It was written that way first. The signed-out
// assertions passed and meant nothing.)
vi.mock("./ExpenseComposerSheet", () => {
  warmed.push("ExpenseComposerSheet");
  return { ExpenseComposerSheet: () => null };
});
vi.mock("./ExpenseDetailDialog", () => {
  warmed.push("ExpenseDetailDialog");
  return { ExpenseDetailDialog: () => null };
});
vi.mock("./RecordsPanel", () => {
  warmed.push("RecordsPanel");
  return { RecordsPanel: () => null };
});
vi.mock("./AnalysisPanel", () => {
  warmed.push("AnalysisPanel");
  return { AnalysisPanel: () => null };
});
vi.mock("./ProfileDialog", () => {
  warmed.push("ProfileDialog");
  return { ProfileDialog: () => null };
});

const PREFETCHED = ["AnalysisPanel", "ExpenseComposerSheet", "ExpenseDetailDialog", "ProfileDialog", "RecordsPanel"];

beforeEach(() => {
  warmed.length = 0;
  stubBrowser();
  // prefetchOverlayChunks runs its warm() through requestIdleCallback when
  // there is one and a 1.5s timeout when there is not. jsdom has neither
  // reliably, so pin the idle path and make it synchronous - the question here
  // is WHETHER it runs, not when.
  vi.stubGlobal("requestIdleCallback", (callback: () => void) => {
    callback();
    return 1;
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * The landing page is the same component tree as the app, so an effect written
 * for the home screen runs for a stranger reading the marketing page too.
 *
 * Measured on production before this gate existed: a signed-out visitor fetched
 * ExpenseComposerSheet (8.27 kB gz), ExpenseDetailDialog (3.03), RecordsPanel
 * (4.18), AnalysisPanel (4.24) and ProfileDialog (4.61) — which drags
 * legalContent (6.99) in with it — for 31.3 kB gzipped, 93.7 kB to parse, of
 * screens that do not exist without a session.
 */
describe("overlay chunks are only warmed once there is a session", () => {
  test("a signed-out visitor on the landing page warms nothing", async () => {
    fakeApi([]);

    renderApp();

    // The landing page really is what rendered — otherwise this asserts
    // nothing about the landing page.
    await screen.findByText("使用 Google 登入");
    expect(warmed).toEqual([]);
  });

  test("still nothing after the idle callback has had its turn", async () => {
    fakeApi([]);

    renderApp();
    await screen.findByText("使用 Google 登入");

    // The fallback path too: a browser without requestIdleCallback waits 1.5s
    // and then warms. Neither timer should have anything queued behind it.
    vi.stubGlobal("requestIdleCallback", undefined);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(warmed).toEqual([]);
  });

  /**
   * Runs last on purpose, and asserts the exact list rather than "not empty".
   *
   * A vi.mock factory runs once per FILE, not once per test, so this is the
   * only test that can observe one running — which makes it the proof that the
   * two above are not passing vacuously. If the mocks ever stop being applied,
   * this goes red and tells you the signed-out assertions meant nothing.
   */
  test("a signed-in member warms all five", async () => {
    signIn();
    fakeApi([
      { route: "GET /groups", body: { groups: [group()] } },
      { route: "GET /groups/group_1", body: groupDetail() },
    ]);

    renderApp();

    await waitFor(() => expect([...warmed].sort()).toEqual(PREFETCHED));
  });

});
