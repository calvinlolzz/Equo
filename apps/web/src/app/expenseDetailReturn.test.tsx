// @vitest-environment jsdom
import { act, cleanup, configure, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ExpenseSummary } from "./apiClient";
import { fakeApi, group, groupDetail, renderApp, signIn, stubBrowser } from "./appTestHarness";
import { UI_TEXT } from "./uiText";

/**
 * The expense detail is a layer stacked over whatever is already open (the
 * records sheet, or home) rather than a `dialog` mode that replaces it -
 * see useExpenseComposer's openExpenseDetail and App.tsx's
 * expenseDetailOpen. These tests prove the records sheet survives
 * underneath - its filter, search text and scroll position - that the
 * device Back button peels the detail off one layer at a time instead of
 * leaving the group entirely, and that a delete or edit reached through the
 * detail doesn't leave the records panel's own search cache stale (see
 * useExpenseSearch's invalidateToken/removeLocally).
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
  // Overriding amount_minor alone (as the other fixtures in this file do)
  // would leave the default 96,000 payments/shares out of sync with it - a
  // mismatch nothing here USED to check, until the edit test below tries to
  // submit a save for this row: the composer's own split-sum validation
  // then disables the save button and the test times out on a PUT that
  // never fires.
  expense_payments: [{ payer_member_id: "member_alice", amount_minor: 54_000, currency: "TWD" }],
  expense_shares: [{ member_id: "member_alice", share_type: "fixed", amount_minor: 54_000 }],
});
const BENTO = expenseRow({
  id: "expense_3",
  title: "便當",
  amount_minor: 12_000,
  expense_date: "2026-09-02",
  created_at: "2026-09-02T10:00:00.000Z",
  client_request_id: "seed_3",
});
/**
 * Never part of the loaded `expenses` window (see detail() below) - only
 * reachable through the server search, the way App.test.tsx's own
 * "finds a match that is older than the loaded window" fixture is. Opening
 * and deleting THIS row is what actually exercises useExpenseComposer's
 * selectedExpenseSnapshot fallback and useExpenseSearch's removeLocally -
 * a row that is also in `expenses` would resolve (and could be removed)
 * without either.
 */
const OLD_RAMEN = expenseRow({
  id: "expense_old",
  title: "去年的拉麵",
  amount_minor: 88_000,
  expense_date: "2025-01-09",
  created_at: "2025-01-09T10:00:00.000Z",
  client_request_id: "seed_old",
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

async function land(extraRoutes: Array<{ route: string; body: unknown; status?: number }> = []) {
  signIn();
  const api = fakeApi([
    { route: "GET /groups", body: { groups: [group()] } },
    { route: "GET /groups/group_1", body: detail() },
    {
      route: "GET /groups/group_1/expenses/search",
      body: { has_more: false, expenses: [expenseRow()], match_count: 1, match_total_minor: 96_000 },
    },
    { route: "DELETE /groups/group_1/expenses/expense_1", body: { expense: { id: "expense_1" } } },
    ...extraRoutes,
  ]);
  renderApp();
  await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));
  return api;
}

/**
 * Open 紀錄, search for 拉, and open 拉麵's detail. Returns the search input.
 *
 * Scoped to the records panel throughout (not `screen` directly): home's own
 * 最近記錄 section also shows 拉麵 inline underneath this panel, so an
 * unscoped query for the text would match two elements.
 */
async function openRecordsSearchAndDetail() {
  fireEvent.click(screen.getByRole("button", { name: app.navRecords }));
  const search = await screen.findByLabelText(UI_TEXT.records.searchLabel);
  const panel = search.closest(".panel-dialog");
  if (!panel) throw new Error("search input is not inside the records panel");
  fireEvent.change(search, { target: { value: "拉" } });
  const row = await within(panel as HTMLElement).findByText("拉麵");
  fireEvent.click(row.closest(".record-dialog-row")!);
  await screen.findByRole("dialog", { name: UI_TEXT.expenseDetail.title });
  return search;
}

describe("the detail stacks over the records sheet instead of replacing it", () => {
  // [MV]
  test("closing the detail leaves the records sheet exactly as it was", async () => {
    await land();
    const search = await openRecordsSearchAndDetail();

    // The records sheet's own backdrop is marked covered while the detail
    // sits on top of it - see App.tsx's data-covered and useDialogChrome's
    // guard against it handling Escape/Tab twice.
    expect(document.querySelector('.modal-backdrop[data-covered="detail"]')).toBeTruthy();

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
  test("deleting an out-of-window row from the detail drops it from the cached search page", async () => {
    const api = await land([
      {
        route: "GET /groups/group_1/expenses/search",
        body: { has_more: false, expenses: [OLD_RAMEN], match_count: 1, match_total_minor: 88_000 },
      },
      { route: "DELETE /groups/group_1/expenses/expense_old", body: { expense: { id: "expense_old" } } },
    ]);

    fireEvent.click(screen.getByRole("button", { name: app.navRecords }));
    const search = await screen.findByLabelText(UI_TEXT.records.searchLabel);
    const panel = search.closest(".panel-dialog") as HTMLElement;
    fireEvent.change(search, { target: { value: "去年" } });

    // Confirms the SERVER path is what's on screen, not the local fallback
    // filtering the loaded window (which has no 去年的拉麵 at all - see
    // OLD_RAMEN's own doc comment): this only appears once the debounced
    // search request lands.
    await within(panel).findByText("去年的拉麵");
    expect(within(panel).getByText(`${UI_TEXT.records.matchPrefix}1${UI_TEXT.records.matchMiddle}$880`)).toBeTruthy();

    fireEvent.click(within(panel).getByText("去年的拉麵").closest(".record-dialog-row")!);
    await screen.findByRole("dialog", { name: UI_TEXT.expenseDetail.title });

    // The real server would no longer answer with this row from here on -
    // simulate that landing before invalidateToken's debounced refetch fires
    // (300ms), so this test does not depend on outrunning that timer: without
    // this, removeLocally's optimistic removal would be correct for a
    // moment and then get overwritten by a refetch of the (still stale)
    // mocked page.
    api.set("GET /groups/group_1/expenses/search", { has_more: false, expenses: [], match_count: 0, match_total_minor: 0 });

    fireEvent.click(screen.getByRole("button", { name: app.deleteExpense }));
    fireEvent.click(screen.getByRole("button", { name: app.confirmDelete }));

    // Waiting for the detail to close (not merely for the DELETE call to be
    // dispatched) is what's needed: deleteExpense's own state updates -
    // closing the detail AND setting lastDeletedExpenseId - both run in the
    // same post-await continuation, after api.calls already recorded the
    // request.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: UI_TEXT.expenseDetail.title })).toBeNull());
    expect(api.calls).toContain("DELETE /groups/group_1/expenses/expense_old");
    // The row and its summary are both gone at once (removeLocally updates
    // both from the same cached page) - not just the row, which would leave
    // "符合 1 筆" standing over an empty list. Polled, not asserted outright:
    // the row's removal is one more render past the detail closing (a
    // sibling effect in the records panel, not part of the same commit the
    // dialog-closed check above already waited out).
    await waitFor(() => expect(within(panel).queryByText("去年的拉麵")).toBeNull());
    expect(within(panel).getByText(`${UI_TEXT.records.matchPrefix}0${UI_TEXT.records.matchMiddle}$0`)).toBeTruthy();
  });

  // [MV]
  test("editing from the detail refetches the cached search page - the old title doesn't linger", async () => {
    const api = await land([
      {
        route: "PUT /groups/group_1/expenses/expense_2",
        body: { expense: { ...IZAKAYA, title: "居酒屋（二次會）" } },
      },
    ]);
    api.set("GET /groups/group_1/expenses/search", {
      has_more: false,
      expenses: [IZAKAYA],
      match_count: 1,
      match_total_minor: 54_000,
    });

    fireEvent.click(screen.getByRole("button", { name: app.navRecords }));
    const search = await screen.findByLabelText(UI_TEXT.records.searchLabel);
    const panel = search.closest(".panel-dialog") as HTMLElement;
    fireEvent.change(search, { target: { value: "居" } });
    const row = await within(panel).findByText("居酒屋");
    fireEvent.click(row.closest(".record-dialog-row")!);
    await screen.findByRole("dialog", { name: UI_TEXT.expenseDetail.title });

    fireEvent.click(screen.getByRole("button", { name: app.editExpenseAction }));
    const composer = await screen.findByRole("dialog", { name: app.addExpense }, { timeout: 8000 });
    // The phone composer always opens on its amount step (see
    // ExpenseComposerSheet's stepIndex) - the title field is one step past
    // it, on 明細. Editing pre-fills the amount, so 下一步 is enabled at once.
    fireEvent.click(within(composer).getByRole("button", { name: app.stepNext }));
    fireEvent.change(within(composer).getByLabelText(app.title), { target: { value: "居酒屋（二次會）" } });
    // The real server would answer with the edited title from here on -
    // simulate that landing before the save resolves.
    api.set("GET /groups/group_1/expenses/search", {
      has_more: false,
      expenses: [{ ...IZAKAYA, title: "居酒屋（二次會）" }],
      match_count: 1,
      match_total_minor: 54_000,
    });
    const submit = within(composer)
      .getAllByRole("button", { name: app.saveChanges })
      .find((button) => button.className.includes("composer-submit"));
    fireEvent.click(submit as HTMLElement);

    await waitFor(() => expect(api.calls).toContain("PUT /groups/group_1/expenses/expense_2"));
    // Not just gone from the composer - the records panel underneath it,
    // still showing the pre-edit cached page, picks up the refetch too.
    await waitFor(() => expect(within(panel).queryByText("居酒屋（二次會）")).toBeTruthy());
    expect(within(panel).queryByText("居酒屋")).toBeNull();
  });

  // [MV] (the × close button in ExpenseComposerSheet's header is what lets
  // this test close the composer.)
  test("編輯 from a detail opened over records opens the composer without losing the records sheet", async () => {
    await land();
    const search = await openRecordsSearchAndDetail();

    fireEvent.click(screen.getByRole("button", { name: app.editExpenseAction }));
    // The composer's dialog role is always named by text.addExpense, even
    // while editing (ExpenseComposerSheet's header) - text.editExpense only
    // labels its heading. A generous timeout: this is the file's only
    // dynamic import of the (lazy-chunked) composer, and that first import
    // can run past the file's default 4s asyncUtilTimeout.
    const composer = await screen.findByRole("dialog", { name: app.addExpense }, { timeout: 8000 });
    // The records sheet is still mounted underneath the composer, and its
    // backdrop is marked covered by the composer specifically (a different
    // z-index fix-up than the "detail" case - see app-dialogs.css's
    // data-covered="composer" rule).
    expect(search).toBeTruthy();
    expect(screen.getByLabelText(UI_TEXT.records.searchLabel)).toBeTruthy();
    expect(document.querySelector('.modal-backdrop[data-covered="composer"]')).toBeTruthy();

    fireEvent.click(within(composer).getByRole("button", { name: app.close }));

    await waitFor(() => expect(screen.queryByRole("dialog", { name: app.addExpense })).toBeNull());
    expect(screen.getByLabelText(UI_TEXT.records.searchLabel)).toBeTruthy();
  });

  test("a detail opened from a home row leaves no records sheet behind when closed", async () => {
    await land();
    // 最近記錄's rows are inline on home, not behind a tap - see GroupHome's
    // HomeRecordsSection.
    const row = await screen.findByText("拉麵");
    fireEvent.click(row.closest(".expense-record-row")!);
    await screen.findByRole("dialog", { name: UI_TEXT.expenseDetail.title });

    fireEvent.click(screen.getByRole("dialog", { name: UI_TEXT.expenseDetail.title }).querySelector(`[aria-label="${app.cancel}"]`)!);

    await waitFor(() => expect(screen.queryByRole("dialog", { name: UI_TEXT.expenseDetail.title })).toBeNull());
    expect(document.querySelector(".panel-dialog")).toBeNull();
  });
});
