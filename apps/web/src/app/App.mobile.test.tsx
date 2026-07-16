// @vitest-environment jsdom
import { cleanup, screen, waitFor, within } from "@testing-library/react";
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

describe("the mobile chrome", () => {
  test("shows the drawer buttons and bottom tab bar, and hides the desktop rail", async () => {
    await landOnGroup();

    // The top-bar drawer triggers and the bottom tab bar are live on mobile.
    expect(screen.getByRole("button", { name: app.groupList })).toBeTruthy();
    expect(screen.getByRole("button", { name: app.groupManage })).toBeTruthy();
    expect(screen.getByRole("button", { name: app.navRecords })).toBeTruthy();
    expect(screen.getByRole("button", { name: app.navAnalysis })).toBeTruthy();
    expect(screen.getByRole("button", { name: app.navMembers })).toBeTruthy();

    // The desktop group rail is aria-hidden on mobile, so its actions are out of
    // the accessibility tree entirely - not merely visually hidden. If the inert
    // wiring regressed, these would leak back in as duplicate, focusable controls.
    expect(screen.queryByRole("button", { name: app.refresh })).toBeNull();
    expect(screen.queryByRole("button", { name: app.archivedGroups })).toBeNull();
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
  test("the group-manage button opens the right drawer", async () => {
    await landOnGroup();

    expect(screen.queryByRole("dialog", { name: app.groupManage })).toBeNull();

    screen.getByRole("button", { name: app.groupManage }).click();

    expect(await screen.findByRole("dialog", { name: app.groupManage })).toBeTruthy();
  });
});

describe("the bottom tab bar", () => {
  test("opens the records panel", async () => {
    await landOnGroup();

    screen.getByRole("button", { name: app.navRecords }).click();

    // The panel is the flow-dialog (aria-label 群組首頁); 匯出 CSV lives only in
    // the records panel, so finding it inside that dialog proves the tab wired
    // through to the right panel.
    const panel = await screen.findByRole("dialog", { name: app.groupHome });
    expect(within(panel).getByText(app.exportCsv)).toBeTruthy();
  });
});
