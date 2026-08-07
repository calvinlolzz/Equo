// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { SpendBreakdown } from "./apiClient";
import { useSpendBreakdown } from "./useSpendBreakdown";

function makeBreakdown(overrides: Partial<SpendBreakdown> = {}): SpendBreakdown {
  return {
    period_kind: "year",
    period_key: "2026",
    currency: "TWD",
    periods: [
      { key: "2026", total_minor: 725000 },
      { key: "2025", total_minor: 410000 },
    ],
    group_total_minor: 725000,
    personal_total_minor: 300000,
    by_category: [{ category: "general", group_total_minor: 725000, personal_total_minor: 300000 }],
    ...overrides,
  };
}

function setup(fetchSpendBreakdown: ReturnType<typeof vi.fn>, enabled = true, groupId: string | null = "group_1") {
  return renderHook((props: { enabled: boolean; groupId: string | null } = { enabled, groupId }) =>
    useSpendBreakdown({
      fetchSpendBreakdown,
      groupId: props.groupId,
      enabled: props.enabled,
      describeError: (error) => `失敗：${(error as Error).message}`,
    }),
  );
}

describe("useSpendBreakdown", () => {
  test("fetches the newest period on open and reports what the server resolved to", async () => {
    const fetchSpendBreakdown = vi.fn(async () => makeBreakdown());

    const { result } = setup(fetchSpendBreakdown);

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(fetchSpendBreakdown).toHaveBeenCalledWith("group_1", { kind: "year", key: undefined });
    expect(result.current.periodKey).toBe("2026");
    expect(result.current.breakdown?.group_total_minor).toBe(725000);
  });

  test("selecting a period refetches with that key", async () => {
    const fetchSpendBreakdown = vi.fn(async (_id: string, options: { key?: string }) =>
      makeBreakdown({ period_key: options.key ?? "2026", group_total_minor: options.key === "2025" ? 410000 : 725000 }),
    );

    const { result } = setup(fetchSpendBreakdown);
    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => result.current.selectPeriodKey("2025"));

    await waitFor(() => expect(result.current.breakdown?.group_total_minor).toBe(410000));
    expect(fetchSpendBreakdown).toHaveBeenLastCalledWith("group_1", { kind: "year", key: "2025" });
  });

  test("switching bucketing drops the selected key - a year key is meaningless in month mode", async () => {
    const fetchSpendBreakdown = vi.fn(async () => makeBreakdown());

    const { result } = setup(fetchSpendBreakdown);
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => result.current.selectPeriodKey("2024"));
    await waitFor(() => expect(fetchSpendBreakdown).toHaveBeenCalledTimes(2));

    act(() => result.current.selectPeriodKind("month"));

    await waitFor(() => expect(fetchSpendBreakdown).toHaveBeenCalledTimes(3));
    expect(fetchSpendBreakdown).toHaveBeenLastCalledWith("group_1", { kind: "month", key: undefined });
    expect(result.current.periodKind).toBe("month");
  });

  test("a slow earlier response never lands on top of a newer one", async () => {
    const resolvers: Array<(value: SpendBreakdown) => void> = [];
    const fetchSpendBreakdown = vi.fn(
      () => new Promise<SpendBreakdown>((resolve) => resolvers.push(resolve)),
    );

    const { result } = setup(fetchSpendBreakdown);
    await waitFor(() => expect(resolvers).toHaveLength(1));

    act(() => result.current.selectPeriodKey("2025"));
    await waitFor(() => expect(resolvers).toHaveLength(2));

    // Second request answers first, then the stale first one arrives.
    await act(async () => {
      resolvers[1](makeBreakdown({ period_key: "2025", group_total_minor: 410000 }));
    });
    await act(async () => {
      resolvers[0](makeBreakdown({ period_key: "2026", group_total_minor: 725000 }));
    });

    expect(result.current.breakdown?.period_key).toBe("2025");
    expect(result.current.breakdown?.group_total_minor).toBe(410000);
    expect(result.current.loading).toBe(false);
  });

  test("a failure surfaces a described error and retry refetches", async () => {
    const fetchSpendBreakdown = vi
      .fn<() => Promise<SpendBreakdown>>()
      .mockRejectedValueOnce(new Error("斷線"))
      .mockResolvedValue(makeBreakdown());

    const { result } = setup(fetchSpendBreakdown);

    await waitFor(() => expect(result.current.error).toBe("失敗：斷線"));
    expect(result.current.loading).toBe(false);

    act(() => result.current.retry());

    await waitFor(() => expect(result.current.breakdown).not.toBeNull());
    expect(result.current.error).toBeNull();
  });

  test("nothing is fetched while the panel is closed, and closing drops the data", async () => {
    const fetchSpendBreakdown = vi.fn(async () => makeBreakdown());

    const { result, rerender } = setup(fetchSpendBreakdown, false);
    rerender({ enabled: false, groupId: "group_1" });
    expect(fetchSpendBreakdown).not.toHaveBeenCalled();

    rerender({ enabled: true, groupId: "group_1" });
    await waitFor(() => expect(result.current.breakdown).not.toBeNull());

    rerender({ enabled: false, groupId: "group_1" });
    expect(result.current.breakdown).toBeNull();
    expect(result.current.periodKey).toBeNull();
  });

  test("no group means no request", () => {
    const fetchSpendBreakdown = vi.fn(async () => makeBreakdown());

    setup(fetchSpendBreakdown, true, null);

    expect(fetchSpendBreakdown).not.toHaveBeenCalled();
  });
});
