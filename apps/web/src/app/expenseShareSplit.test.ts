import { describe, expect, test } from "vitest";
import type { Expense } from "./appTypes";
import {
  buildEqualShareAmountsMinor,
  buildPercentShareAmounts,
  getCustomSplitRemainderMinor,
  getMemberShareMinor,
  getPaymentsRemainderMinor,
  getPercentSplitRemainder,
  isCustomSplitValid,
  isPaymentsSplitValid,
  isPercentSplitValid,
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

describe("buildPercentShareAmounts", () => {
  test("allocates exact percents directly", () => {
    expect(buildPercentShareAmounts(["a", "b"], { a: 70, b: 30 }, 1000)).toEqual({ a: 700, b: 300 });
  });

  test("largest-remainder allocation sums exactly to the total", () => {
    // 33.33% / 33.33% / 33.34% of 1000 = 333.3 / 333.3 / 333.4 raw
    const result = buildPercentShareAmounts(["a", "b", "c"], { a: 33.33, b: 33.33, c: 33.34 }, 1000);
    expect(result.a + result.b + result.c).toBe(1000);
    expect(result.c).toBe(334);
  });

  test("one-third splits reconcile exactly with ties broken by member order", () => {
    // Equal thirds cannot each round the same way; the leftover minor unit
    // goes to the largest fractional remainder, ties broken by member order.
    const result = buildPercentShareAmounts(["a", "b", "c"], { a: 33.33, b: 33.33, c: 33.33 }, 100);
    expect(result.a + result.b + result.c).toBe(100);
    expect(result).toEqual({ a: 34, b: 33, c: 33 });
  });

  test("survives awkward totals without drift", () => {
    for (const total of [1, 7, 99, 101, 12345]) {
      const result = buildPercentShareAmounts(["a", "b", "c"], { a: 33.33, b: 33.33, c: 33.34 }, total);
      expect(result.a + result.b + result.c).toBe(total);
    }
  });

  test("returns an empty map with no members", () => {
    expect(buildPercentShareAmounts([], { a: 100 }, 1000)).toEqual({});
  });
});

describe("isPercentSplitValid / getPercentSplitRemainder", () => {
  test("requires percents to sum to exactly 100", () => {
    expect(isPercentSplitValid(["a", "b"], { a: 70, b: 30 })).toBe(true);
    expect(isPercentSplitValid(["a", "b"], { a: 70, b: 29 })).toBe(false);
    expect(isPercentSplitValid(["a", "b", "c"], { a: 33.33, b: 33.33, c: 33.34 })).toBe(true);
  });

  test("requires every member's percent to be greater than 0", () => {
    expect(isPercentSplitValid(["a", "b"], { a: 100, b: 0 })).toBe(false);
    expect(isPercentSplitValid(["a", "b"], { a: 100 })).toBe(false);
  });

  test("rejects an empty member list", () => {
    expect(isPercentSplitValid([], {})).toBe(false);
  });

  test("remainder reports the missing percentage points", () => {
    expect(getPercentSplitRemainder(["a", "b"], { a: 40, b: 30 })).toBe(30);
    expect(getPercentSplitRemainder(["a", "b"], { a: 70, b: 30 })).toBe(0);
    expect(getPercentSplitRemainder(["a"], { a: 120 })).toBe(-20);
  });
});

describe("getPaymentsRemainderMinor / isPaymentsSplitValid", () => {
  test("computes the leftover amount versus the total, mirroring custom shares", () => {
    expect(getPaymentsRemainderMinor({ totalAmountMinor: 1000, paymentAmountsMinor: { a: 600, b: 300 } })).toBe(100);
    expect(getPaymentsRemainderMinor({ totalAmountMinor: 900, paymentAmountsMinor: { a: 600, b: 300 } })).toBe(0);
  });

  test("valid only when payments sum exactly to the total", () => {
    expect(isPaymentsSplitValid({ totalAmountMinor: 900, paymentAmountsMinor: { a: 600, b: 300 } })).toBe(true);
    expect(isPaymentsSplitValid({ totalAmountMinor: 1000, paymentAmountsMinor: { a: 600, b: 300 } })).toBe(false);
  });

  test("rejects zero or non-integer payments (validation.ts requires positive integers)", () => {
    expect(isPaymentsSplitValid({ totalAmountMinor: 600, paymentAmountsMinor: { a: 600, b: 0 } })).toBe(false);
    expect(isPaymentsSplitValid({ totalAmountMinor: 600, paymentAmountsMinor: { a: 599.5, b: 0.5 } })).toBe(false);
  });

  test("rejects an empty payments map", () => {
    expect(isPaymentsSplitValid({ totalAmountMinor: 0, paymentAmountsMinor: {} })).toBe(false);
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
