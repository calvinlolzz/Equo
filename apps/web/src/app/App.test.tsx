// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fakeApi, group, groupDetail, renderApp, signIn, stubBrowser, SESSION_KEY } from "./appTestHarness";
import { stashPendingRoute } from "./pendingRoute";
import { UI_TEXT } from "./uiText";

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

  test("the wall makes no API calls at all - not even a groups fetch", async () => {
    const api = fakeApi([]);

    renderApp();
    await screen.findByText(UI_TEXT.login.googleLogin);

    expect(api.calls).toEqual([]);
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
