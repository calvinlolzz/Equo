// @vitest-environment jsdom
import { act, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fakeApi, group, groupDetail, renderApp, signIn, stubBrowser } from "./appTestHarness";
import { UI_TEXT } from "./uiText";

const app = UI_TEXT.app;

beforeEach(() => {
  // Mobile viewport: the width breakpoint answers true, so useIsMobileLayout
  // starts (and stays) mobile - the whole point being that the desktop rails /
  // FAB become inert+aria-hidden while the top-bar drawer buttons and the
  // bottom tab bar become live.
  stubBrowser({ mobile: true });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * The mobile-layout half of the page. App.test.tsx pins the harness to the
 * desktop breakpoint, so nothing there ever exercises the drawers, the bottom
 * tab bar, or the inert/aria-hidden wiring that keeps the hidden half of the UI
 * out of the accessibility tree. These do.
 */

async function landOnGroup() {
  signIn();
  fakeApi([
    { route: "GET /groups", body: { groups: [group()] } },
    { route: "GET /groups/group_1", body: groupDetail() },
  ]);
  renderApp();
  await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));
}

/**
 * The device Back button / iOS edge-swipe. jsdom traverses history
 * asynchronously, so wait for the popstate it fires rather than for a timer;
 * a back() with nothing behind it fires none at all and would otherwise hang
 * until the suite timed out.
 */
async function pressBack() {
  const traversed = new Promise<void>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("popstate", onPopState);
      reject(new Error("history.back() fired no popstate - nothing to go back to"));
    }, 1_000);
    function onPopState() {
      window.clearTimeout(timer);
      resolve();
    }
    window.addEventListener("popstate", onPopState, { once: true });
  });

  await act(async () => {
    window.history.back();
    await traversed;
  });
}

async function openComposer() {
  screen.getByRole("button", { name: app.addExpense }).click();
  return screen.findByRole("dialog", { name: app.addExpense });
}

/** Taps the composer's numeric keypad, which is the mobile amount step. */
async function typeAmount(digits: string) {
  // Scoped to the composer: the home screen behind it has a row of date chips
  // labelled with day numbers, so a global query for "1" is ambiguous on the
  // 1st of the month. (It was, on the day this scoping was added.)
  const composer = screen.getByRole("dialog", { name: app.addExpense });
  for (const digit of digits) {
    within(composer).getByRole("button", { name: digit }).click();
  }
  // The keypad writes straight into the amount, so the sheet is dirty as soon
  // as the effect that reports it up has flushed.
  await waitFor(() => expect(screen.getByText(new RegExp(digits))).toBeTruthy());
}

describe("the mobile chrome", () => {
  test("shows the drawer buttons and bottom tab bar, and hides the desktop rail", async () => {
    await landOnGroup();

    // The top-bar drawer triggers and the bottom tab bar are live on mobile.
    expect(screen.getByRole("button", { name: app.groupList })).toBeTruthy();
    // 群組管理 moved out of the top bar into the 設定 tab.
    expect(screen.queryByRole("button", { name: app.groupManage })).toBeNull();
    expect(screen.getByRole("button", { name: app.navRecords })).toBeTruthy();
    expect(screen.getByRole("button", { name: app.navAnalysis })).toBeTruthy();
    expect(screen.getByRole("button", { name: app.navSettings })).toBeTruthy();

    // The desktop group rail is aria-hidden on mobile, so its actions are out of
    // the accessibility tree entirely - not merely visually hidden. If the inert
    // wiring regressed, these would leak back in as duplicate, focusable controls.
    expect(screen.queryByRole("button", { name: app.refresh })).toBeNull();
    expect(screen.queryByRole("button", { name: app.archivedGroups })).toBeNull();
  });
});

describe("the phone top bar", () => {
  test("names the group in the middle, between the drawer button and the avatar", async () => {
    await landOnGroup();

    const banner = screen.getByRole("banner");
    // Not the brand: on a screen this narrow, "which group am I in" is the
    // thing worth the middle slot.
    expect(within(banner).getByText("東京旅行")).toBeTruthy();
    expect(within(banner).queryByText("Equo")).toBeNull();
    expect(within(banner).getByLabelText(app.groupList)).toBeTruthy();
    expect(within(banner).getByLabelText(app.profile)).toBeTruthy();
  });

  test("the profile button is the Google picture when there is one", async () => {
    window.localStorage.setItem(
      "equo.clean.session",
      JSON.stringify({
        expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
        user: {
          id: "user_alice",
          email: "alice@example.com",
          displayName: "Alice",
          avatarUrl: "https://lh3.googleusercontent.com/a/photo=s96-c",
        },
      }),
    );
    fakeApi([
      { route: "GET /groups", body: { groups: [group()] } },
      { route: "GET /groups/group_1", body: groupDetail() },
    ]);
    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));

    const avatar = within(screen.getByLabelText(app.profile)).getByRole("presentation", { hidden: true });
    expect(avatar.getAttribute("src")).toContain("lh3.googleusercontent.com");
  });
});

describe("the group drawer", () => {
  test("the group-list button opens it, and choosing a group navigates and closes it", async () => {
    signIn();
    fakeApi([
      { route: "GET /groups", body: { groups: [group(), group({ id: "group_2", name: "室友開銷" })] } },
      { route: "GET /groups/group_1", body: groupDetail() },
      { route: "GET /groups/group_2", body: groupDetail({ group: group({ id: "group_2", name: "室友開銷" }) }) },
    ]);
    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));

    // Open the left drawer from the top bar.
    screen.getByRole("button", { name: app.groupList }).click();
    const drawer = await screen.findByRole("dialog", { name: app.groupList });

    // Pick the other group from inside the drawer (scoped, so the inert desktop
    // rail's copy of the same name can't satisfy the query by accident).
    within(drawer).getByText("室友開銷").click();

    await waitFor(() => expect(window.location.pathname).toBe("/group/group_2"));
    // Selecting a group closes the drawer.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: app.groupList })).toBeNull());
  });
});

describe("the settings drawer", () => {
  test("the 設定 tab opens the right drawer", async () => {
    await landOnGroup();

    expect(screen.queryByRole("dialog", { name: app.groupManage })).toBeNull();

    screen.getByRole("button", { name: app.navSettings }).click();

    expect(await screen.findByRole("dialog", { name: app.groupManage })).toBeTruthy();
    // ...and the tab bar says that is where you are.
    expect(screen.getByRole("button", { name: app.navSettings }).getAttribute("aria-current")).toBe("page");
  });
});

describe("the bottom tab bar", () => {
  test("marks the current destination, and moves the mark as you navigate", async () => {
    await landOnGroup();

    // Nothing open: home is where you are.
    expect(screen.getByRole("button", { name: app.navHome })).toHaveProperty("ariaCurrent", "page");
    expect(screen.getByRole("button", { name: app.navRecords }).getAttribute("aria-current")).toBeNull();

    screen.getByRole("button", { name: app.navRecords }).click();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: app.navRecords }).getAttribute("aria-current")).toBe("page"),
    );
    // ...and only one tab is ever marked.
    expect(screen.getByRole("button", { name: app.navHome }).getAttribute("aria-current")).toBeNull();
  });

  test("opens the records panel", async () => {
    await landOnGroup();

    screen.getByRole("button", { name: app.navRecords }).click();

    // The panel is the flow-dialog (aria-label 群組首頁); 匯出 CSV lives only in
    // the records panel, so finding it inside that dialog proves the tab wired
    // through to the right panel.
    const panel = await screen.findByRole("dialog", { name: app.groupHome });
    // findBy, not getBy: the panel's own chunk is lazy (see App.tsx), so the
    // dialog frame is on screen a tick before its contents are.
    expect(await within(panel).findByText(app.exportCsv)).toBeTruthy();
  });
});

/**
 * The Back button is the phone's primary dismiss gesture. Before
 * useOverlayHistory nothing but the open group lived in history, so Back with a
 * sheet open left the group entirely - or exited the installed PWA - and threw
 * away whatever was on screen.
 */
describe("the Back button", () => {
  test("closes an open panel and stays on the group", async () => {
    await landOnGroup();

    screen.getByRole("button", { name: app.navRecords }).click();
    await screen.findByRole("dialog", { name: app.groupHome });

    await pressBack();

    await waitFor(() => expect(screen.queryByRole("dialog", { name: app.groupHome })).toBeNull());
    expect(window.location.pathname).toBe("/group/group_1");
  });

  test("closes an untouched expense composer rather than leaving the group", async () => {
    await landOnGroup();

    await openComposer();

    await pressBack();

    await waitFor(() => expect(screen.queryByRole("dialog", { name: app.addExpense })).toBeNull());
    expect(screen.queryByRole("dialog", { name: app.discardExpenseTitle })).toBeNull();
    expect(window.location.pathname).toBe("/group/group_1");
  });

  test("asks before throwing away a half-filled expense", async () => {
    await landOnGroup();
    await openComposer();
    await typeAmount("120");

    await pressBack();

    // Still there, with the question on top — Back is far easier to hit by
    // accident than the backdrop, so it must not silently discard.
    expect(await screen.findByRole("dialog", { name: app.discardExpenseTitle })).toBeTruthy();
    expect(screen.getByRole("dialog", { name: app.addExpense })).toBeTruthy();
    expect(window.location.pathname).toBe("/group/group_1");
  });

  test("繼續編輯 keeps the draft, and a second Back answers it the same way", async () => {
    await landOnGroup();
    await openComposer();
    await typeAmount("120");

    await pressBack();
    await screen.findByRole("dialog", { name: app.discardExpenseTitle });

    // Back again dismisses the confirm rather than the composer under it.
    await pressBack();

    await waitFor(() => expect(screen.queryByRole("dialog", { name: app.discardExpenseTitle })).toBeNull());
    expect(screen.getByRole("dialog", { name: app.addExpense })).toBeTruthy();
  });

  test("放棄 closes the composer for good", async () => {
    await landOnGroup();
    await openComposer();
    await typeAmount("120");

    await pressBack();
    const confirm = await screen.findByRole("dialog", { name: app.discardExpenseTitle });
    within(confirm).getByRole("button", { name: app.discardExpenseConfirm }).click();

    await waitFor(() => expect(screen.queryByRole("dialog", { name: app.addExpense })).toBeNull());
    expect(screen.queryByRole("dialog", { name: app.discardExpenseTitle })).toBeNull();
    expect(window.location.pathname).toBe("/group/group_1");
  });

  test("closes a drawer rather than leaving the group", async () => {
    await landOnGroup();

    screen.getByRole("button", { name: app.navSettings }).click();
    await screen.findByRole("dialog", { name: app.groupManage });

    await pressBack();

    await waitFor(() => expect(screen.queryByRole("dialog", { name: app.groupManage })).toBeNull());
    expect(window.location.pathname).toBe("/group/group_1");
  });
});
