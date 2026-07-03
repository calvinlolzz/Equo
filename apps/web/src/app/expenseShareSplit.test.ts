import { describe, expect, test } from "vitest";
import {
  buildEqualShareAmountsMinor,
  getCustomSplitRemainderMinor,
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
