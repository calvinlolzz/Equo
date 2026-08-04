import { describe, expect, it } from "vitest";
import type { Expense } from "./appTypes";
import { groupExpensesByDay, takeDayGroupsWithin } from "./expenseDayGroups";

function expense(overrides: Partial<Expense> & { id: string; createdAt: string }): Expense {
  return {
    title: "x",
    amountMinor: 1000,
    currency: "TWD",
    payerId: "m1",
    shareMemberIds: ["m1"],
    ...overrides,
  };
}

describe("groupExpensesByDay", () => {
  it("buckets by local day preserving newest-first order", () => {
    const groups = groupExpensesByDay([
      expense({ id: "a", createdAt: "2026-07-13T20:00:00+08:00" }),
      expense({ id: "b", createdAt: "2026-07-13T09:00:00+08:00" }),
      expense({ id: "c", createdAt: "2026-07-12T10:00:00+08:00" }),
    ]);
    expect(groups.map((g) => g.key)).toEqual(["2026-07-13", "2026-07-12"]);
    expect(groups[0].expenses.map((e) => e.id)).toEqual(["a", "b"]);
    expect(groups[1].expenses.map((e) => e.id)).toEqual(["c"]);
  });

  it("sums the day subtotal from outflow only (income excluded)", () => {
    const groups = groupExpensesByDay([
      expense({ id: "a", createdAt: "2026-07-13T20:00:00+08:00", amountMinor: 96000 }),
      expense({ id: "b", createdAt: "2026-07-13T09:00:00+08:00", amountMinor: 5000, kind: "income" }),
      expense({ id: "c", createdAt: "2026-07-13T08:00:00+08:00", amountMinor: 4000, kind: "settlement" }),
    ]);
    expect(groups).toHaveLength(1);
    // 96000 (expense) + 4000 (settlement), income 5000 not counted
    expect(groups[0].subtotalMinor).toBe(100000);
    expect(groups[0].expenses).toHaveLength(3);
  });

  it("returns an empty array for no expenses", () => {
    expect(groupExpensesByDay([])).toEqual([]);
  });
});

describe("takeDayGroupsWithin", () => {
  /** A day group of `count` rows, so only the windowing maths is under test. */
  function day(key: string, count: number) {
    return {
      key,
      subtotalMinor: count * 1000,
      expenses: Array.from({ length: count }, (_, i) => expense({ id: `${key}-${i}`, createdAt: `${key}T09:00:00+08:00` })),
    };
  }

  it("stops at the first day that reaches the limit", () => {
    const groups = [day("2026-07-13", 3), day("2026-07-12", 3), day("2026-07-11", 3)];
    expect(takeDayGroupsWithin(groups, 5).map((g) => g.key)).toEqual(["2026-07-13", "2026-07-12"]);
  });

  it("keeps the tail day whole even when that overshoots the limit", () => {
    const groups = [day("2026-07-13", 2), day("2026-07-12", 9)];
    const taken = takeDayGroupsWithin(groups, 3);
    expect(taken).toHaveLength(2);
    // The 9-row day is not cut down to 1 - its header subtotal covers all 9.
    expect(taken[1].expenses).toHaveLength(9);
    expect(taken[1].subtotalMinor).toBe(9000);
  });

  it("takes everything when the limit exceeds the total row count", () => {
    const groups = [day("2026-07-13", 2), day("2026-07-12", 2)];
    expect(takeDayGroupsWithin(groups, 40)).toHaveLength(2);
    expect(takeDayGroupsWithin(groups, Number.POSITIVE_INFINITY)).toHaveLength(2);
  });

  it("takes at least one day for any positive limit, and nothing for zero", () => {
    const groups = [day("2026-07-13", 4)];
    expect(takeDayGroupsWithin(groups, 1)).toHaveLength(1);
    expect(takeDayGroupsWithin(groups, 0)).toEqual([]);
    expect(takeDayGroupsWithin([], 40)).toEqual([]);
  });
});
