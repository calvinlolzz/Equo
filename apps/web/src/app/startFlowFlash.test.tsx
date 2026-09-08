// @vitest-environment jsdom
import { cleanup, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fakeApi, group, groupDetail, renderApp, signIn, stubBrowser } from "./appTestHarness";
import { saveCloudCache } from "./cloudCache";

const START_HEADING = "建立或加入一個群組";

beforeEach(() => stubBrowser());

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * 建立或加入一個群組 is the answer to "you have no groups". It must never be
 * the answer to "we have not asked yet".
 *
 * Reported as 「一打開的畫面會閃過這一頁才進入首頁」: the store publishes its
 * first state with an empty list and loadingGroups:false — the boot load runs
 * from a useEffect, which React fires AFTER it has painted — so one committed
 * frame told somebody with groups that they had none.
 */
describe("the start flow does not flash before the groups arrive", () => {
  test("a member with a group never sees it, not even for one frame", async () => {
    signIn();
    fakeApi([
      { route: "GET /groups", body: { groups: [group()] } },
      { route: "GET /groups/group_1", body: groupDetail() },
    ]);

    renderApp();
    // Synchronously after the first commit: this is the frame that was wrong.
    expect(screen.queryByText(START_HEADING)).toBeNull();

    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));
    expect(screen.queryByText(START_HEADING)).toBeNull();
  });

  /**
   * The reported case, which needs a cache to reproduce.
   *
   * A returning visitor has one, so the store starts with groupsLoaded:true and
   * a list already in hand — which means the first load is NOT a "first load"
   * and loadingGroups is never set at all. Meanwhile the effect that decides
   * WHICH group to open waits for groupsSynced, i.e. server truth. Between
   * those two the app has a list, no active group, and nothing claiming to be
   * loading: 建立或加入一個群組, for as long as GET /groups takes.
   */
  test("a returning visitor waits on a skeleton, not on 'you have no groups'", async () => {
    signIn();
    saveCloudCache({ userId: "user_alice", groups: [group()], groupDetails: {} });

    // Hold GET /groups open, so the window this is about is a window and not a
    // microtask.
    let releaseGroups = () => {};
    const held = new Promise<void>((resolve) => {
      releaseGroups = resolve;
    });
    fakeApi([
      { route: "GET /groups", body: { groups: [group()] } },
      { route: "GET /groups/group_1", body: groupDetail() },
    ]);
    const underlying = globalThis.fetch as typeof fetch;
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      if (String(url).includes("/groups") && !String(url).includes("/groups/")) await held;
      return underlying(url as never, init as never);
    });

    renderApp();

    // While the list is in flight there is no answer yet, so there must be no
    // claim about how many groups this person has.
    await waitFor(() => expect(document.querySelector(".skeleton-card")).toBeTruthy());
    expect(screen.queryByText(START_HEADING)).toBeNull();

    releaseGroups();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));
  });

  test("but somebody who really has none still gets it, once we know", async () => {
    signIn();
    fakeApi([{ route: "GET /groups", body: { groups: [] } }]);

    renderApp();

    expect(await screen.findByText(START_HEADING)).toBeTruthy();
  });

  test("and so does somebody whose first load failed - a skeleton forever is worse", async () => {
    signIn();
    fakeApi([{ route: "GET /groups", body: { error: { code: "BOOM", message: "boom" } }, status: 500 }]);

    renderApp();

    // "We could not reach the server" is not "you have no groups" either, but
    // it is the honest end of the road: there is nothing to show, and the page
    // that lets you make one is better than a skeleton that never resolves.
    expect(await screen.findByText(START_HEADING)).toBeTruthy();
  });
});
