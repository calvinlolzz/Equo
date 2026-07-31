import { describe, expect, test } from "vitest";
import type { Expense } from "./appTypes";
import { buildExpenseDuplicatePrefill, buildExpenseEditPrefill } from "./expenseEditPrefill";

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
      mode: "expense",
      title: "午餐",
      category: "food",
      currency: "TWD",
      amount: "10",
      exchangeRate: "1",
      payerId: "member_a",
      shareMemberIds: ["member_a", "member_b"],
      splitMode: "equal",
      shareAmounts: {},
      sharePercents: {},
      payments: [],
      transferToMemberId: "",
      imageUrl: "",
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
    expect(prefill.splitMode).toBe("amount");
    expect(prefill.shareAmounts).toEqual({ member_a: "4", member_b: "6" });
  });

  test("carries over note and image when present", () => {
    const expense = makeExpense({ note: "備註內容", imageUrl: "https://cdn.equo.local/expense.jpg" });
    const prefill = buildExpenseEditPrefill(expense, "TWD");
    expect(prefill.note).toBe("備註內容");
    expect(prefill.imageUrl).toBe("https://cdn.equo.local/expense.jpg");
  });

  test("defaults category to general when missing", () => {
    const expense = makeExpense({ category: undefined });
    expect(buildExpenseEditPrefill(expense, "TWD").category).toBe("general");
  });

  test("prefills the payer rows for a multi-payer expense", () => {
    const expense = makeExpense({
      amountMinor: 1000,
      payerId: "member_a",
      payments: [
        { payerId: "member_a", amountMinor: 600 },
        { payerId: "member_b", amountMinor: 400 },
      ],
      shareAmountsMinor: { member_a: 500, member_b: 500 },
    });
    const prefill = buildExpenseEditPrefill(expense, "TWD");
    expect(prefill.mode).toBe("expense");
    expect(prefill.payments).toEqual([
      { payerId: "member_a", amount: "6" },
      { payerId: "member_b", amount: "4" },
    ]);
  });

  test("keeps the zero-effort single payer row when there is only one payment", () => {
    const expense = makeExpense({
      payments: [{ payerId: "member_a", amountMinor: 1000 }],
    });
    const prefill = buildExpenseEditPrefill(expense, "TWD");
    expect(prefill.payments).toEqual([]);
    expect(prefill.payerId).toBe("member_a");
  });

  test("reopens a percent split in percent mode with the original percents", () => {
    const expense = makeExpense({
      amountMinor: 1000,
      shareType: "percent",
      sharePercents: { member_a: 70, member_b: 30 },
      shareAmountsMinor: { member_a: 700, member_b: 300 },
    });
    const prefill = buildExpenseEditPrefill(expense, "TWD");
    expect(prefill.splitMode).toBe("percent");
    expect(prefill.sharePercents).toEqual({ member_a: "70", member_b: "30" });
    expect(prefill.shareAmounts).toEqual({ member_a: "7", member_b: "3" });
  });

  test("reopens an income with the collector and beneficiary portions", () => {
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
    const prefill = buildExpenseEditPrefill(income, "TWD");
    expect(prefill.mode).toBe("income");
    expect(prefill.payerId).toBe("member_a");
    expect(prefill.shareMemberIds).toEqual(["member_b", "member_c"]);
    expect(prefill.splitMode).toBe("amount");
    expect(prefill.shareAmounts).toEqual({ member_b: "6", member_c: "3" });
  });

  test("reopens a settlement as a transfer with from/to members", () => {
    const settlement = makeExpense({
      kind: "settlement",
      title: "轉帳",
      amountMinor: 500,
      payerId: "member_a",
      shareMemberIds: ["member_b"],
      shareAmountsMinor: { member_b: 500 },
      transferToMemberId: "member_b",
    });
    const prefill = buildExpenseEditPrefill(settlement, "TWD");
    expect(prefill.mode).toBe("transfer");
    expect(prefill.payerId).toBe("member_a");
    expect(prefill.transferToMemberId).toBe("member_b");
    expect(prefill.amount).toBe("5");
  });

  test("falls back to shareMemberIds[0] for older settlements without transferToMemberId", () => {
    const settlement = makeExpense({
      kind: "settlement",
      payerId: "member_a",
      shareMemberIds: ["member_b"],
    });
    expect(buildExpenseEditPrefill(settlement, "TWD").transferToMemberId).toBe("member_b");
  });
});

const NOW = "2026-07-30T02:30:00.000Z";

describe("buildExpenseDuplicatePrefill", () => {
  test("carries over everything that describes how the cost is shared", () => {
    const expense = makeExpense({
      title: "週末採買",
      category: "grocery",
      note: "全聯",
      amountMinor: 1000,
      shareAmountsMinor: { member_a: 600, member_b: 400 },
      payments: [
        { payerId: "member_a", amountMinor: 700 },
        { payerId: "member_b", amountMinor: 300 },
      ],
    });

    const prefill = buildExpenseDuplicatePrefill(expense, "TWD", NOW);

    expect(prefill.title).toBe("週末採買");
    expect(prefill.category).toBe("grocery");
    expect(prefill.note).toBe("全聯");
    expect(prefill.shareMemberIds).toEqual(["member_a", "member_b"]);
    expect(prefill.splitMode).toBe("amount");
    expect(prefill.shareAmounts).toEqual({ member_a: "6", member_b: "4" });
    expect(prefill.payments).toEqual([
      { payerId: "member_a", amount: "7" },
      { payerId: "member_b", amount: "3" },
    ]);
  });

  test("files the copy under now, not the original's date", () => {
    const expense = makeExpense({});

    expect(buildExpenseDuplicatePrefill(expense, "TWD", NOW).dateTimeIso).toBe(NOW);
    // The edit path must keep the original timestamp — the two differing is
    // the whole reason for a separate builder.
    expect(buildExpenseEditPrefill(expense, "TWD").dateTimeIso).toBe("2026-02-03T10:20:00.000Z");
  });

  test("drops the receipt photo, which is evidence of the original transaction", () => {
    const expense = makeExpense({ imageUrl: "https://cdn.equo.local/expense.jpg" });

    expect(buildExpenseDuplicatePrefill(expense, "TWD", NOW).imageUrl).toBe("");
    expect(buildExpenseEditPrefill(expense, "TWD").imageUrl).toBe("https://cdn.equo.local/expense.jpg");
  });

  test("keeps a foreign-currency entry in its own currency", () => {
    const expense = makeExpense({
      amountMinor: 3000,
      sourceCurrency: "JPY",
      sourceAmountMinor: 100000,
      exchangeRate: 0.3,
    });

    const prefill = buildExpenseDuplicatePrefill(expense, "TWD", NOW);

    expect(prefill.currency).toBe("JPY");
    expect(prefill.amount).toBe("1000");
  });

  test("keeps a percent split as percents", () => {
    const expense = makeExpense({
      shareType: "percent",
      sharePercents: { member_a: 70, member_b: 30 },
      shareAmountsMinor: { member_a: 700, member_b: 300 },
    });

    const prefill = buildExpenseDuplicatePrefill(expense, "TWD", NOW);

    expect(prefill.splitMode).toBe("percent");
    expect(prefill.sharePercents).toEqual({ member_a: "70", member_b: "30" });
  });
});
