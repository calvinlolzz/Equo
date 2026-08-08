// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { RecurringExpense } from "./apiClient";
import { useRecurringExpenses } from "./useRecurringExpenses";

function rule(overrides: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    id: "rec_1",
    group_id: "group_1",
    title: "房租",
    amount_minor: 1500000,
    currency: "TWD",
    category: "lodging",
    note: null,
    payer_member_id: "member_a",
    share_member_ids: ["member_a", "member_b"],
    day_of_month: 5,
    next_run_date: "2026-09-05",
    active: true,
    last_error: null,
    last_run_at: null,
    ...overrides,
  };
}

function setup(store: {
  listRecurring: ReturnType<typeof vi.fn>;
  upsertRecurring?: ReturnType<typeof vi.fn>;
  deleteRecurring?: ReturnType<typeof vi.fn>;
}, enabled = true) {
  const showToast = vi.fn();
  const full = {
    listRecurring: store.listRecurring,
    upsertRecurring: store.upsertRecurring ?? vi.fn(async () => rule()),
    deleteRecurring: store.deleteRecurring ?? vi.fn(async () => {}),
  };
  const view = renderHook((props: { enabled: boolean } = { enabled }) =>
    useRecurringExpenses({
      store: full,
      groupId: "group_1",
      enabled: props.enabled,
      showToast,
      describeError: (error) => `失敗：${(error as Error).message}`,
    }),
  );
  return { ...view, showToast, store: full };
}

describe("useRecurringExpenses", () => {
  test("loads the rules when the panel opens", async () => {
    const listRecurring = vi.fn(async () => [rule()]);

    const { result } = setup({ listRecurring });

    await waitFor(() => expect(result.current.rules).toHaveLength(1));
    expect(listRecurring).toHaveBeenCalledWith("group_1");
  });

  test("nothing is fetched while the panel is closed", () => {
    const listRecurring = vi.fn(async () => [rule()]);

    setup({ listRecurring }, false);

    expect(listRecurring).not.toHaveBeenCalled();
  });

  test("saving re-reads the list — the server owns next_run_date", async () => {
    const listRecurring = vi
      .fn<() => Promise<RecurringExpense[]>>()
      .mockResolvedValueOnce([rule({ day_of_month: 5, next_run_date: "2026-09-05" })])
      // The day changed, so the server rescheduled; a local patch would have
      // kept showing 09-05.
      .mockResolvedValue([rule({ day_of_month: 12, next_run_date: "2026-08-12" })]);
    const upsertRecurring = vi.fn(async () => rule({ day_of_month: 12 }));

    const { result, showToast } = setup({ listRecurring, upsertRecurring });
    await waitFor(() => expect(result.current.rules).toHaveLength(1));

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.save({
        id: "rec_1",
        title: "房租",
        amount_minor: 1500000,
        payer_member_id: "member_a",
        share_member_ids: ["member_a"],
        day_of_month: 12,
      });
    });

    expect(saved).toBe(true);
    expect(result.current.rules[0].next_run_date).toBe("2026-08-12");
    expect(showToast).toHaveBeenCalledWith("已更新循環支出");
  });

  test("a failed save keeps the form open and says why", async () => {
    const listRecurring = vi.fn(async () => [rule()]);
    const upsertRecurring = vi.fn(async () => {
      throw new Error("斷線");
    });

    const { result, showToast } = setup({ listRecurring, upsertRecurring });
    await waitFor(() => expect(result.current.rules).toHaveLength(1));

    let saved: boolean | undefined;
    await act(async () => {
      saved = await result.current.save({
        title: "水費",
        amount_minor: 1000,
        payer_member_id: "member_a",
        share_member_ids: ["member_a"],
        day_of_month: 3,
      });
    });

    // false is what tells the panel not to close the draft.
    expect(saved).toBe(false);
    expect(showToast).toHaveBeenCalledWith("失敗：斷線");
    expect(result.current.savingId).toBeNull();
  });

  test("deleting drops the row without a second round trip", async () => {
    const listRecurring = vi.fn(async () => [rule(), rule({ id: "rec_2", title: "水費" })]);
    const deleteRecurring = vi.fn(async () => {});

    const { result } = setup({ listRecurring, deleteRecurring });
    await waitFor(() => expect(result.current.rules).toHaveLength(2));

    await act(async () => {
      await result.current.remove("rec_1");
    });

    expect(result.current.rules.map((row) => row.id)).toEqual(["rec_2"]);
    expect(listRecurring).toHaveBeenCalledTimes(1);
  });

  test("a failed delete keeps the row on screen", async () => {
    const listRecurring = vi.fn(async () => [rule()]);
    const deleteRecurring = vi.fn(async () => {
      throw new Error("斷線");
    });

    const { result, showToast } = setup({ listRecurring, deleteRecurring });
    await waitFor(() => expect(result.current.rules).toHaveLength(1));

    await act(async () => {
      await result.current.remove("rec_1");
    });

    expect(result.current.rules).toHaveLength(1);
    expect(showToast).toHaveBeenCalledWith("失敗：斷線");
  });

  test("a load failure is described and retryable", async () => {
    const listRecurring = vi
      .fn<() => Promise<RecurringExpense[]>>()
      .mockRejectedValueOnce(new Error("斷線"))
      .mockResolvedValue([rule()]);

    const { result } = setup({ listRecurring });

    await waitFor(() => expect(result.current.error).toBe("失敗：斷線"));

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.rules).toHaveLength(1));
    expect(result.current.error).toBeNull();
  });

  test("closing the panel drops the rules", async () => {
    const listRecurring = vi.fn(async () => [rule()]);

    const { result, rerender } = setup({ listRecurring });
    await waitFor(() => expect(result.current.rules).toHaveLength(1));

    rerender({ enabled: false });

    expect(result.current.rules).toHaveLength(0);
  });
});
