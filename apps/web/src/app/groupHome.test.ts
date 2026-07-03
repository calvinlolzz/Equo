import { describe, expect, test } from "vitest";
import { getGroupHomeSummary } from "./groupHome";

describe("getGroupHomeSummary", () => {
  test("summarizes the group home numbers", () => {
    expect(
      getGroupHomeSummary({
        memberCount: 2,
        expenseAmounts: [50000, 120000],
        nonZeroBalanceCount: 1,
      }),
    ).toEqual({
      memberCount: 2,
      expenseCount: 2,
      totalExpenseMinor: 170000,
      hasDebt: true,
    });
  });
});
