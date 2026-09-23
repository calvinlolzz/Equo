// @vitest-environment jsdom
import { act, cleanup, configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ExpenseSummary } from "./apiClient";
import { fakeApi, group, groupDetail, renderApp, signIn, stubBrowser } from "./appTestHarness";
import { UI_TEXT } from "./uiText";

/**
 * Fix 2: the expense detail is a layer stacked over whatever is already
 * open (the records sheet, or home) rather than a `dialog` mode that
 * replaces it. These tests prove the records sheet survives underneath -
 * its filter, search text and scroll position - and that the device Back
 * button peels the detail off one layer at a time instead of leaving the
 * group entirely.
 */

configure({ asyncUtilTimeout: 4_000 });
vi.setConfig({ testTimeout: 15_000 });

const app = UI_TEXT.app;

beforeEach(() => stubBrowser({ mobile: true }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * The device Back button / iOS edge-swipe. jsdom traverses history
 * asynchronously, so wait for the popstate it fires rather than for a timer;
 * a back() with nothing behind it fires none at all and would otherwise hang
 * until the suite timed out. Copied from App.mobile.test.tsx.
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

const ALICE = {
  id: "member_alice",
  group_id: "group_1",
  user_id: "user_alice",
  display_name: "Alice",
  role: "owner" as const,
  status: "active" as const,
};
const BOB = { ...ALICE, id: "member_bob", user_id: "user_bob", display_name: "Bob", role: "member" as const };

function expenseRow(overrides: Partial<ExpenseSummary> = {}): ExpenseSummary {
  return {
    id: "expense_1",
    group_id: "group_1",
    title: "拉麵",
    kind: "expense",
    category: "food",
    amount_minor: 96_000,
    currency: "TWD",
    expense_date: "2026-09-04",
    created_at: "2026-09-04T10:00:00.000Z",
    version: 1,
    client_request_id: "seed_1",
    expense_payments: [{ payer_member_id: "member_alice", amount_minor: 96_000, currency: "TWD" }],
    expense_shares: [{ member_id: "member_alice", share_type: "fixed", amount_minor: 96_000 }],
    ...overrides,
  };
}

const IZAKAYA = expenseRow({
  id: "expense_2",
  title: "居酒屋",
  amount_minor: 54_000,
  expense_date: "2026-09-03",
  created_at: "2026-09-03T10:00:00.000Z",
  client_request_id: "seed_2",
});
const BENTO = expenseRow({
  id: "expense_3",
  title: "便當",
  amount_minor: 12_000,
  expense_date: "2026-09-02",
  created_at: "2026-09-02T10:00:00.000Z",
  client_request_id: "seed_3",
});

function detail() {
  return groupDetail({
    members: [ALICE, BOB],
    balances: [
      { memberId: "member_alice", balance: { amount_minor: 0, currency: "TWD" } },
      { memberId: "member_bob", balance: { amount_minor: 0, currency: "TWD" } },
    ],
    expenses: [expenseRow(), IZAKAYA, BENTO],
    expense_count: 3,
    spend_total_minor: 162_000,
  });
}

async function land() {
  signIn();
  const api = fakeApi([
    { route: "GET /groups", body: { groups: [group()] } },
    { route: "GET /groups/group_1", body: detail() },
    {
      route: "GET /groups/group_1/expenses/search",
      body: { has_more: false, expenses: [expenseRow()], match_count: 1, match_total_minor: 96_000 },
    },
    { route: "DELETE /groups/group_1/expenses/expense_1", body: { expense: { id: "expense_1" } } },
  ]);
  renderApp();
  await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));
  return api;
}

/** Open 紀錄, search for 拉, and open 拉麵's detail. Returns the search input. */
async function openRecordsSearchAndDetail() {
  fireEvent.click(screen.getByRole("button", { name: app.navRecords }));
  const search = await screen.findByLabelText(UI_TEXT.records.searchLabel);
  fireEvent.change(search, { target: { value: "拉" } });
  const row = await screen.findByText("拉麵");
  fireEvent.click(row.closest(".record-dialog-row")!);
  await screen.findByRole("dialog", { name: UI_TEXT.expenseDetail.title });
  return search;
}

describe("the detail stacks over the records sheet instead of replacing it", () => {
  // [MV]
  test("closing the detail leaves the records sheet exactly as it was", async () => {
    await land();
    const search = await openRecordsSearchAndDetail();

    fireEvent.click(screen.getByRole("dialog", { name: UI_TEXT.expenseDetail.title }).querySelector(`[aria-label="${app.cancel}"]`)!);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: UI_TEXT.expenseDetail.title })).toBeNull());
    expect(screen.getByLabelText(UI_TEXT.records.searchLabel)).toBeTruthy();
    expect((screen.getByLabelText(UI_TEXT.records.searchLabel) as HTMLInputElement).value).toBe("拉");
  });

  // [MV]
  test("Back peels the detail off first, then the records sheet, one layer per press", async () => {
    await land();
    await openRecordsSearchAndDetail();

    await pressBack();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: UI_TEXT.expenseDetail.title })).toBeNull());
    expect(screen.getByLabelText(UI_TEXT.records.searchLabel)).toBeTruthy();

    await pressBack();
    await waitFor(() => expect(screen.queryByLabelText(UI_TEXT.records.searchLabel)).toBeNull());
    expect(window.location.pathname).toBe("/group/group_1");
  });

  // [MV]
  test("deleting from the detail leaves the records sheet open with the row gone", async () => {
    const api = await land();
    await openRecordsSearchAndDetail();

    fireEvent.click(screen.getByRole("button", { name: app.deleteExpense }));
    fireEvent.click(screen.getByRole("button", { name: app.confirmDelete }));

    await waitFor(() => expect(api.calls).toContain("DELETE /groups/group_1/expenses/expense_1"));
    expect(screen.queryByRole("dialog", { name: UI_TEXT.expenseDetail.title })).toBeNull();
    expect(screen.getByLabelText(UI_TEXT.records.searchLabel)).toBeTruthy();
    expect(
      screen.queryAllByRole("button").some((node) => node.className.includes("record-dialog-row") && node.textContent?.includes("拉麵")),
    ).toBe(false);
  });

  // [MV] (Fix 3's × close button is what lets this test close the composer.)
  test("編輯 from a detail opened over records opens the composer without losing the records sheet", async () => {
    await land();
    const search = await openRecordsSearchAndDetail();

    fireEvent.click(screen.getByRole("button", { name: app.editExpenseAction }));
    // The composer's dialog role is always named by text.addExpense, even
    // while editing (ExpenseComposerSheet.tsx:1529) - text.editExpense only
    // labels its heading. A generous timeout: this is the file's only
    // dynamic import of the (lazy-chunked) composer, and that first import
    // can run past the file's default 4s asyncUtilTimeout.
    const composer = await screen.findByRole("dialog", { name: app.addExpense }, { timeout: 8000 });
    // The records sheet is still mounted underneath the composer.
    expect(search).toBeTruthy();
    expect(screen.getByLabelText(UI_TEXT.records.searchLabel)).toBeTruthy();

    fireEvent.click(within(composer).getByRole("button", { name: app.close }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: app.addExpense })).toBeNull());
    expect(screen.getByLabelText(UI_TEXT.records.searchLabel)).toBeTruthy();
  });

  test("a detail opened from a home row leaves no records sheet behind when closed", async () => {
    await land();
    // Before Fix 5, 最近記錄's rows are behind a tap on the disclosure.
    fireEvent.click(document.querySelector<HTMLElement>("#group-records .home-disclosure-toggle")!);
    const row = await screen.findByText("拉麵");
    fireEvent.click(row.closest(".expense-record-row")!);
    await screen.findByRole("dialog", { name: UI_TEXT.expenseDetail.title });

    fireEvent.click(screen.getByRole("dialog", { name: UI_TEXT.expenseDetail.title }).querySelector(`[aria-label="${app.cancel}"]`)!);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: UI_TEXT.expenseDetail.title })).toBeNull());
    expect(document.querySelector(".panel-dialog")).toBeNull();
  });
});
