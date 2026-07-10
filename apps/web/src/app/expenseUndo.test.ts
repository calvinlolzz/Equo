import { describe, expect, test } from "vitest";
import type { Expense } from "./appTypes";
import { toCreateExpenseRequest } from "./cloudAdapters";
import { expenseToDraft } from "./expenseUndo";

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

describe("expenseToDraft", () => {
  test("round-trips a simple equal-split expense to a create request", () => {
    const expense = makeExpense({
      payments: [{ payerId: "member_a", amountMinor: 1000 }],
      shareAmountsMinor: { member_a: 500, member_b: 500 },
    });
    const draft = expenseToDraft(expense);
    expect(draft.kind).toBe("expense");
    expect(draft.payerId).toBe("member_a");
    expect(draft.shareMemberIds).toEqual(["member_a", "member_b"]);

    const request = toCreateExpenseRequest(draft, "TWD");
    expect(request.kind).toBe("expense");
    expect(request.amount_minor).toBe(1000);
    expect(request.expense_payments).toEqual([
      { payer_member_id: "member_a", amount_minor: 1000, currency: "TWD" },
    ]);
    expect(request.expense_shares).toEqual([
      { member_id: "member_a", share_type: "fixed", amount_minor: 500 },
      { member_id: "member_b", share_type: "fixed", amount_minor: 500 },
    ]);
    // Without expenseDate (optimistic local expense) the date falls back to
    // createdAt, which IS the user-picked date in that case.
    expect(request.expense_date).toBe("2026-02-03");
  });

  test("prefers the user-picked expenseDate over the insertion timestamp", () => {
    const expense = makeExpense({
      expenseDate: "2026-02-01",
      createdAt: "2026-02-03T10:20:00.000Z",
      payments: [{ payerId: "member_a", amountMinor: 1000 }],
      shareAmountsMinor: { member_a: 500, member_b: 500 },
    });
    const request = toCreateExpenseRequest(expenseToDraft(expense), "TWD");
    expect(request.expense_date).toBe("2026-02-01");
  });

  test("round-trips a multi-payer expense", () => {
    const expense = makeExpense({
      amountMinor: 1000,
      payerId: "member_a",
      payments: [
        { payerId: "member_a", amountMinor: 600 },
        { payerId: "member_b", amountMinor: 400 },
      ],
      shareAmountsMinor: { member_a: 500, member_b: 500 },
    });
    const request = toCreateExpenseRequest(expenseToDraft(expense), "TWD");
    expect(request.expense_payments).toEqual([
      { payer_member_id: "member_a", amount_minor: 600, currency: "TWD" },
      { payer_member_id: "member_b", amount_minor: 400, currency: "TWD" },
    ]);
  });

  test("round-trips a percent split preserving share_value and amounts", () => {
    const expense = makeExpense({
      amountMinor: 1000,
      shareType: "percent",
      sharePercents: { member_a: 70, member_b: 30 },
      shareAmountsMinor: { member_a: 700, member_b: 300 },
    });
    const draft = expenseToDraft(expense);
    expect(draft.shareType).toBe("percent");
    expect(draft.sharePercents).toEqual({ member_a: 70, member_b: 30 });

    const request = toCreateExpenseRequest(draft, "TWD");
    expect(request.expense_shares).toEqual([
      { member_id: "member_a", share_type: "percent", share_value: 70, amount_minor: 700 },
      { member_id: "member_b", share_type: "percent", share_value: 30, amount_minor: 300 },
    ]);
  });

  test("round-trips a fixed-amount split", () => {
    const expense = makeExpense({
      amountMinor: 1000,
      shareMemberIds: ["member_a", "member_b"],
      payments: [{ payerId: "member_a", amountMinor: 1000 }],
      shareAmountsMinor: { member_a: 400, member_b: 600 },
    });
    const request = toCreateExpenseRequest(expenseToDraft(expense), "TWD");
    expect(request.expense_shares).toEqual([
      { member_id: "member_a", share_type: "fixed", amount_minor: 400 },
      { member_id: "member_b", share_type: "fixed", amount_minor: 600 },
    ]);
  });

  test("preserves foreign-currency source fields while the request stays in group currency", () => {
    const expense = makeExpense({
      amountMinor: 3000,
      sourceCurrency: "JPY",
      sourceAmountMinor: 100000,
      exchangeRate: 0.3,
      payments: [{ payerId: "member_a", amountMinor: 3000 }],
      shareAmountsMinor: { member_a: 1500, member_b: 1500 },
    });
    const draft = expenseToDraft(expense);
    expect(draft.sourceCurrency).toBe("JPY");
    expect(draft.sourceAmountMinor).toBe(100000);
    expect(draft.exchangeRate).toBe(0.3);

    const request = toCreateExpenseRequest(draft, "TWD");
    expect(request.currency).toBe("TWD");
    expect(request.amount_minor).toBe(3000);
  });

  test("round-trips an income to the beneficiary payments + collector share", () => {
    const income = makeExpense({
      kind: "income",
      title: "退款",
      amountMinor: 900,
      payerId: "member_b",
      payments: [
        { payerId: "member_b", amountMinor: 600 },
        { payerId: "member_c", amountMinor: 300 },
      ],
      shareMemberIds: ["member_a"],
      shareAmountsMinor: { member_a: 900 },
    });
    const draft = expenseToDraft(income);
    expect(draft.kind).toBe("income");
    expect(draft.payerId).toBe("member_a");
    expect(draft.shareMemberIds).toEqual(["member_b", "member_c"]);

    const request = toCreateExpenseRequest(draft, "TWD");
    expect(request.kind).toBe("income");
    expect(request.expense_payments).toEqual([
      { payer_member_id: "member_b", amount_minor: 600, currency: "TWD" },
      { payer_member_id: "member_c", amount_minor: 300, currency: "TWD" },
    ]);
    expect(request.expense_shares).toEqual([
      { member_id: "member_a", share_type: "fixed", amount_minor: 900 },
    ]);
  });

  test("round-trips a settlement/transfer with from/to members", () => {
    const settlement = makeExpense({
      kind: "settlement",
      title: "轉帳",
      amountMinor: 500,
      payerId: "member_a",
      shareMemberIds: ["member_b"],
      shareAmountsMinor: { member_b: 500 },
      transferToMemberId: "member_b",
    });
    const draft = expenseToDraft(settlement);
    expect(draft.kind).toBe("transfer");
    expect(draft.payerId).toBe("member_a");
    expect(draft.transferToMemberId).toBe("member_b");

    const request = toCreateExpenseRequest(draft, "TWD");
    expect(request.kind).toBe("transfer");
    expect(request.transfer_to_member_id).toBe("member_b");
    expect(request.expense_payments).toEqual([
      { payer_member_id: "member_a", amount_minor: 500, currency: "TWD" },
    ]);
    expect(request.expense_shares).toEqual([
      { member_id: "member_b", share_type: "fixed", amount_minor: 500 },
    ]);
  });

  test("falls back to shareMemberIds[0] for older settlements without transferToMemberId", () => {
    const settlement = makeExpense({
      kind: "settlement",
      payerId: "member_a",
      shareMemberIds: ["member_b"],
      amountMinor: 500,
    });
    expect(expenseToDraft(settlement).transferToMemberId).toBe("member_b");
  });

  test("preserves image, note, category and the original createdAt", () => {
    const expense = makeExpense({
      note: "備註內容",
      category: "transport",
      imageUrl: "https://cdn.equo.local/expense.jpg",
      payments: [{ payerId: "member_a", amountMinor: 1000 }],
      shareAmountsMinor: { member_a: 500, member_b: 500 },
    });
    const draft = expenseToDraft(expense);
    expect(draft.note).toBe("備註內容");
    expect(draft.category).toBe("transport");
    expect(draft.imageUrl).toBe("https://cdn.equo.local/expense.jpg");
    expect(draft.imageDataUrl).toBeUndefined();
    expect(draft.createdAt).toBe("2026-02-03T10:20:00.000Z");
  });

  test("defaults category to general when the expense has none", () => {
    const expense = makeExpense({ category: undefined });
    expect(expenseToDraft(expense).category).toBe("general");
  });
});
