import { describe, expect, test } from "vitest";
import { buildEqualExpenseShares } from "./expenseSplit";

describe("buildEqualExpenseShares", () => {
  test("splits an amount across selected members and preserves the total", () => {
    expect(buildEqualExpenseShares(["member_a", "member_b", "member_c"], 1000)).toEqual([
      { member_id: "member_a", share_type: "fixed", amount_minor: 334 },
      { member_id: "member_b", share_type: "fixed", amount_minor: 333 },
      { member_id: "member_c", share_type: "fixed", amount_minor: 333 },
    ]);
  });

  test("returns no shares when no members are selected", () => {
    expect(buildEqualExpenseShares([], 1000)).toEqual([]);
  });
});
