import { describe, expect, test } from "vitest";
import type { Expense } from "./appTypes";
import { buildExpenseEditPrefill } from "./expenseEditPrefill";

function makeExpense(overrides: Partial<Expense>): Expense {
  return {
    id: "expense_1",
    title: "午餐",
    amountMinor: 1000,
    currency: "TWD",
    createdAt: "2026-02-03T10:20:00.000Z",
    payerId: "member_a",
    shareMemberIds: ["member_a", "member_b"],
    kind: "expense",
    category: "food",
    ...overrides,
  };
}

describe("buildExpenseEditPrefill", () => {
  test("maps a plain group-currency expense", () => {
    const expense = makeExpense({});
    expect(buildExpenseEditPrefill(expense, "TWD")).toEqual({
      title: "午餐",
      category: "food",
      currency: "TWD",
      amount: "10",
      exchangeRate: "1",
      payerId: "member_a",
      shareMemberIds: ["member_a", "member_b"],
      isCustomSplit: false,
      shareAmounts: {},
      imageDataUrl: "",
      note: "",
      dateTimeIso: "2026-02-03T10:20:00.000Z",
    });
  });

  test("prefers source currency/amount/rate when present", () => {
    const expense = makeExpense({
      amountMinor: 3000,
      sourceCurrency: "JPY",
      sourceAmountMinor: 100000,
      exchangeRate: 0.3,
    });
    const prefill = buildExpenseEditPrefill(expense, "TWD");
    expect(prefill.currency).toBe("JPY");
    expect(prefill.amount).toBe("1000");
    expect(prefill.exchangeRate).toBe("0.3");
  });

  test("maps custom split share amounts", () => {
    const expense = makeExpense({
      amountMinor: 1000,
      shareMemberIds: ["member_a", "member_b"],
      shareAmountsMinor: { member_a: 400, member_b: 600 },
    });
    const prefill = buildExpenseEditPrefill(expense, "TWD");
    expect(prefill.isCustomSplit).toBe(true);
    expect(prefill.shareAmounts).toEqual({ member_a: "4", member_b: "6" });
  });

  test("carries over note and image when present", () => {
    const expense = makeExpense({ note: "備註內容", imageDataUrl: "data:image/jpeg;base64,xyz" });
    const prefill = buildExpenseEditPrefill(expense, "TWD");
    expect(prefill.note).toBe("備註內容");
    expect(prefill.imageDataUrl).toBe("data:image/jpeg;base64,xyz");
  });

  test("defaults category to general when missing", () => {
    const expense = makeExpense({ category: undefined });
    expect(buildExpenseEditPrefill(expense, "TWD").category).toBe("general");
  });
});
