import { describe, expect, test } from "vitest";
import type { Expense } from "./appTypes";
import {
  buildEqualShareAmountsMinor,
  getCustomSplitRemainderMinor,
  getMemberShareMinor,
  isCustomSplitValid,
  sumShareAmountsMinor,
} from "./expenseShareSplit";

describe("buildEqualShareAmountsMinor", () => {
  test("distributes the remainder to the earliest members", () => {
    expect(buildEqualShareAmountsMinor(["a", "b", "c"], 1000)).toEqual({ a: 334, b: 333, c: 333 });
  });

  test("returns an empty map with no members", () => {
    expect(buildEqualShareAmountsMinor([], 1000)).toEqual({});
  });
});

describe("sumShareAmountsMinor / getCustomSplitRemainderMinor", () => {
  test("sums the recorded shares", () => {
    expect(sumShareAmountsMinor({ a: 300, b: 200 })).toBe(500);
  });

  test("computes the leftover amount versus the total", () => {
    expect(getCustomSplitRemainderMinor({ totalAmountMinor: 1000, shareAmountsMinor: { a: 300, b: 200 } })).toBe(500);
    expect(getCustomSplitRemainderMinor({ totalAmountMinor: 500, shareAmountsMinor: { a: 300, b: 200 } })).toBe(0);
  });
});

describe("isCustomSplitValid", () => {
  test("requires the shares to sum exactly to the total", () => {
    expect(isCustomSplitValid({ totalAmountMinor: 500, shareAmountsMinor: { a: 300, b: 200 } })).toBe(true);
    expect(isCustomSplitValid({ totalAmountMinor: 500, shareAmountsMinor: { a: 300, b: 199 } })).toBe(false);
  });

  test("rejects an empty share map", () => {
    expect(isCustomSplitValid({ totalAmountMinor: 0, shareAmountsMinor: {} })).toBe(false);
  });
});

describe("getMemberShareMinor", () => {
  function makeExpense(overrides: Partial<Expense>): Pick<Expense, "amountMinor" | "shareMemberIds" | "shareAmountsMinor"> {
    return {
      amountMinor: 1000,
      shareMemberIds: ["a", "b", "c"],
      ...overrides,
    };
  }

  test("returns the equal floor+remainder share when there is no custom split", () => {
    const expense = makeExpense({});
    expect(getMemberShareMinor(expense, "a")).toBe(334);
    expect(getMemberShareMinor(expense, "b")).toBe(333);
    expect(getMemberShareMinor(expense, "c")).toBe(333);
  });

  test("returns the custom share amount when shareAmountsMinor is present", () => {
    const expense = makeExpense({ shareAmountsMinor: { a: 100, b: 300, c: 600 } });
    expect(getMemberShareMinor(expense, "a")).toBe(100);
    expect(getMemberShareMinor(expense, "b")).toBe(300);
    expect(getMemberShareMinor(expense, "c")).toBe(600);
  });

  test("returns 0 for a member who is not in shareMemberIds", () => {
    const expense = makeExpense({ shareMemberIds: ["b", "c"] });
    expect(getMemberShareMinor(expense, "a")).toBe(0);

    const customExpense = makeExpense({
      shareMemberIds: ["b", "c"],
      shareAmountsMinor: { b: 400, c: 600 },
    });
    expect(getMemberShareMinor(customExpense, "a")).toBe(0);
  });
});
