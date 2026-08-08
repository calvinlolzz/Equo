// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Expense } from "./appTypes";
import { EMPTY_EXPENSE_FILTER, type ExpenseFilter } from "./expenseFilter";
import { useExpenseSearch, type ExpenseSearchPage } from "./useExpenseSearch";

function expense(id: string, createdAt = "2026-07-04T10:00:00.000Z"): Expense {
  return {
    id,
    title: id,
    amountMinor: 10000,
    currency: "TWD",
    createdAt,
    expenseDate: createdAt.slice(0, 10),
    payerId: "m1",
    shareMemberIds: ["m1"],
  };
}

function page(overrides: Partial<ExpenseSearchPage> = {}): ExpenseSearchPage {
  return { expenses: [expense("a")], matchCount: 1, matchTotalMinor: 10000, hasMore: false, ...overrides };
}

function setup(searchExpenses: ReturnType<typeof vi.fn>, filter: ExpenseFilter) {
  return renderHook((props: { filter: ExpenseFilter } = { filter }) =>
    useExpenseSearch({
      searchExpenses,
      filter: props.filter,
      enabled: true,
      describeError: (error) => `失敗：${(error as Error).message}`,
    }),
  );
}

const withQuery = (query: string): ExpenseFilter => ({ ...EMPTY_EXPENSE_FILTER, query });

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useExpenseSearch", () => {
  test("stays dormant with an empty filter - the in-memory list is authoritative there", () => {
    const searchExpenses = vi.fn(async () => page());

    const { result } = setup(searchExpenses, EMPTY_EXPENSE_FILTER);

    act(() => void vi.advanceTimersByTime(1000));
    expect(searchExpenses).not.toHaveBeenCalled();
    expect(result.current.active).toBe(false);
  });

  test("debounces typing into a single request", async () => {
    const searchExpenses = vi.fn(async () => page());

    const { result, rerender } = setup(searchExpenses, withQuery("拉"));
    rerender({ filter: withQuery("拉麵") });
    rerender({ filter: withQuery("拉麵店") });

    act(() => void vi.advanceTimersByTime(299));
    expect(searchExpenses).not.toHaveBeenCalled();

    act(() => void vi.advanceTimersByTime(1));
    await waitFor(() => expect(result.current.pending).toBe(false));
    expect(searchExpenses).toHaveBeenCalledTimes(1);
    expect(searchExpenses).toHaveBeenCalledWith(expect.objectContaining({ q: "拉麵店" }));
  });

  test("sends every filter field, dropping the ones set to 'all'", async () => {
    const searchExpenses = vi.fn(async () => page());
    const filter: ExpenseFilter = {
      query: " 拉麵 ",
      memberId: "m2",
      category: "food",
      kind: "expense",
      from: "2026-01-01",
      to: "",
    };

    const { result } = setup(searchExpenses, filter);
    act(() => void vi.advanceTimersByTime(300));
    await waitFor(() => expect(result.current.pending).toBe(false));

    expect(searchExpenses).toHaveBeenCalledWith({
      q: "拉麵",
      memberId: "m2",
      category: "food",
      kind: "expense",
      from: "2026-01-01",
      to: undefined,
      limit: 50,
    });
  });

  test("reports the server's match count, not the returned page length", async () => {
    const searchExpenses = vi.fn(async () => page({ matchCount: 40, matchTotalMinor: 400000, hasMore: true }));

    const { result } = setup(searchExpenses, withQuery("拉麵"));
    act(() => void vi.advanceTimersByTime(300));

    await waitFor(() => expect(result.current.matchCount).toBe(40));
    expect(result.current.expenses).toHaveLength(1);
    expect(result.current.matchTotalMinor).toBe(400000);
    expect(result.current.hasMore).toBe(true);
  });

  test("loadMore appends the next page and drops ids already on screen", async () => {
    const searchExpenses = vi
      .fn<(search: { beforeDate?: string }) => Promise<ExpenseSearchPage>>()
      .mockResolvedValueOnce(page({ expenses: [expense("a"), expense("b")], matchCount: 3, hasMore: true }))
      // "b" repeats: a same-second boundary row can legitimately come back twice.
      .mockResolvedValueOnce(page({ expenses: [expense("b"), expense("c")], matchCount: 3, hasMore: false }));

    const { result } = setup(searchExpenses, withQuery("拉麵"));
    act(() => void vi.advanceTimersByTime(300));
    await waitFor(() => expect(result.current.expenses).toHaveLength(2));

    await act(async () => {
      await result.current.loadMore();
    });

    expect(result.current.expenses.map((row) => row.id)).toEqual(["a", "b", "c"]);
    expect(result.current.hasMore).toBe(false);
    // Paged from the oldest row on screen.
    expect(searchExpenses).toHaveBeenLastCalledWith(expect.objectContaining({ beforeDate: "2026-07-04" }));
  });

  test("a stale response never overwrites a newer one", async () => {
    const resolvers: Array<(value: ExpenseSearchPage) => void> = [];
    const searchExpenses = vi.fn(() => new Promise<ExpenseSearchPage>((resolve) => resolvers.push(resolve)));

    const { result, rerender } = setup(searchExpenses, withQuery("拉麵"));
    act(() => void vi.advanceTimersByTime(300));
    await waitFor(() => expect(resolvers).toHaveLength(1));

    rerender({ filter: withQuery("計程車") });
    act(() => void vi.advanceTimersByTime(300));
    await waitFor(() => expect(resolvers).toHaveLength(2));

    await act(async () => {
      resolvers[1](page({ expenses: [expense("taxi")], matchCount: 1 }));
    });
    await act(async () => {
      resolvers[0](page({ expenses: [expense("ramen")], matchCount: 99 }));
    });

    expect(result.current.expenses.map((row) => row.id)).toEqual(["taxi"]);
    expect(result.current.matchCount).toBe(1);
  });

  test("clearing the filter drops the results so the next search cannot flash them", async () => {
    const searchExpenses = vi.fn(async () => page());

    const { result, rerender } = setup(searchExpenses, withQuery("拉麵"));
    act(() => void vi.advanceTimersByTime(300));
    await waitFor(() => expect(result.current.expenses).toHaveLength(1));

    rerender({ filter: EMPTY_EXPENSE_FILTER });

    expect(result.current.expenses).toHaveLength(0);
    expect(result.current.matchCount).toBe(0);
    expect(result.current.active).toBe(false);
  });

  test("a failure is described and retryable", async () => {
    const searchExpenses = vi
      .fn<() => Promise<ExpenseSearchPage>>()
      .mockRejectedValueOnce(new Error("斷線"))
      .mockResolvedValue(page());

    const { result } = setup(searchExpenses, withQuery("拉麵"));
    act(() => void vi.advanceTimersByTime(300));

    await waitFor(() => expect(result.current.error).toBe("失敗：斷線"));
    // Not "still waiting" - the panel must be free to fall back to local rows.
    expect(result.current.pending).toBe(false);

    act(() => result.current.retry());
    act(() => void vi.advanceTimersByTime(300));

    await waitFor(() => expect(result.current.expenses).toHaveLength(1));
    expect(result.current.error).toBeNull();
  });
});
