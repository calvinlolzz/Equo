import { describe, expect, test } from "vitest";
import { canSubmitExpenseDraft } from "./expenseDraft";

describe("canSubmitExpenseDraft", () => {
  test("requires a positive amount and at least one share member", () => {
    expect(canSubmitExpenseDraft({ amount: "500", selectedShareMemberCount: 2 })).toBe(true);
    expect(canSubmitExpenseDraft({ amount: "0", selectedShareMemberCount: 2 })).toBe(false);
    expect(canSubmitExpenseDraft({ amount: "500", selectedShareMemberCount: 0 })).toBe(false);
  });

  test("in custom split mode, also requires the shares to sum to the total", () => {
    expect(
      canSubmitExpenseDraft({
        amount: "500",
        selectedShareMemberCount: 2,
        isCustomSplit: true,
        totalAmountMinor: 50000,
        shareAmountsMinor: { a: 30000, b: 20000 },
      }),
    ).toBe(true);
    expect(
      canSubmitExpenseDraft({
        amount: "500",
        selectedShareMemberCount: 2,
        isCustomSplit: true,
        totalAmountMinor: 50000,
        shareAmountsMinor: { a: 30000, b: 10000 },
      }),
    ).toBe(false);
  });
});
