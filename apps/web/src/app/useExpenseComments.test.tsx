// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { useExpenseComments, type ExpenseCommentsApi } from "./useExpenseComments";

function comment(id: string, body: string) {
  return {
    id,
    expense_id: "expense_1",
    member_id: "member_a",
    body,
    created_at: "2026-08-26T02:00:00.000Z",
  };
}

function makeApi(overrides: Partial<ExpenseCommentsApi> = {}): ExpenseCommentsApi {
  return {
    listExpenseComments: vi.fn(async () => [comment("c1", "這筆我請")]),
    addExpenseComment: vi.fn(async (_g: string, _e: string, body: string) => comment("c2", body)),
    removeExpenseComment: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("useExpenseComments", () => {
  test("loads the thread for the open expense", async () => {
    const api = makeApi();
    const { result } = renderHook(() => useExpenseComments(api, "group_1", "expense_1"));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items.map((item) => item.body)).toEqual(["這筆我請"]);
    expect(api.listExpenseComments).toHaveBeenCalledWith("group_1", "expense_1");
  });

  test("fetches nothing when no expense is open", () => {
    const api = makeApi();
    renderHook(() => useExpenseComments(api, "group_1", null));
    expect(api.listExpenseComments).not.toHaveBeenCalled();
  });

  test("clears the previous thread immediately when the expense changes", async () => {
    // Swiping to a neighbour changes expenseId without remounting. Leaving the
    // old comments on screen under the new entry's title is a lie about who
    // said what, and about which expense.
    let resolveSecond: ((value: ReturnType<typeof comment>[]) => void) | null = null;
    const listExpenseComments = vi
      .fn()
      .mockResolvedValueOnce([comment("c1", "第一筆的留言")])
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );

    const api = makeApi({ listExpenseComments });
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useExpenseComments(api, "group_1", id),
      { initialProps: { id: "expense_1" } },
    );

    await waitFor(() => expect(result.current.items).toHaveLength(1));

    rerender({ id: "expense_2" });
    expect(result.current.items).toEqual([]);

    await act(async () => {
      resolveSecond?.([comment("c9", "第二筆的留言")]);
    });
    await waitFor(() => expect(result.current.items.map((i) => i.body)).toEqual(["第二筆的留言"]));
  });

  test("a fetch that lands after the expense changed is discarded", async () => {
    // Otherwise the slow response for the entry you swiped away from overwrites
    // the one you are now looking at.
    let resolveFirst: ((value: ReturnType<typeof comment>[]) => void) | null = null;
    const listExpenseComments = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
          }),
      )
      .mockResolvedValueOnce([comment("c9", "第二筆的留言")]);

    const api = makeApi({ listExpenseComments });
    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useExpenseComments(api, "group_1", id),
      { initialProps: { id: "expense_1" } },
    );

    rerender({ id: "expense_2" });
    await waitFor(() => expect(result.current.items.map((i) => i.body)).toEqual(["第二筆的留言"]));

    await act(async () => {
      resolveFirst?.([comment("c1", "第一筆的留言")]);
    });

    expect(result.current.items.map((i) => i.body)).toEqual(["第二筆的留言"]);
  });

  test("a failed load surfaces a message instead of an empty thread", async () => {
    const api = makeApi({
      listExpenseComments: vi.fn(async () => {
        throw new Error("NETWORK_ERROR");
      }),
    });
    const { result } = renderHook(() => useExpenseComments(api, "group_1", "expense_1"));

    await waitFor(() => expect(result.current.error).toBeTruthy());
    expect(result.current.loading).toBe(false);
  });

  test("appends the comment the server returned, not one built locally", async () => {
    // The id and the timestamp are the server's. A locally built row that then
    // jumps as the real one lands reads as the app having sent it twice.
    const api = makeApi();
    const { result } = renderHook(() => useExpenseComments(api, "group_1", "expense_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.submit("  我付的  ");
    });

    expect(api.addExpenseComment).toHaveBeenCalledWith("group_1", "expense_1", "我付的");
    expect(result.current.items.map((item) => item.id)).toEqual(["c1", "c2"]);
  });

  test("refuses to send an empty or whitespace-only comment", async () => {
    const api = makeApi();
    const { result } = renderHook(() => useExpenseComments(api, "group_1", "expense_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.submit("   \n ");
    });

    expect(api.addExpenseComment).not.toHaveBeenCalled();
  });

  test("refuses to send a comment over the length cap", async () => {
    const api = makeApi();
    const { result } = renderHook(() => useExpenseComments(api, "group_1", "expense_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.submit("字".repeat(501));
    });

    expect(api.addExpenseComment).not.toHaveBeenCalled();
  });

  test("a failed send reports it and leaves the thread as it was", async () => {
    const api = makeApi({
      addExpenseComment: vi.fn(async () => {
        throw new Error("NETWORK_ERROR");
      }),
    });
    const { result } = renderHook(() => useExpenseComments(api, "group_1", "expense_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.submit("我付的");
    });

    expect(result.current.error).toBeTruthy();
    expect(result.current.items.map((item) => item.id)).toEqual(["c1"]);
  });

  test("removes the line straight away, because the tap must feel like it landed", async () => {
    const api = makeApi();
    const { result } = renderHook(() => useExpenseComments(api, "group_1", "expense_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.remove("c1");
    });

    expect(api.removeExpenseComment).toHaveBeenCalledWith("group_1", "expense_1", "c1");
    expect(result.current.items).toEqual([]);
  });

  test("a failed withdrawal puts the comment back", async () => {
    const api = makeApi({
      removeExpenseComment: vi.fn(async () => {
        throw new Error("NETWORK_ERROR");
      }),
    });
    const { result } = renderHook(() => useExpenseComments(api, "group_1", "expense_1"));
    await waitFor(() => expect(result.current.loading).toBe(false));

    await act(async () => {
      await result.current.remove("c1");
    });

    expect(result.current.items.map((item) => item.id)).toEqual(["c1"]);
    expect(result.current.error).toBeTruthy();
  });
});
