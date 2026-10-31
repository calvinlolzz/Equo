// @vitest-environment jsdom
import { cleanup, configure, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ExpenseSummary } from "./apiClient";
import { fakeApi, group, groupDetail, renderApp, signIn, stubBrowser } from "./appTestHarness";
import { UI_TEXT } from "./uiText";

/**
 * Links from the LINE bot, end to end through the real <App />: the URL goes
 * in, the right surface comes up, the parameters leave the address bar, and
 * Back closes what was opened instead of leaving the page. The unit tests in
 * useLineIntent.test.tsx pin the hook; these pin that App.tsx actually wires it.
 */
configure({ asyncUtilTimeout: 4_000 });
vi.setConfig({ testTimeout: 15_000 });

const app = UI_TEXT.app;
const KEY = "msg:1234567890";
const ENTRY_ROUTE = `GET /me/line/entries/${encodeURIComponent(KEY)}`;

const LEDGER = "ledger_alice";

function ledger() {
  return group({ id: LEDGER, name: "個人帳本", kind: "personal", owner_member_id: "member_alice" });
}

function entry(): ExpenseSummary {
  return {
    id: "expense_1",
    group_id: LEDGER,
    title: "早餐",
    kind: "expense",
    category: "food",
    amount_minor: 6000,
    currency: "TWD",
    expense_date: "2026-11-01",
    created_at: "2026-11-01T08:00:00.000Z",
    version: 1,
    client_request_id: `line:${KEY}`,
    expense_payments: [{ payer_member_id: "member_alice", amount_minor: 6000, currency: "TWD" }],
    expense_shares: [{ member_id: "member_alice", share_type: "equal", amount_minor: 6000 }],
  };
}

function ledgerDetail() {
  const base = groupDetail({ group: ledger(), expenses: [entry()] });
  return { ...base, members: base.members.map((member) => ({ ...member, group_id: LEDGER })) };
}

function liveResolution() {
  return { status: "live", group_id: LEDGER, expense_id: "expense_1", expense_date: "2026-11-01", edited: false };
}

beforeEach(() => {
  stubBrowser();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function pressBack() {
  const traversed = new Promise<void>((resolve) => window.addEventListener("popstate", () => resolve(), { once: true }));
  window.history.back();
  await traversed;
}

describe("a link from the LINE bot, through the whole app", () => {
  test("?view=records opens the records sheet, cleans the URL, and Back closes it without leaving", async () => {
    signIn();
    fakeApi([
      { route: "GET /groups", body: { groups: [ledger()] } },
      { route: `GET /groups/${LEDGER}`, body: ledgerDetail() },
    ]);
    window.history.replaceState(null, "", `/group/${LEDGER}?view=records&openExternalBrowser=1`);

    renderApp();

    expect(await screen.findByLabelText(UI_TEXT.records.searchLabel)).toBeTruthy();
    expect(window.location.pathname).toBe(`/group/${LEDGER}`);
    expect(window.location.search).toBe("?openExternalBrowser=1");

    await pressBack();

    await waitFor(() => expect(screen.queryByLabelText(UI_TEXT.records.searchLabel)).toBeNull());
    expect(window.location.pathname).toBe(`/group/${LEDGER}`);
  });

  test("?view=analysis opens the analysis sheet", async () => {
    signIn();
    fakeApi([
      { route: "GET /groups", body: { groups: [ledger()] } },
      { route: `GET /groups/${LEDGER}`, body: ledgerDetail() },
      { route: `GET /groups/${LEDGER}/spend-breakdown`, body: { periods: [] } },
    ]);
    window.history.replaceState(null, "", `/group/${LEDGER}?view=analysis`);

    renderApp();

    expect(await screen.findByText(UI_TEXT.analysis.description)).toBeTruthy();
    expect(window.location.search).toBe("");
  });

  test("?entry=<key> opens that entry in the edit composer, cleans the URL, and Back closes the composer", async () => {
    signIn();
    const api = fakeApi([
      { route: "GET /groups", body: { groups: [ledger()] } },
      { route: `GET /groups/${LEDGER}`, body: ledgerDetail() },
      { route: ENTRY_ROUTE, body: liveResolution() },
    ]);
    window.history.replaceState(null, "", `/group/${LEDGER}?entry=${encodeURIComponent(KEY)}&openExternalBrowser=1`);

    renderApp();

    expect(await screen.findByText(app.editExpense)).toBeTruthy();
    expect((await screen.findByDisplayValue("早餐")) as HTMLInputElement).toBeTruthy();
    expect(api.calls.filter((call) => call === ENTRY_ROUTE)).toHaveLength(1);
    expect(window.location.pathname).toBe(`/group/${LEDGER}`);
    expect(window.location.search).toBe("?openExternalBrowser=1");

    await pressBack();

    await waitFor(() => expect(screen.queryByText(app.editExpense)).toBeNull());
    expect(window.location.pathname).toBe(`/group/${LEDGER}`);
  });

  test("an entry link opened on another group switches to the personal ledger first", async () => {
    signIn();
    fakeApi([
      { route: "GET /groups", body: { groups: [group(), ledger()] } },
      { route: "GET /groups/group_1", body: groupDetail() },
      { route: `GET /groups/${LEDGER}`, body: ledgerDetail() },
      { route: ENTRY_ROUTE, body: liveResolution() },
    ]);
    window.history.replaceState(null, "", `/group/group_1?entry=${encodeURIComponent(KEY)}`);

    renderApp();

    expect(await screen.findByDisplayValue("早餐")).toBeTruthy();
    expect(window.location.pathname).toBe(`/group/${LEDGER}`);
  });

  test.each([
    ["gone", { status: "gone" }, app.lineEntryGone],
    ["not_found", { status: "not_found" }, app.lineEntryNotFound],
  ])("a %s entry says so and opens nothing", async (_name, body, message) => {
    signIn();
    fakeApi([
      { route: "GET /groups", body: { groups: [ledger()] } },
      { route: `GET /groups/${LEDGER}`, body: ledgerDetail() },
      { route: ENTRY_ROUTE, body },
    ]);
    window.history.replaceState(null, "", `/group/${LEDGER}?entry=${encodeURIComponent(KEY)}`);

    renderApp();

    expect(await screen.findByText(message)).toBeTruthy();
    expect(screen.queryByText(app.editExpense)).toBeNull();
    expect(window.location.search).toBe("");
  });

  test("signed out: the link is not looked up, and its parameters are still there for the login redirect", async () => {
    const api = fakeApi([]);
    window.history.replaceState(null, "", `/group/${LEDGER}?entry=${encodeURIComponent(KEY)}`);

    renderApp();

    await screen.findByText(UI_TEXT.login.googleLogin);
    expect(api.calls.filter((call) => call.includes("/me/"))).toEqual([]);
    expect(window.location.search).toContain("entry=");
  });
});
