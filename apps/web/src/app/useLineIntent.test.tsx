// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ExpenseSummary, LineEntryResolution } from "./apiClient";
import type { Expense, Group } from "./appTypes";
import { EN } from "./i18n/en";
import { ZH_HANT } from "./i18n/zhHant";
import { stashLineIntent } from "./lineIntent";
import type { StoredSession } from "./sessionStore";
import { UI_TEXT } from "./uiText";
import { useLineIntent, type UseLineIntentOptions } from "./useLineIntent";

const text = UI_TEXT.app;

const SESSION: StoredSession = {
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: { id: "user_alice", email: "alice@example.com", displayName: "Alice" },
};
const LEDGER = "ledger_alice";
const KEY = "msg:1234567890";
const ENTRY_QUERY = `entry=${encodeURIComponent(KEY)}`;
const GROUP: Group = { id: LEDGER, name: "個人帳本", currency: "TWD", kind: "personal" };

function expense(id: string): Expense {
  return {
    id,
    title: "早餐",
    amountMinor: 6000,
    currency: "TWD",
    createdAt: "2026-11-01T08:00:00.000Z",
    payerId: "m1",
    shareMemberIds: ["m1"],
  };
}

function summary(id: string): ExpenseSummary {
  return {
    id,
    group_id: LEDGER,
    title: "早餐",
    kind: "expense",
    amount_minor: 6000,
    currency: "TWD",
    expense_date: "2026-11-01",
    version: 1,
    client_request_id: `line:${KEY}`,
  };
}

function live(overrides: Partial<Extract<LineEntryResolution, { status: "live" }>> = {}): LineEntryResolution {
  return {
    status: "live",
    group_id: LEDGER,
    expense_id: "expense_1",
    expense_date: "2026-11-01",
    edited: false,
    ...overrides,
  };
}

type SetupOptions = Partial<UseLineIntentOptions> & {
  resolution?: LineEntryResolution | Error;
  searchResult?: { expenses: ExpenseSummary[] } | Error;
};

function setup(url: string, options: SetupOptions = {}) {
  const { resolution = live(), searchResult = { expenses: [summary("expense_1")] }, ...initial } = options;
  window.history.replaceState(null, "", url);

  const resolveLineEntry = vi.fn(async (_key: string) => {
    if (resolution instanceof Error) throw resolution;
    return resolution;
  });
  const searchExpenses = vi.fn(async (_groupId: string, _query: unknown) => {
    if (searchResult instanceof Error) throw searchResult;
    return { ...searchResult, match_count: searchResult.expenses.length, match_total_minor: 0, has_more: false };
  });
  const spies = {
    openGroup: vi.fn(),
    setDialog: vi.fn(),
    openExpenseEdit: vi.fn(),
    showToast: vi.fn(),
    resolveLineEntry,
    searchExpenses,
  };

  const props: UseLineIntentOptions = {
    session: SESSION,
    activeGroupId: LEDGER,
    activeGroup: GROUP,
    expenses: [expense("expense_1")],
    detailLoaded: true,
    openGroup: spies.openGroup,
    setDialog: spies.setDialog,
    openExpenseEdit: spies.openExpenseEdit,
    showToast: spies.showToast,
    api: { resolveLineEntry, searchExpenses } as unknown as UseLineIntentOptions["api"],
    ...initial,
  };

  const hook = renderHook((p: UseLineIntentOptions) => useLineIntent(p), { initialProps: props });
  const update = (patch: Partial<UseLineIntentOptions>) => hook.rerender({ ...props, ...patch });

  return { ...spies, hook, update };
}

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("useLineIntent - views", () => {
  test("?view=records opens the records sheet and leaves the address bar clean", () => {
    const { setDialog, resolveLineEntry } = setup(`/group/${LEDGER}?view=records&openExternalBrowser=1`);

    expect(setDialog).toHaveBeenCalledTimes(1);
    expect(setDialog).toHaveBeenCalledWith("recordsPanel");
    expect(resolveLineEntry).not.toHaveBeenCalled();
    expect(window.location.pathname).toBe(`/group/${LEDGER}`);
    expect(window.location.search).toBe("?openExternalBrowser=1");
  });

  test("?view=analysis opens the analysis sheet", () => {
    const { setDialog } = setup(`/group/${LEDGER}?view=analysis`);

    expect(setDialog).toHaveBeenCalledTimes(1);
    expect(setDialog).toHaveBeenCalledWith("analysisPanel");
  });

  test("waits for a session and an open group, then acts exactly once", () => {
    const { setDialog, update } = setup(`/group/${LEDGER}?view=records`, { session: null, activeGroup: null });
    expect(setDialog).not.toHaveBeenCalled();
    // Not consumed while it cannot be acted on: the login redirect still needs to see it.
    expect(window.location.search).toBe("?view=records");

    update({ session: SESSION, activeGroup: null });
    expect(setDialog).not.toHaveBeenCalled();

    update({ session: SESSION, activeGroup: GROUP });
    expect(setDialog).toHaveBeenCalledTimes(1);

    update({ session: { ...SESSION }, activeGroup: { ...GROUP } });
    update({ session: SESSION, activeGroup: GROUP, expenses: [] });
    expect(setDialog).toHaveBeenCalledTimes(1);
  });

  test("a group on screen is not enough: signed out, the sheet stays shut and the link stays in the address bar", () => {
    const { setDialog } = setup(`/group/${LEDGER}?view=records`, { session: null });

    expect(setDialog).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?view=records");
  });

  test("does nothing with an intent it does not implement", () => {
    const { setDialog, resolveLineEntry } = setup(`/group/${LEDGER}?view=members&entry=short`);

    expect(setDialog).not.toHaveBeenCalled();
    expect(resolveLineEntry).not.toHaveBeenCalled();
  });

  test("a remount after the address bar was cleaned does not replay it", () => {
    const first = setup(`/group/${LEDGER}?view=records`);
    expect(first.setDialog).toHaveBeenCalledTimes(1);
    first.hook.unmount();

    const { setDialog } = setup(window.location.pathname + window.location.search);
    expect(setDialog).not.toHaveBeenCalled();
  });
});

describe("useLineIntent - entry", () => {
  test("opens the edit composer for a live entry in the loaded window, once", async () => {
    const { resolveLineEntry, openExpenseEdit, searchExpenses, showToast, update } = setup(
      `/group/${LEDGER}?${ENTRY_QUERY}&openExternalBrowser=1`,
    );

    await waitFor(() => expect(openExpenseEdit).toHaveBeenCalledTimes(1));
    expect(openExpenseEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "expense_1" }));
    expect(resolveLineEntry).toHaveBeenCalledTimes(1);
    expect(resolveLineEntry).toHaveBeenCalledWith(KEY);
    expect(searchExpenses).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?openExternalBrowser=1");

    update({ expenses: [expense("expense_1"), expense("expense_2")] });
    update({ session: { ...SESSION } });
    expect(openExpenseEdit).toHaveBeenCalledTimes(1);
    expect(resolveLineEntry).toHaveBeenCalledTimes(1);
  });

  test("does not look anything up while signed out, and leaves the parameters for the login redirect", () => {
    const { resolveLineEntry, update } = setup(`/group/${LEDGER}?${ENTRY_QUERY}`, { session: null });

    expect(resolveLineEntry).not.toHaveBeenCalled();
    expect(window.location.search).toContain("entry=");

    update({ session: SESSION });
    expect(resolveLineEntry).toHaveBeenCalledTimes(1);
  });

  test("an entry older than the loaded window is fetched by its own day", async () => {
    const { openExpenseEdit, searchExpenses } = setup(`/group/${LEDGER}?${ENTRY_QUERY}`, {
      expenses: [expense("expense_9")],
      resolution: live({ expense_id: "expense_1", expense_date: "2025-03-04" }),
    });

    await waitFor(() => expect(openExpenseEdit).toHaveBeenCalledTimes(1));
    expect(searchExpenses).toHaveBeenCalledTimes(1);
    expect(searchExpenses).toHaveBeenCalledWith(LEDGER, { from: "2025-03-04", to: "2025-03-04", limit: 100 });
    expect(openExpenseEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "expense_1", title: "早餐" }));
  });

  test("a search that does not contain the entry, or fails, says so instead of opening something else", async () => {
    for (const searchResult of [{ expenses: [summary("expense_other")] }, new Error("offline")]) {
      const { openExpenseEdit, showToast } = setup(`/group/${LEDGER}?${ENTRY_QUERY}`, {
        expenses: [],
        searchResult,
      });

      await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
      expect(showToast).toHaveBeenCalledWith(text.lineEntryFailed);
      expect(openExpenseEdit).not.toHaveBeenCalled();
    }
  });

  test("an entry in another ledger switches to it first (once) and opens only when its detail has loaded", async () => {
    const otherGroup: Group = { ...GROUP, id: "other_group", kind: "shared" };
    const { openGroup, openExpenseEdit, update } = setup(`/group/other_group?${ENTRY_QUERY}`, {
      activeGroupId: "other_group",
      activeGroup: otherGroup,
      expenses: [],
    });

    await waitFor(() => expect(openGroup).toHaveBeenCalledTimes(1));
    expect(openGroup).toHaveBeenCalledWith(LEDGER, "replace");
    expect(openExpenseEdit).not.toHaveBeenCalled();

    // Still the old group, still waiting - and not asking again.
    update({ activeGroupId: "other_group", activeGroup: otherGroup, expenses: [] });
    expect(openGroup).toHaveBeenCalledTimes(1);

    // The ledger is now active but its detail has not arrived: do not open on an empty list.
    update({ activeGroupId: LEDGER, activeGroup: GROUP, detailLoaded: false, expenses: [] });
    expect(openExpenseEdit).not.toHaveBeenCalled();

    update({ activeGroupId: LEDGER, activeGroup: GROUP, detailLoaded: true, expenses: [expense("expense_1")] });
    expect(openExpenseEdit).toHaveBeenCalledTimes(1);
    expect(openExpenseEdit).toHaveBeenCalledWith(expect.objectContaining({ id: "expense_1" }));
    expect(openGroup).toHaveBeenCalledTimes(1);
  });

  test("waits for the open group's detail before looking for the row", async () => {
    const { openExpenseEdit, searchExpenses, resolveLineEntry, update } = setup(`/group/${LEDGER}?${ENTRY_QUERY}`, {
      detailLoaded: false,
      expenses: [],
    });

    await waitFor(() => expect(resolveLineEntry).toHaveBeenCalledTimes(1));
    expect(openExpenseEdit).not.toHaveBeenCalled();
    expect(searchExpenses).not.toHaveBeenCalled();

    update({ detailLoaded: true, expenses: [expense("expense_1")] });
    expect(openExpenseEdit).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["gone", { status: "gone" } as LineEntryResolution, text.lineEntryGone],
    ["not_found", { status: "not_found" } as LineEntryResolution, text.lineEntryNotFound],
    ["a failed lookup", new Error("503"), text.lineEntryFailed],
  ])("%s shows its own toast and opens nothing", async (_name, resolution, message) => {
    const { showToast, openExpenseEdit, openGroup } = setup(`/group/${LEDGER}?${ENTRY_QUERY}`, { resolution });

    await waitFor(() => expect(showToast).toHaveBeenCalledTimes(1));
    expect(showToast).toHaveBeenCalledWith(message);
    expect(openExpenseEdit).not.toHaveBeenCalled();
    expect(openGroup).not.toHaveBeenCalled();
    expect(window.location.search).toBe("");
  });

  test("the toast copy, in both languages", () => {
    expect([ZH_HANT.app.lineEntryGone, ZH_HANT.app.lineEntryNotFound, ZH_HANT.app.lineEntryFailed]).toEqual([
      "這筆記錄已經刪除了",
      "找不到這筆記錄，請確認登入的是連結 LINE 的 Equo 帳號",
      "暫時打不開這筆記錄，請稍後再試",
    ]);
    expect([EN.app.lineEntryGone, EN.app.lineEntryNotFound, EN.app.lineEntryFailed]).toEqual([
      "That entry has been deleted",
      "Couldn't find that entry — check you're signed in with the Equo account linked to LINE",
      "Couldn't open that entry right now — try again later",
    ]);
  });
});

describe("useLineIntent - across the login redirect", () => {
  test("picks the stashed intent up when the URL has none (the bare origin after OAuth)", async () => {
    stashLineIntent({ kind: "entry", entryKey: KEY });
    const { resolveLineEntry, openExpenseEdit } = setup(`/group/${LEDGER}`);

    await waitFor(() => expect(openExpenseEdit).toHaveBeenCalledTimes(1));
    expect(resolveLineEntry).toHaveBeenCalledWith(KEY);
  });

  test("picks up a stashed view, and consumes the stash", () => {
    stashLineIntent({ kind: "analysis" });
    const first = setup(`/group/${LEDGER}`);
    expect(first.setDialog).toHaveBeenCalledWith("analysisPanel");
    first.hook.unmount();

    const second = setup(`/group/${LEDGER}`);
    expect(second.setDialog).not.toHaveBeenCalled();
  });

  test("the URL wins over a stash, and the stash does not outlive the start", () => {
    stashLineIntent({ kind: "analysis" });
    const first = setup(`/group/${LEDGER}?view=records`);
    expect(first.setDialog).toHaveBeenCalledTimes(1);
    expect(first.setDialog).toHaveBeenCalledWith("recordsPanel");
    first.hook.unmount();

    const second = setup(`/group/${LEDGER}`);
    expect(second.setDialog).not.toHaveBeenCalled();
  });

  test("an expired stash is ignored", () => {
    stashLineIntent({ kind: "records" }, Date.now() - 16 * 60 * 1000);
    const { setDialog } = setup(`/group/${LEDGER}`);

    expect(setDialog).not.toHaveBeenCalled();
  });
});
