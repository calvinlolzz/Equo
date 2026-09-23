// @vitest-environment jsdom
import { cleanup, configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ExpenseSummary, GroupSummary } from "./apiClient";
import { fakeApi, group, groupDetail, renderApp, signIn, stubBrowser, SESSION_KEY } from "./appTestHarness";
import { formatAmount } from "./formatAmount";
import { stashPendingRoute } from "./pendingRoute";
import { UI_TEXT } from "./uiText";

/**
 * Half the surfaces here (the profile dialog, the panels, the composer) are
 * lazy chunks, so a findBy* on their contents is waiting on a dynamic import.
 * testing-library's 1s default is fine for this file alone and not when the
 * whole suite is running — "unable to find 登出" on a signed-in user was that,
 * not a broken sign-out. Kept under vitest's 5s per-test budget — see the
 * fuller note in App.scan.test.tsx.
 */
configure({ asyncUtilTimeout: 4_000 });
// The 4s asyncUtilTimeout above only helps if the test is still alive when it
// fires. Vitest's default 5s per-test budget left ~1s of headroom, and under a
// fully loaded suite that is not enough: the test was killed first, replacing
// testing-library's "unable to find X" with a bare timeout that says nothing.
// Raising the budget does not hide a hang — the 4s wait still wins the race and
// still reports what it was looking for. It just makes that the outcome every
// time instead of most of the time.
vi.setConfig({ testTimeout: 15_000 });

beforeEach(() => {
  stubBrowser();
});

afterEach(() => {
  // @testing-library/react only auto-cleans when vitest runs with globals: true.
  // This project has no vitest config at all, so unmount by hand - otherwise
  // every test renders another <App /> into the same document and every query
  // finds the previous test's copy too.
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * The first tests that mount the whole app.
 *
 * Everything below this line - the store, the api client, the hooks, the effects
 * and the order they run in - is the app's own code. Only fetch and the browser
 * APIs jsdom lacks are faked. That is the point: these are the tests that can
 * catch a change which type-checks, builds, passes every unit test, and still
 * breaks the screen.
 */

describe("the login wall", () => {
  test("an unauthenticated visitor gets the login screen and nothing else", async () => {
    fakeApi([]);

    renderApp();

    expect(await screen.findByText(UI_TEXT.login.googleLogin)).toBeTruthy();
    // No group UI leaks through the wall.
    expect(screen.queryByText(UI_TEXT.app.createGroup)).toBeNull();
  });

  test("the wall fetches nothing but the public site notice", async () => {
    // This used to assert NO calls at all. The site notice deliberately
    // loosened it: a maintenance notice is most needed by the person who cannot
    // get past the wall, and an announcement about the service has to reach the
    // screen they are stuck on. It is unauthenticated, carries no user data,
    // and is the only exception - everything that reads somebody's groups still
    // waits until there is a session.
    const api = fakeApi([]);

    renderApp();
    await screen.findByText(UI_TEXT.login.googleLogin);

    expect(api.calls).toEqual(["GET /site-notice"]);
  });

  test("and in particular fetches nothing about any user or group", async () => {
    const api = fakeApi([]);

    renderApp();
    await screen.findByText(UI_TEXT.login.googleLogin);

    const leaked = api.calls.filter(
      (call) => call.includes("/groups") || call.includes("/me") || call.includes("/notifications"),
    );
    expect(leaked).toEqual([]);
  });

  test("an expired stored session is treated as no session", async () => {
    window.localStorage.setItem(
      SESSION_KEY,
      JSON.stringify({
        expiresAt: new Date(Date.now() - 1_000).toISOString(),
        user: { id: "user_alice", email: "alice@example.com", displayName: "Alice" },
      }),
    );
    fakeApi([]);

    renderApp();

    expect(await screen.findByText(UI_TEXT.login.googleLogin)).toBeTruthy();
  });
});

describe("a signed-in user", () => {
  test("lands on their group and loads its detail", async () => {
    signIn();
    const api = fakeApi([
      { route: "GET /groups", body: { groups: [group()] } },
      { route: "GET /groups/group_1", body: groupDetail() },
    ]);

    renderApp();

    // Root landing: forwarded to the most recent group, and the URL says so.
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));
    expect(await screen.findAllByText("東京旅行")).not.toHaveLength(0);
    expect(api.calls).toContain("GET /groups/group_1");
  });

  test("the group home fades in rather than replacing the skeleton between frames", async () => {
    signIn();
    fakeApi([
      { route: "GET /groups", body: { groups: [group()] } },
      { route: "GET /groups/group_1", body: groupDetail() },
    ]);

    const { container } = renderApp();
    await screen.findAllByText("東京旅行");

    // jsdom applies no stylesheet, so this can only check the wiring; what the
    // class means is asserted against the CSS in enterTransitions.test.tsx.
    const room = container.querySelector(".group-room");
    expect(room?.classList.contains("enter-content")).toBe(true);
  });

  test("opens the group named in the URL and loads its detail", async () => {
    signIn();
    window.history.replaceState(null, "", "/group/group_1");
    fakeApi([
      { route: "GET /groups", body: { groups: [group()] } },
      { route: "GET /groups/group_1", body: groupDetail() },
    ]);

    renderApp();

    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));
    expect(await screen.findAllByText("東京旅行")).not.toHaveLength(0);
  });

  test("a URL pointing at a group the user cannot see falls back home and says so", async () => {
    signIn();
    window.history.replaceState(null, "", "/group/group_gone");
    fakeApi([
      { route: "GET /groups", body: { groups: [group()] } },
      { route: "GET /groups/group_1", body: groupDetail() },
    ]);

    renderApp();

    expect(await screen.findByText(UI_TEXT.app.groupNotFound)).toBeTruthy();
    await waitFor(() => expect(window.location.pathname).not.toBe("/group/group_gone"));
  });

  test("no groups at all leaves the user on the start flow, not a blank screen", async () => {
    signIn();
    fakeApi([{ route: "GET /groups", body: { groups: [] } }]);

    renderApp();

    // The start flow shows 建立群組 as both the selected mode and the heading.
    expect(await screen.findAllByText(UI_TEXT.app.createGroup)).not.toHaveLength(0);
    expect(window.location.pathname).toBe("/");
  });

  test("an UNAUTHENTICATED response logs the session out and returns to the wall", async () => {
    signIn();
    fakeApi([
      {
        route: "GET /groups",
        status: 401,
        body: { error: { code: "UNAUTHENTICATED", message: "Please sign in with Google." } },
      },
    ]);

    renderApp();

    expect(await screen.findByText(UI_TEXT.login.googleLogin)).toBeTruthy();
    // The stored session is gone, so a reload does not bounce off the API again.
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  test("a disabled account is logged out too - not left in a broken half-state", async () => {
    signIn();
    fakeApi([
      {
        route: "GET /groups",
        status: 401,
        body: { error: { code: "ACCOUNT_DISABLED", message: "此帳號已被停用。" } },
      },
    ]);

    renderApp();

    expect(await screen.findByText(UI_TEXT.login.googleLogin)).toBeTruthy();
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
  });
});

describe("coming back from the OAuth redirect", () => {
  /**
   * Supabase sends the user back with the token in the URL fragment. This is the
   * only path that creates a session, and it is the one place where getting it
   * wrong means nobody can log in - so it is tested through the real App, not
   * around it.
   */
  function arriveWithFragment(fragment: string) {
    window.history.replaceState(null, "", `/${fragment}`);
  }

  const supabaseSession = {
    session: {
      token: "ignored-by-the-client",
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      user: { id: "user_alice", email: "alice@example.com", display_name: "Alice", avatar_url: null },
    },
  };

  test("exchanges the access token for a session and signs the user in", async () => {
    arriveWithFragment("#access_token=supabase-jwt&token_type=bearer");
    const api = fakeApi([
      { route: "POST /auth/supabase", body: supabaseSession },
      { route: "GET /groups", body: { groups: [group()] } },
      { route: "GET /groups/group_1", body: groupDetail() },
    ]);

    renderApp();

    await waitFor(() => expect(api.calls).toContain("POST /auth/supabase"));
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));
    expect(screen.queryByText(UI_TEXT.login.googleLogin)).toBeNull();

    // The session must survive a reload.
    expect(window.localStorage.getItem(SESSION_KEY)).toContain("user_alice");
  });

  test("strips the access token out of the URL", async () => {
    // Deliberately a user with NO groups, so nothing navigates afterwards. With a
    // group, the route change replaceState()s a path-only URL and clears the hash
    // as a side effect - which would make this assertion pass even if the OAuth
    // handler never stripped anything.
    arriveWithFragment("#access_token=supabase-jwt&token_type=bearer");
    fakeApi([
      { route: "POST /auth/supabase", body: supabaseSession },
      { route: "GET /groups", body: { groups: [] } },
    ]);

    renderApp();

    await waitFor(() => expect(window.localStorage.getItem(SESSION_KEY)).toBeTruthy());
    expect(window.location.pathname).toBe("/");
    expect(window.location.hash).toBe("");
  });

  test("never writes the session token to localStorage - the cookie carries it", async () => {
    arriveWithFragment("#access_token=supabase-jwt");
    fakeApi([
      { route: "POST /auth/supabase", body: supabaseSession },
      { route: "GET /groups", body: { groups: [] } },
    ]);

    renderApp();

    await waitFor(() => expect(window.localStorage.getItem(SESSION_KEY)).toBeTruthy());
    expect(window.localStorage.getItem(SESSION_KEY)).not.toContain("ignored-by-the-client");
  });

  test("a disabled account is told so, and is left at the wall", async () => {
    arriveWithFragment("#access_token=supabase-jwt");
    fakeApi([
      {
        route: "POST /auth/supabase",
        status: 403,
        body: { error: { code: "ACCOUNT_DISABLED", message: "此帳號已被停用。" } },
      },
    ]);

    renderApp();

    expect(await screen.findByText(UI_TEXT.app.accountDisabled)).toBeTruthy();
    expect(screen.getByText(UI_TEXT.login.googleLogin)).toBeTruthy();
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  test("a shared group link survives the login round-trip", async () => {
    // Someone is sent /group/group_2, isn't signed in, and comes back from
    // Supabase at the bare origin. Before the pending-route stash they landed
    // on their most-recent group (group_1) instead of the one they were sent.
    window.history.replaceState(null, "", "/group/group_2");
    stashPendingRoute();
    arriveWithFragment("#access_token=supabase-jwt&token_type=bearer");

    fakeApi([
      { route: "POST /auth/supabase", body: supabaseSession },
      { route: "GET /groups", body: { groups: [group(), group({ id: "group_2", name: "室友開銷" })] } },
      { route: "GET /groups/group_1", body: groupDetail() },
      { route: "GET /groups/group_2", body: groupDetail({ group: group({ id: "group_2", name: "室友開銷" }) }) },
    ]);

    renderApp();

    await waitFor(() => expect(window.location.pathname).toBe("/group/group_2"));
  });

  test("a shared group link survives a cloud cache that has never heard of that group", async () => {
    // The same round-trip, but this user has been here before, so the cloud
    // cache seeds a group list from an earlier session - one recorded before
    // they were ever invited to group_2. The landing effect must wait for the
    // SERVER's list: judging the pending route against the cache would decide
    // group_2 isn't theirs and drop them on group_1 instead.
    window.history.replaceState(null, "", "/group/group_2");
    stashPendingRoute();
    arriveWithFragment("#access_token=supabase-jwt&token_type=bearer");

    window.localStorage.setItem(
      "equo.clean.cloud_cache",
      JSON.stringify({
        version: 1,
        userId: "user_alice",
        groups: [{ id: "group_1", name: "東京旅行", currency: "TWD" }],
        groupDetails: {},
      }),
    );

    fakeApi([
      { route: "POST /auth/supabase", body: supabaseSession },
      { route: "GET /groups", body: { groups: [group(), group({ id: "group_2", name: "室友開銷" })] } },
      { route: "GET /groups/group_1", body: groupDetail() },
      { route: "GET /groups/group_2", body: groupDetail({ group: group({ id: "group_2", name: "室友開銷" }) }) },
    ]);

    renderApp();

    await waitFor(() => expect(window.location.pathname).toBe("/group/group_2"));
  });

  test("an OAuth error in the fragment is surfaced rather than swallowed", async () => {
    // Supabase puts the human-readable reason in error_description; that is what
    // the user needs to see, not the machine code beside it.
    arriveWithFragment("#error=access_denied&error_description=User+denied+access");
    fakeApi([]);

    renderApp();

    expect(await screen.findByText(/User denied access/)).toBeTruthy();
    expect(screen.getByText(UI_TEXT.login.googleLogin)).toBeTruthy();
  });
});

describe("signing out", () => {
  test("clears the session and the cached data, and returns to the wall", async () => {
    signIn();
    fakeApi([
      { route: "GET /groups", body: { groups: [group()] } },
      { route: "GET /groups/group_1", body: groupDetail() },
    ]);

    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));

    // Open the profile dialog the way a user does, then sign out of it.
    (await screen.findByLabelText(UI_TEXT.app.profile)).click();
    (await screen.findByText(UI_TEXT.profile.logout)).click();

    expect(await screen.findByText(UI_TEXT.login.googleLogin)).toBeTruthy();
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
    // Back at the root, so a reload does not try to open a group we just left.
    expect(window.location.pathname).toBe("/");
  });
});

describe("deleting the account", () => {
  test("confirms, calls DELETE /me, and returns to the login wall", async () => {
    signIn();
    const api = fakeApi([
      { route: "GET /groups", body: { groups: [group()] } },
      { route: "GET /groups/group_1", body: groupDetail() },
      { route: "DELETE /me", body: { ok: true } },
    ]);

    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));

    // Profile → 其他設定 tab → 刪除帳號 (danger row lives on the other tab).
    (await screen.findByLabelText(UI_TEXT.app.profile)).click();
    (await screen.findByText(UI_TEXT.profile.otherTab)).click();
    (await screen.findByText(UI_TEXT.profile.deleteAccount)).click();

    // A confirm stands between the tap and the irreversible call.
    const confirm = await screen.findByRole("dialog", { name: UI_TEXT.profile.deleteAccountConfirmTitle });
    expect(api.calls).not.toContain("DELETE /me");

    within(confirm).getByText(UI_TEXT.profile.deleteAccountConfirmAction).click();

    // The account is gone: back at the wall, local session cleared, and the
    // request actually went out.
    expect(await screen.findByText(UI_TEXT.login.googleLogin)).toBeTruthy();
    expect(api.calls).toContain("DELETE /me");
    expect(window.localStorage.getItem(SESSION_KEY)).toBeNull();
  });

  test("a blocked deletion (last admin owner) keeps the user signed in with a message", async () => {
    signIn();
    fakeApi([
      { route: "GET /groups", body: { groups: [group()] } },
      { route: "GET /groups/group_1", body: groupDetail() },
      {
        route: "DELETE /me",
        status: 409,
        body: { error: { code: "ACCOUNT_DELETE_BLOCKED", message: "blocked", request_id: "req_account_delete" } },
      },
    ]);

    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));

    (await screen.findByLabelText(UI_TEXT.app.profile)).click();
    (await screen.findByText(UI_TEXT.profile.otherTab)).click();
    (await screen.findByText(UI_TEXT.profile.deleteAccount)).click();
    const confirm = await screen.findByRole("dialog", { name: UI_TEXT.profile.deleteAccountConfirmTitle });
    within(confirm).getByText(UI_TEXT.profile.deleteAccountConfirmAction).click();

    // Still signed in (no login wall), and told why in localized copy.
    expect(await screen.findByText(UI_TEXT.app.accountDeleteBlocked)).toBeTruthy();
    expect(window.localStorage.getItem(SESSION_KEY)).not.toBeNull();
  });
});

describe("the legal documents", () => {
  test("opening the privacy policy shows the real content, not a placeholder", async () => {
    signIn();
    fakeApi([
      { route: "GET /groups", body: { groups: [group()] } },
      { route: "GET /groups/group_1", body: groupDetail() },
    ]);

    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));

    (await screen.findByLabelText(UI_TEXT.app.profile)).click();
    (await screen.findByText(UI_TEXT.profile.otherTab)).click();
    (await screen.findByText(UI_TEXT.profile.privacyPolicy)).click();

    const doc = await screen.findByRole("dialog", { name: UI_TEXT.profile.privacyPolicy });
    // A real section from legalContent, and specifically the deletion promise —
    // proves the structured content is wired, not the old 準備中 stub.
    expect(within(doc).getByText("已刪除的使用者", { exact: false })).toBeTruthy();
    expect(within(doc).queryByText(/準備中/)).toBeNull();
  });
});

describe("the Back button", () => {
  /** jsdom traverses history asynchronously and fires popstate on a later task. */
  async function pressBack() {
    const traversed = new Promise<void>((resolve, reject) => {
      const onPopState = () => {
        window.clearTimeout(timer);
        resolve();
      };
      const timer = window.setTimeout(() => {
        window.removeEventListener("popstate", onPopState);
        reject(new Error("history.back() fired no popstate - nothing to go back to"));
      }, 1_000);
      window.addEventListener("popstate", onPopState, { once: true });
    });

    window.history.back();
    await traversed;
  }

  test("backing out of a group returns to the group list, in the whole app", async () => {
    // useGroupRoute has its own tests. This one is the integration: that the
    // route hook, the route-sync effect and the render actually agree once they
    // are all running together - the popstate handler could have been fought by
    // the effect that forwards the user to their most recent group.
    signIn();
    fakeApi([
      { route: "GET /groups", body: { groups: [group(), group({ id: "group_2", name: "室友開銷" })] } },
      { route: "GET /groups/group_1", body: groupDetail() },
      { route: "GET /groups/group_2", body: groupDetail({ group: group({ id: "group_2", name: "室友開銷" }) }) },
    ]);

    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));

    // Open the second group from the group list (a push, unlike the landing).
    const secondGroup = await screen.findAllByText("室友開銷");
    secondGroup[0].click();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_2"));

    await pressBack();

    // The URL moved back AND the UI followed it. Before useGroupRoute, only the
    // URL moved: the screen stayed on the group the user had just left.
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));
    await waitFor(() => expect(screen.getAllByText("東京旅行").length).toBeGreaterThan(0));
  });
});

describe("the toast", () => {
  test("a non-auth failure is surfaced, and does NOT log the user out", async () => {
    // The regression guarded here: a transient 500 must not be mistaken for
    // session expiry. Only UNAUTHENTICATED/ACCOUNT_DISABLED sign the user out
    // (see the two tests above that assert exactly that); everything else stays
    // signed in and shows a sync-failed toast.
    //
    // The detail load fails from the start, deterministically - the previous
    // version raced the initial fetch against an api.set() after landing, and
    // the assertion was scoped inside the toast element, where the login text can
    // never appear, so it could not have caught a logout regression at all.
    signIn();
    fakeApi([
      { route: "GET /groups", body: { groups: [group()] } },
      { route: "GET /groups/group_1", status: 500, body: { error: { code: "INTERNAL_ERROR", message: "boom" } } },
    ]);

    renderApp();

    // The sync-failed toast appears...
    expect(await screen.findByText(new RegExp(UI_TEXT.app.cloudSyncFailedPrefix))).toBeTruthy();
    // ...and the user is still signed in: no login wall, session intact. If a 500
    // were treated as expiry, both of these would flip.
    expect(screen.queryByText(UI_TEXT.login.googleLogin)).toBeNull();
    expect(window.localStorage.getItem(SESSION_KEY)).toContain("user_alice");
  });
});

describe("searching the records panel", () => {
  function expenseRow(overrides: Partial<ExpenseSummary> = {}): ExpenseSummary {
    return {
      id: "expense_1",
      group_id: "group_1",
      title: "拉麵",
      kind: "expense",
      category: "food",
      amount_minor: 120000,
      currency: "TWD",
      expense_date: "2026-07-04",
      created_at: "2026-07-04T10:00:00.000Z",
      version: 1,
      client_request_id: "seed_1",
      expense_payments: [
        { payer_member_id: "member_alice", amount_minor: 120000, currency: "TWD" },
      ],
      expense_shares: [{ member_id: "member_alice", share_type: "fixed", amount_minor: 120000 }],
      ...overrides,
    };
  }

  const taxi = expenseRow({
    id: "expense_2",
    title: "計程車",
    category: "transport",
    amount_minor: 25000,
    expense_date: "2026-07-06",
    client_request_id: "seed_2",
    expense_payments: [
      { payer_member_id: "member_alice", amount_minor: 25000, currency: "TWD" },
    ],
    expense_shares: [{ member_id: "member_alice", share_type: "fixed", amount_minor: 25000 }],
  });

  /**
   * The search endpoint answers over the whole history, so the fake has to be
   * told what the server would find - it cannot be derived from the two rows
   * the detail call seeded. Omitting `searchResult` leaves the route unlisted,
   * which makes fetch reject: that is the offline/degraded path, where the
   * panel falls back to filtering what it already has.
   */
  async function openRecords(searchResult?: {
    expenses: ExpenseSummary[];
    match_count: number;
    match_total_minor: number;
    has_more?: boolean;
  }) {
    signIn();
    fakeApi([
      { route: "GET /groups", body: { groups: [group()] } },
      {
        route: "GET /groups/group_1",
        body: groupDetail({ expenses: [expenseRow(), taxi], expense_count: 2, spend_total_minor: 145000 }),
      },
      ...(searchResult
        ? [
            {
              route: "GET /groups/group_1/expenses/search",
              body: { has_more: false, ...searchResult },
            },
          ]
        : []),
    ]);

    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));
    // 支出記錄 and 近期活動 both offer 查看全部 for the same sheet; scope to the
    // records section so the test does not depend on their order.
    const records = await screen.findByRole("region", { name: UI_TEXT.app.records });
    within(records).getByText(UI_TEXT.app.viewAll).click();
    return await screen.findByLabelText("搜尋支出");
  }

  test("typing a title narrows the list to the matching entry", async () => {
    const search = await openRecords();

    fireEvent.change(search, { target: { value: "計程" } });

    const rows = screen.getAllByRole("button").filter((node) => node.className.includes("record-dialog-row"));
    expect(rows.some((row) => row.textContent?.includes("計程車"))).toBe(true);
    expect(rows.some((row) => row.textContent?.includes("拉麵"))).toBe(false);
  });

  test("searching by the amount as shown on screen finds the row", async () => {
    const search = await openRecords();

    // $1,200 is stored as 120000 minor - the user types what they can see.
    fireEvent.change(search, { target: { value: "1200" } });

    expect(screen.getByText("符合 1 筆・$1,200")).toBeTruthy();
  });

  test("a search with no matches says so and can be cleared back to the full list", async () => {
    const search = await openRecords({ expenses: [], match_count: 0, match_total_minor: 0 });

    fireEvent.change(search, { target: { value: "壽司" } });

    // "沒有符合的紀錄" is only claimed once the server has actually answered -
    // until then the panel has not seen the rows outside its window and says
    // nothing it cannot back up.
    expect(await screen.findByText("沒有符合的紀錄")).toBeTruthy();

    fireEvent.click(screen.getByText("清除篩選"));

    await waitFor(() => expect(screen.queryByText("沒有符合的紀錄")).toBeNull());
    expect(screen.getAllByText("計程車").length).toBeGreaterThan(0);
  });

  test("finds a match that is older than the loaded window", async () => {
    // The row the server returns was never in the group-detail response, so
    // the old in-memory filter could not have produced it however long the
    // user stared at the screen.
    const oldRamen = expenseRow({
      id: "expense_old",
      title: "去年的拉麵",
      amount_minor: 88000,
      expense_date: "2025-01-09",
      created_at: "2025-01-09T10:00:00.000Z",
      client_request_id: "seed_old",
    });
    const search = await openRecords({
      expenses: [oldRamen],
      match_count: 1,
      match_total_minor: 88000,
    });

    fireEvent.change(search, { target: { value: "拉麵" } });

    expect(await screen.findByText("去年的拉麵")).toBeTruthy();
    // The summary counts the server's matches, not the loaded window's.
    expect(screen.getByText("符合 1 筆・$880")).toBeTruthy();
  });

  test("a failed search degrades to filtering what is loaded rather than showing nothing", async () => {
    // No search route -> fetch rejects, the way an unreachable server looks.
    const search = await openRecords();

    fireEvent.change(search, { target: { value: "計程" } });

    await waitFor(() => {
      const rows = screen.getAllByRole("button").filter((node) => node.className.includes("record-dialog-row"));
      expect(rows.some((row) => row.textContent?.includes("計程車"))).toBe(true);
    });
  });
});

describe("recording an expense with no connection", () => {
  test("the entry is kept, shown as 待送出, and counted in the offline banner", async () => {
    signIn();
    // POST /groups/group_1/expenses is deliberately absent: an unlisted route
    // makes fetch reject, which is exactly what an unreachable server looks
    // like to apiClient (NETWORK_ERROR).
    fakeApi([
      { route: "GET /groups", body: { groups: [group()] } },
      { route: "GET /groups/group_1", body: groupDetail() },
    ]);

    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));

    (await screen.findAllByLabelText(UI_TEXT.app.addExpense))[0].click();
    const composer = await screen.findByRole("dialog", { name: UI_TEXT.app.addExpense });
    fireEvent.change(within(composer).getByLabelText(UI_TEXT.app.title), { target: { value: "便當" } });
    fireEvent.change(within(composer).getByLabelText(UI_TEXT.app.amount), { target: { value: "150" } });
    // 新增支出 is both the sheet's title and its submit label, so pick the
    // button that actually submits.
    const submit = within(composer)
      .getAllByRole("button", { name: UI_TEXT.composerSubmit.addExpense })
      .find((button) => button.className.includes("composer-submit"));
    fireEvent.click(submit as HTMLElement);

    // Recorded, not lost: the banner counts it and the composer closed as if
    // the save had succeeded - which, from the user's side, it did.
    expect(await screen.findByText(`1${UI_TEXT.app.offlinePendingSuffix}`)).toBeTruthy();
    // 最近記錄 is a disclosure now, collapsed by default - open it to see the
    // row itself. (Scoped by id, not by the 支出記錄 label - the group side
    // nav has its own nav item with that exact text.)
    await waitFor(() => expect(document.querySelector("#group-records .home-disclosure-toggle")).toBeTruthy());
    fireEvent.click(document.querySelector<HTMLElement>("#group-records .home-disclosure-toggle")!);
    expect(await screen.findByText("便當")).toBeTruthy();
  });
});

describe("repeating an expense", () => {
  const lunch: ExpenseSummary = {
    id: "expense_1",
    group_id: "group_1",
    title: "週末採買",
    kind: "expense",
    category: "food",
    amount_minor: 90000,
    currency: "TWD",
    expense_date: "2026-07-04",
    created_at: "2026-07-04T10:00:00.000Z",
    version: 1,
    client_request_id: "seed_1",
    note: "全聯",
    expense_payments: [{ payer_member_id: "member_alice", amount_minor: 90000, currency: "TWD" }],
    expense_shares: [{ member_id: "member_alice", share_type: "fixed", amount_minor: 90000 }],
  };

  async function openDetail() {
    signIn();
    const api = fakeApi([
      { route: "GET /groups", body: { groups: [group()] } },
      {
        route: "GET /groups/group_1",
        body: groupDetail({ expenses: [lunch], expense_count: 1, spend_total_minor: 90000 }),
      },
      { route: "POST /groups/group_1/expenses", body: { expense: { ...lunch, id: "expense_2" } } },
    ]);

    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));
    const records = await screen.findByRole("region", { name: UI_TEXT.app.records });
    within(records).getByText(UI_TEXT.app.viewAll).click();
    // Wait for the panel itself, not just for some button to exist.
    await screen.findByLabelText("搜尋支出");
    const row = screen.getAllByRole("button").find((node) => node.className.includes("record-dialog-row"));
    fireEvent.click(row as HTMLElement);
    await screen.findByRole("dialog", { name: UI_TEXT.expenseDetail.title });
    return api;
  }

  test("reopens the entry prefilled and saves it as a new expense, leaving the original alone", async () => {
    const api = await openDetail();

    fireEvent.click(screen.getByRole("button", { name: UI_TEXT.app.duplicateExpense }));

    // The composer opens in create mode - the title carried over, the submit
    // button says 新增支出 rather than 儲存變更.
    const composer = await screen.findByRole("dialog", { name: UI_TEXT.app.addExpense });
    expect((within(composer).getByLabelText(UI_TEXT.app.title) as HTMLInputElement).value).toBe("週末採買");
    const submit = within(composer)
      .getAllByRole("button", { name: UI_TEXT.composerSubmit.addExpense })
      .find((button) => button.className.includes("composer-submit"));
    fireEvent.click(submit as HTMLElement);

    // A POST, not a PUT: duplicating must never overwrite what it copied.
    await waitFor(() => expect(api.calls).toContain("POST /groups/group_1/expenses"));
    expect(api.calls.some((call) => call.startsWith("PUT "))).toBe(false);
  });

  test("is not offered for a settlement", async () => {
    signIn();
    fakeApi([
      { route: "GET /groups", body: { groups: [group()] } },
      {
        route: "GET /groups/group_1",
        body: groupDetail({
          // The wire kind is "transfer"; the app maps it to a settlement.
          expenses: [{ ...lunch, kind: "transfer", title: "清償", transfer_to_member_id: "member_bob" }],
          expense_count: 1,
          spend_total_minor: 0,
        }),
      },
    ]);

    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));
    const records = await screen.findByRole("region", { name: UI_TEXT.app.records });
    within(records).getByText(UI_TEXT.app.viewAll).click();
    // Wait for the panel itself, not just for some button to exist.
    await screen.findByLabelText("搜尋支出");
    const row = screen.getAllByRole("button").find((node) => node.className.includes("record-dialog-row"));
    fireEvent.click(row as HTMLElement);

    await screen.findByRole("dialog", { name: UI_TEXT.expenseDetail.settlementTitle });
    // "再轉一次" is not a shortcut anyone wants next to a balance.
    expect(screen.queryByRole("button", { name: UI_TEXT.app.duplicateExpense })).toBeNull();
  });
});

describe("the top bar", () => {
  test("keeps 個人資料 next to the theme toggle once a group is open, and only there", async () => {
    signIn();
    fakeApi([
      { route: "GET /groups", body: { groups: [group()] } },
      { route: "GET /groups/group_1", body: groupDetail() },
    ]);
    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));

    const banner = screen.getByRole("banner");
    expect(within(banner).getByLabelText(UI_TEXT.app.profile)).toBeTruthy();
    // It used to move into the group rail on entering a group, which is how
    // "where is my account" ended up with two answers.
    expect(screen.getAllByLabelText(UI_TEXT.app.profile)).toHaveLength(1);
  });

  test("is the same place before any group is open", async () => {
    signIn();
    fakeApi([{ route: "GET /groups", body: { groups: [] } }]);
    renderApp();
    await screen.findAllByText(UI_TEXT.app.createGroup);

    const banner = screen.getByRole("banner");
    expect(within(banner).getByLabelText(UI_TEXT.app.profile)).toBeTruthy();
  });
});

describe("balances on the group list", () => {
  const tokyo = group();
  const osaka = group({ id: "group_2", name: "大阪旅行" });

  /**
   * The open group's detail is authoritative for its own row (see cloudStore's
   * listBalanceFromDetail), so the fixture's detail balance has to agree with
   * the list balance or the row shows the detail's number.
   */
  async function landWithBalances(groups: GroupSummary[], openGroupBalanceMinor = 0) {
    signIn();
    const api = fakeApi([
      {
        route: "GET /groups/group_1",
        body: groupDetail({
          balances: [{ memberId: "member_alice", balance: { amount_minor: openGroupBalanceMinor, currency: "TWD" } }],
        }),
      },
      { route: "GET /groups", body: { groups } },
      { route: "GET /groups/group_2", body: groupDetail({ group: osaka }) },
    ]);
    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));
    return api;
  }

  test("each row says which way its money points, and the header nets them", async () => {
    await landWithBalances(
      [
        { ...tokyo, balance_minor: -32000 },
        { ...osaka, balance_minor: 50000 },
      ],
      -32000,
    );

    const rail = await screen.findByRole("complementary", { name: UI_TEXT.app.groupList });
    const tokyoRow = within(rail).getByText("東京旅行").closest("button") as HTMLElement;
    const osakaRow = within(rail).getByText("大阪旅行").closest("button") as HTMLElement;

    expect(within(tokyoRow).getByText(`${UI_TEXT.app.balanceYouOwe} $320`)).toBeTruthy();
    expect(within(osakaRow).getByText(`${UI_TEXT.app.balanceOwedToYou} $500`)).toBeTruthy();
    // -320 + 500 across one currency: the number the app should open on.
    expect(within(rail).getByText(`${UI_TEXT.app.balanceOwedToYou} $180`)).toBeTruthy();
  });

  test("shows 已結清 rather than nothing when the balances are known and net out", async () => {
    await landWithBalances([
      { ...tokyo, balance_minor: 0 },
      { ...osaka, balance_minor: 0 },
    ]);

    const rail = await screen.findByRole("complementary", { name: UI_TEXT.app.groupList });
    expect(within(rail).getAllByText(UI_TEXT.app.balanceSettled).length).toBeGreaterThan(0);
  });

  test("a group whose balance the server did not send shows none — never a made-up 已結清", async () => {
    // Only the open group's balance is derivable locally (from its detail);
    // 大阪旅行 is the row with genuinely nothing behind it.
    await landWithBalances([tokyo, osaka]);

    const rail = await screen.findByRole("complementary", { name: UI_TEXT.app.groupList });
    const osakaRow = within(rail).getByText("大阪旅行").closest("button") as HTMLElement;

    expect(within(osakaRow).queryByText(UI_TEXT.app.balanceSettled)).toBeNull();
    expect(within(osakaRow).queryByText(new RegExp(UI_TEXT.app.balanceYouOwe))).toBeNull();
    // Falls back to what the row showed before balances existed.
    expect(within(osakaRow).getByText("TWD")).toBeTruthy();
  });
});

describe("a personal ledger", () => {
  const shared = group({ id: "group_1", name: "東京旅行" });
  const ledger = group({
    id: "group_ledger",
    name: "我的帳本",
    kind: "personal",
    owner_member_id: "member_alice",
  });

  function ledgerExpense(overrides: Partial<ExpenseSummary> = {}): ExpenseSummary {
    return {
      id: "expense_1",
      group_id: "group_ledger",
      title: "午餐",
      kind: "expense",
      category: "food",
      amount_minor: 12000,
      currency: "TWD",
      expense_date: "2026-09-10",
      created_at: "2026-09-10T03:00:00.000Z",
      version: 1,
      client_request_id: "seed_ledger_1",
      expense_payments: [{ payer_member_id: "member_alice", amount_minor: 12000, currency: "TWD" }],
      expense_shares: [{ member_id: "member_alice", share_type: "fixed", amount_minor: 12000 }],
      ...overrides,
    };
  }

  function ledgerDetail(overrides: Partial<ReturnType<typeof groupDetail>> = {}) {
    return groupDetail({
      group: ledger,
      members: [
        {
          id: "member_alice",
          group_id: "group_ledger",
          user_id: "user_alice",
          display_name: "Alice",
          role: "owner",
          status: "active",
        },
      ],
      balances: [{ memberId: "member_alice", balance: { amount_minor: 0, currency: "TWD" } }],
      expenses: [ledgerExpense()],
      expense_count: 1,
      spend_total_minor: 12000,
      ...overrides,
    });
  }

  test("the rail pins the ledger first, even when the server lists it after the shared group", async () => {
    // The ledger fixture's stored name ("我的帳本") happens to equal
    // UI_TEXT.personalLedger.name itself, so asserting against that constant
    // would pass even if the rail regressed to showing group.name raw
    // instead of calling groupDisplayName. A name that visibly differs from
    // the translated label makes that regression actually fail.
    const namedLedger = { ...ledger, name: "我的帳本（測試）" };
    signIn();
    fakeApi([
      { route: "GET /groups", body: { groups: [shared, namedLedger] } },
      { route: "GET /groups/group_1", body: groupDetail({ group: shared }) },
    ]);
    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));

    const rail = await screen.findByRole("complementary", { name: UI_TEXT.app.groupList });
    const rows = rail.querySelectorAll(".group-item");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0]?.textContent).toContain(UI_TEXT.personalLedger.name);
    expect(rows[0]?.textContent).not.toContain(namedLedger.name);
  });

  test("opening the ledger shows 本月支出 and no 新增成員 or 邀請成員", async () => {
    signIn();
    fakeApi([
      { route: "GET /groups", body: { groups: [shared, ledger] } },
      { route: "GET /groups/group_1", body: groupDetail({ group: shared }) },
      { route: "GET /groups/group_ledger", body: ledgerDetail() },
    ]);
    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));

    const rail = await screen.findByRole("complementary", { name: UI_TEXT.app.groupList });
    fireEvent.click(within(rail).getByText(UI_TEXT.personalLedger.name).closest("button") as HTMLElement);

    await waitFor(() => expect(window.location.pathname).toBe("/group/group_ledger"));
    expect(await screen.findByText(UI_TEXT.personalLedger.monthExpense)).toBeTruthy();
    expect(screen.queryByText(UI_TEXT.app.addMember)).toBeNull();
    expect(screen.queryByText(UI_TEXT.app.inviteMembers)).toBeNull();
  });

  // [MV]
  test("a failed background auto-page (pulling more history for the month total) shows no toast and does not retry", async () => {
    signIn();
    // expense_count (5) > the 1 loaded row, and that row's month is the
    // current one - ledgerMonthCoverage reports "partial", which is what
    // makes App.tsx's auto-paging effect fire on mount.
    const api = fakeApi([
      { route: "GET /groups", body: { groups: [shared, ledger] } },
      { route: "GET /groups/group_1", body: groupDetail({ group: shared }) },
      { route: "GET /groups/group_ledger", body: ledgerDetail({ expense_count: 5 }) },
      {
        route: "GET /groups/group_ledger/expenses",
        status: 500,
        body: { error: { code: "INTERNAL", message: "boom", request_id: "req_x" } },
      },
    ]);
    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));

    const rail = await screen.findByRole("complementary", { name: UI_TEXT.app.groupList });
    fireEvent.click(within(rail).getByText(UI_TEXT.personalLedger.name).closest("button") as HTMLElement);
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_ledger"));
    await screen.findByText(UI_TEXT.personalLedger.monthExpense);

    const expensesCalls = () => api.calls.filter((call) => call === "GET /groups/group_ledger/expenses").length;
    await waitFor(() => expect(expensesCalls()).toBeGreaterThan(0));

    const callsAfterFailure = expensesCalls();
    // Give any further render/effect cycle room to fire before asserting
    // "no retry, no toast" - checked AFTER this wait rather than before it,
    // so a toast (or a retry) that shows up on a later tick than the
    // failure itself is not missed by a check that ran too early.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(expensesCalls()).toBe(callsAfterFailure);
    // No toast: the old effect called handleLoadMoreExpenses, which surfaces
    // a failure via describeCloudActionError - the direct
    // cloudStore.loadMoreExpenses call this effect uses now must swallow it
    // instead (see the fix's own in-flight/failed state).
    expect(document.querySelector(".toast-dock")).toBeNull();
  });

  // [MV]
  test("auto-paging keeps loading pages automatically until the month total is complete (3+ pages)", async () => {
    signIn();
    // Four rows, newest first, one loaded up front - three more pages are
    // needed before ledgerMonthCoverage reports "complete" (expenses.length
    // reaches expense_count). All dated in the current real month so
    // coverage can only flip to "complete" by length, never by an oldest-row
    // month check - see personalLedger.ts's ledgerMonthCoverage.
    const rows = [
      ledgerExpense({ id: "expense_1", amount_minor: 1000, expense_date: "2026-09-10", created_at: "2026-09-10T03:00:00.000Z" }),
      ledgerExpense({ id: "expense_2", amount_minor: 2000, expense_date: "2026-09-09", created_at: "2026-09-09T03:00:00.000Z" }),
      ledgerExpense({ id: "expense_3", amount_minor: 3000, expense_date: "2026-09-08", created_at: "2026-09-08T03:00:00.000Z" }),
      ledgerExpense({ id: "expense_4", amount_minor: 4000, expense_date: "2026-09-07", created_at: "2026-09-07T03:00:00.000Z" }),
    ];
    const expensesRoute = "GET /groups/group_ledger/expenses";
    const api = fakeApi([
      { route: "GET /groups", body: { groups: [shared, ledger] } },
      { route: "GET /groups/group_1", body: groupDetail({ group: shared }) },
      {
        route: "GET /groups/group_ledger",
        body: ledgerDetail({ expenses: [rows[0]], expense_count: rows.length, spend_total_minor: rows[0].amount_minor }),
      },
      // Placeholder - overridden by the wrapper below, which serves pages by
      // CALL ORDER rather than by cursor (the route table strips the cursor
      // query string before matching, so it cannot tell one page apart from
      // another). Needed here only so fakeApi's own initial table has an
      // entry for it; never actually reached.
      { route: expensesRoute, body: { expenses: [] } },
    ]);
    // Serves rows[1], then rows[2], then rows[3] by call order, regardless of
    // how fast the app re-requests relative to this test's own assertions -
    // a scheme keyed on "swap the mocked body once the previous page has
    // landed" raced the production effect's own immediate follow-up request
    // (which can fire before this test's next line runs) and intermittently
    // starved it of rows[3] within the auto-page attempt cap.
    const pages = [[rows[1]], [rows[2]], [rows[3]]];
    let expensesCallIndex = 0;
    const baseFetch = globalThis.fetch as ReturnType<typeof vi.fn>;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const path = String(url).replace(/^\/api\/v1/, "").split("?")[0];
        if (method === "GET" && path === "/groups/group_ledger/expenses") {
          api.calls.push(expensesRoute);
          const page = pages[Math.min(expensesCallIndex, pages.length - 1)];
          expensesCallIndex += 1;
          return { ok: true, status: 200, json: async () => ({ expenses: page }) } as Response;
        }
        return baseFetch(url, init);
      }),
    );
    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));

    const rail = await screen.findByRole("complementary", { name: UI_TEXT.app.groupList });
    fireEvent.click(within(rail).getByText(UI_TEXT.personalLedger.name).closest("button") as HTMLElement);
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_ledger"));

    const homeAmount = () => document.querySelector(".home-balance-amount")?.textContent ?? "";
    const sumThrough = (n: number) => rows.slice(0, n).reduce((total, row) => total + row.amount_minor, 0);

    // All three pages load unprompted, one after another, with no manual
    // stepping from this test - exactly what the ref-only version could not
    // do (it stalled after page 1; see the fix's own comment on why).
    await waitFor(() => expect(homeAmount()).toBe(formatAmount(sumThrough(4), "TWD")));

    // expenses.length (4) now equals expense_count (4): ledgerMonthCoverage
    // flips to "complete" and auto-paging must stop permanently on its own.
    const callsWhenComplete = api.calls.filter((call) => call === expensesRoute).length;
    expect(callsWhenComplete).toBeGreaterThanOrEqual(3);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(api.calls.filter((call) => call === expensesRoute).length).toBe(callsWhenComplete);
  });

  test("root landing picks the shared group over the ledger", async () => {
    signIn();
    fakeApi([
      // Server order: ledger first. resolveRootLanding still has to skip it.
      { route: "GET /groups", body: { groups: [ledger, shared] } },
      { route: "GET /groups/group_1", body: groupDetail({ group: shared }) },
    ]);
    renderApp();

    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));
    expect(await screen.findAllByText("東京旅行")).not.toHaveLength(0);
  });

  // [MV]
  test("a ledger-only account skips StartFlow, and the empty state offers 建立群組", async () => {
    signIn();
    fakeApi([
      { route: "GET /groups", body: { groups: [ledger] } },
      { route: "GET /groups/group_ledger", body: ledgerDetail({ expenses: [], expense_count: 0, spend_total_minor: 0 }) },
    ]);
    renderApp();

    await waitFor(() => expect(window.location.pathname).toBe("/group/group_ledger"));
    // StartFlow never renders the group rail - its presence here means the
    // ledger view is what actually mounted, not the create-first-group flow.
    expect(await screen.findByRole("complementary", { name: UI_TEXT.app.groupList })).toBeTruthy();
    // Scoped to the home region, not the whole page: the rail ALSO has its
    // own 建立群組 button (GroupRail's group-create-item), so an unscoped
    // getAllByText would pass even if PersonalLedgerHome's own empty-state
    // button were missing or broken.
    // The personal ledger's own section is labelled 帳本首頁 (personalLedger.homeLabel),
    // not 群組首頁 - see PersonalLedgerHome.tsx's aria-label fix.
    const home = await screen.findByRole("region", { name: UI_TEXT.personalLedger.homeLabel });
    expect(within(home).getByText(UI_TEXT.personalLedger.emptyTitle)).toBeTruthy();
    expect(within(home).getByText(UI_TEXT.app.createGroup)).toBeTruthy();
  });

  // [MV]
  test("opening the ledger makes no GET /me/group-shares request and the headline is own-only", async () => {
    signIn();
    fakeApi([
      { route: "GET /groups", body: { groups: [shared, ledger] } },
      { route: "GET /groups/group_1", body: groupDetail({ group: shared }) },
      { route: "GET /groups/group_ledger", body: ledgerDetail() },
      {
        route: "GET /me/group-shares",
        body: {
          month: "2026-09",
          groups: [
            {
              group_id: "group_1",
              name: shared.name,
              currency: "TWD",
              archived: false,
              share_minor: 5000,
              expense_count: 1,
              by_category: [{ category: "food", share_minor: 5000 }],
            },
          ],
        },
      },
    ]);
    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));

    const rail = await screen.findByRole("complementary", { name: UI_TEXT.app.groupList });
    fireEvent.click(within(rail).getByText(UI_TEXT.personalLedger.name).closest("button") as HTMLElement);
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_ledger"));

    // own 12000 (ledgerDetail's seeded expense) only - no group share folded in.
    await waitFor(() =>
      expect(document.querySelector(".home-balance-amount")?.textContent).toBe(formatAmount(12000, "TWD")),
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/me/group-shares"))).toBe(false);
    const home = await screen.findByRole("region", { name: UI_TEXT.personalLedger.homeLabel });
    expect(within(home).queryByText(/群組分攤/)).toBeNull();
  });
});

describe("提醒還款", () => {
  const bob = {
    id: "member_bob",
    group_id: "group_1",
    user_id: "user_bob",
    display_name: "Bob",
    role: "member" as const,
    status: "active" as const,
  };
  const alice = {
    id: "member_alice",
    group_id: "group_1",
    user_id: "user_alice",
    display_name: "Alice",
    role: "owner" as const,
    status: "active" as const,
  };
  const virtualCarol = {
    id: "member_carol",
    group_id: "group_1",
    user_id: null,
    display_name: "Carol",
    role: "member" as const,
    status: "active" as const,
  };

  /** Alice is owed 320 by Bob; Carol (no account) is down 100 as well. */
  function debtDetail() {
    return groupDetail({
      members: [alice, bob, virtualCarol],
      balances: [
        { memberId: "member_alice", balance: { amount_minor: 42000, currency: "TWD" } },
        { memberId: "member_bob", balance: { amount_minor: -32000, currency: "TWD" } },
        { memberId: "member_carol", balance: { amount_minor: -10000, currency: "TWD" } },
      ],
    });
  }

  async function openMemberList() {
    signIn();
    const api = fakeApi([
      { route: "GET /groups", body: { groups: [group()] } },
      { route: "GET /groups/group_1", body: debtDetail() },
      { route: "POST /groups/group_1/members/member_bob/nudge", body: { nudge: { status: "sent" } } },
    ]);
    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));
    // Phase 3: 群組成員 moved from the desktop rail into the ▾ menu beside the
    // group's name — open that first.
    fireEvent.click(screen.getByRole("button", { name: UI_TEXT.app.groupManage }));
    fireEvent.click(screen.getByRole("button", { name: UI_TEXT.app.members }));
    // The shared bottom sheet is labelled 群組首頁 whatever it is showing.
    await screen.findByRole("dialog", { name: UI_TEXT.app.groupHome });
    return api;
  }

  /**
   * Scoped to the member sheet. Not load-bearing for the tests in this file
   * (none of them expand a home-screen member row, which is the only other
   * place this aria-label appears now that the always-visible 債務關係 card
   * is gone - see groupHomeDisclosure.test.tsx for that surface) but kept as
   * insurance against a future test that opens both at once.
   */
  function nudgeButtonFor(name: string) {
    const sheet = screen.getByRole("dialog", { name: UI_TEXT.app.groupHome });
    return within(sheet).queryByRole("button", { name: `${UI_TEXT.app.nudgeAria}: ${name}` });
  }

  test("sits on the member row you expanded, next to 清償", async () => {
    signIn();
    const api = fakeApi([
      { route: "GET /groups", body: { groups: [group()] } },
      { route: "GET /groups/group_1", body: debtDetail() },
      { route: "POST /groups/group_1/members/member_bob/nudge", body: { nudge: { status: "sent" } } },
    ]);
    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));

    // Collapsed by default - tap Bob's row (he owes the most) to reveal
    // 清償/提醒. No dialog, no drawer: this is the home screen itself.
    const bobName = await screen.findByText("Bob");
    fireEvent.click(bobName.closest(".member-row-head")!);

    const nudge = await screen.findByRole("button", { name: `${UI_TEXT.app.nudgeAria}: Bob` });
    const row = nudge.closest(".member-row") as HTMLElement;
    expect(row).toBeTruthy();
    expect(within(row).getByRole("button", { name: UI_TEXT.app.clearDebt })).toBeTruthy();

    fireEvent.click(nudge);

    await waitFor(() => expect(api.calls).toContain("POST /groups/group_1/members/member_bob/nudge"));
    await waitFor(() => expect((nudge as HTMLButtonElement).disabled).toBe(true));
  });

  test("is not offered on the row when the debtor is the logged-in user", async () => {
    signIn();
    // Alice (this session) owes Bob - the reminder would be to herself.
    fakeApi([
      { route: "GET /groups", body: { groups: [group()] } },
      {
        route: "GET /groups/group_1",
        body: groupDetail({
          members: [alice, bob],
          balances: [
            { memberId: "member_alice", balance: { amount_minor: -32000, currency: "TWD" } },
            { memberId: "member_bob", balance: { amount_minor: 32000, currency: "TWD" } },
          ],
        }),
      },
    ]);
    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));

    // Expand Bob's row: 清償 (settle up with Bob) is there, 提醒 towards
    // yourself never is - on this row or any other.
    const bobName = await screen.findByText("Bob");
    fireEvent.click(bobName.closest(".member-row-head")!);
    await screen.findByRole("button", { name: UI_TEXT.app.clearDebt });
    expect(screen.queryByRole("button", { name: `${UI_TEXT.app.nudgeAria}: Alice` })).toBeNull();
  });

  test("is offered only for a member with an account who owes the group", async () => {
    await openMemberList();

    expect(nudgeButtonFor("Bob")).toBeTruthy();
    // Carol has no login, so there is nothing to deliver a reminder to.
    expect(nudgeButtonFor("Carol")).toBeNull();
    // Alice is the logged-in user, and is owed money rather than owing it.
    expect(nudgeButtonFor("Alice")).toBeNull();
  });

  test("sends the reminder and stops offering it again", async () => {
    const api = await openMemberList();

    fireEvent.click(nudgeButtonFor("Bob")!);

    await waitFor(() => expect(api.calls).toContain("POST /groups/group_1/members/member_bob/nudge"));
    await waitFor(() => expect(screen.getByText(`${UI_TEXT.app.nudgeSentToast}Bob`)).toBeTruthy());
    await waitFor(() => expect((nudgeButtonFor("Bob") as HTMLButtonElement).disabled).toBe(true));
  });

  test("says so when somebody else got there first, and does not keep offering", async () => {
    signIn();
    fakeApi([
      { route: "GET /groups", body: { groups: [group()] } },
      { route: "GET /groups/group_1", body: debtDetail() },
      {
        route: "POST /groups/group_1/members/member_bob/nudge",
        status: 409,
        body: { error: { code: "NUDGE_COOLDOWN", message: "too soon", request_id: "req_1" } },
      },
    ]);
    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));
    // Phase 3: 群組成員 moved from the desktop rail into the ▾ menu beside the
    // group's name — open that first.
    fireEvent.click(screen.getByRole("button", { name: UI_TEXT.app.groupManage }));
    fireEvent.click(screen.getByRole("button", { name: UI_TEXT.app.members }));
    // The shared bottom sheet is labelled 群組首頁 whatever it is showing.
    await screen.findByRole("dialog", { name: UI_TEXT.app.groupHome });

    fireEvent.click(nudgeButtonFor("Bob")!);

    // A refusal the user can act on ("wait"), not a generic 失敗 - and the
    // button goes quiet, because pressing it again would refuse again.
    await waitFor(() => expect(screen.getByText(UI_TEXT.app.nudgeCooldown)).toBeTruthy());
    await waitFor(() => expect((nudgeButtonFor("Bob") as HTMLButtonElement).disabled).toBe(true));
  });
});

describe("unread badges on the group list", () => {
  const tokyo = group();
  const osaka = group({ id: "group_2", name: "大阪旅行" });

  function signInWithUnread(unread: number) {
    signIn();
    return fakeApi([
      {
        route: "GET /groups",
        body: { groups: [{ ...tokyo, unread_count: 0 }, { ...osaka, unread_count: unread }] },
      },
      { route: "GET /groups/group_1", body: groupDetail() },
      { route: "GET /groups/group_2", body: groupDetail({ group: osaka }) },
      { route: "POST /groups/group_2/read", body: { group_id: "group_2", last_read_at: "2026-07-30T00:00:00.000Z" } },
    ]);
  }

  test("a group somebody else added to shows how many entries are new", async () => {
    signInWithUnread(3);
    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));

    const rail = await screen.findByRole("complementary", { name: UI_TEXT.app.groupList });
    const osakaRow = within(rail).getByText("大阪旅行").closest("button") as HTMLElement;

    expect(within(osakaRow).getByText("3")).toBeTruthy();
    // The group being looked at is not badged - it is about to be read.
    const tokyoRow = within(rail).getByText("東京旅行").closest("button") as HTMLElement;
    expect(within(tokyoRow).queryByText("0")).toBeNull();
  });

  test("opening the group clears the badge and tells the server", async () => {
    const api = signInWithUnread(3);
    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));

    const rail = await screen.findByRole("complementary", { name: UI_TEXT.app.groupList });
    fireEvent.click(within(rail).getByText("大阪旅行").closest("button") as HTMLElement);

    await waitFor(() => expect(api.calls).toContain("POST /groups/group_2/read"));
    // Cleared locally too, without waiting for the next list refresh.
    await waitFor(() => expect(within(rail).queryByText("3")).toBeNull());
  });

  test("a failed mark-read still clears the badge for this visit", async () => {
    signIn();
    // No POST route: fetch rejects, which is what an unreachable server looks
    // like to the api client.
    fakeApi([
      { route: "GET /groups", body: { groups: [{ ...tokyo, unread_count: 0 }, { ...osaka, unread_count: 2 }] } },
      { route: "GET /groups/group_1", body: groupDetail() },
      { route: "GET /groups/group_2", body: groupDetail({ group: osaka }) },
    ]);
    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));

    const rail = await screen.findByRole("complementary", { name: UI_TEXT.app.groupList });
    fireEvent.click(within(rail).getByText("大阪旅行").closest("button") as HTMLElement);

    // No toast, no stuck badge: this is a nicety, not the user's data.
    await waitFor(() => expect(within(rail).queryByText("2")).toBeNull());
  });
});
