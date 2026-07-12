import { describe, expect, test } from "vitest";
import type { BalanceSummary } from "./apiClient";
import type { Expense } from "./appTypes";
import {
  applyExpenseToAggregates,
  applyExpenseToBalances,
  removeExpenseFromAggregates,
  removeExpenseFromBalances,
  type GroupDetailAggregates,
} from "./detailAggregates";

const memberIds = ["member_a", "member_b", "member_c"];

function makeExpense(overrides: Partial<Expense>): Expense {
  return {
    id: "expense_1",
    title: "Dinner",
    amountMinor: 900,
    currency: "TWD",
    createdAt: "2026-07-03T12:00:00.000Z",
    payerId: "member_a",
    shareMemberIds: ["member_a", "member_b", "member_c"],
    ...overrides,
  };
}

function emptyBalances(currency = "TWD"): BalanceSummary[] {
  return memberIds.map((memberId) => ({ memberId, balance: { amount_minor: 0, currency } }));
}

function emptyAggregates(): GroupDetailAggregates {
  return { expenseCount: 0, spendTotalMinor: 0, spendByDay: [], spendByCategory: [], memberDayShares: [] };
}

function balanceMap(balances: BalanceSummary[]): Record<string, number> {
  const result: Record<string, number> = {};
  balances.forEach((entry) => {
    result[entry.memberId] = entry.balance.amount_minor;
  });
  return result;
}

describe("applyExpenseToBalances / removeExpenseFromBalances", () => {
  test("an equal-split expense credits the payer and debits every share member", () => {
    const expense = makeExpense({ amountMinor: 900 });
    const balances = applyExpenseToBalances(emptyBalances(), expense, memberIds, "TWD");

    expect(balanceMap(balances)).toEqual({ member_a: 600, member_b: -300, member_c: -300 });
    expect(Object.values(balanceMap(balances)).reduce((sum, value) => sum + value, 0)).toBe(0);
  });

  test("removeExpenseFromBalances exactly undoes applyExpenseToBalances", () => {
    const expense = makeExpense({ amountMinor: 900 });
    const applied = applyExpenseToBalances(emptyBalances(), expense, memberIds, "TWD");
    const removed = removeExpenseFromBalances(applied, expense, memberIds, "TWD");

    expect(balanceMap(removed)).toEqual({ member_a: 0, member_b: 0, member_c: 0 });
  });

  test("multi-payer expense credits each payer their exact amount", () => {
    const expense = makeExpense({
      amountMinor: 1000,
      payments: [
        { payerId: "member_a", amountMinor: 600 },
        { payerId: "member_b", amountMinor: 400 },
      ],
      shareAmountsMinor: { member_a: 500, member_b: 250, member_c: 250 },
    });
    const balances = applyExpenseToBalances(emptyBalances(), expense, memberIds, "TWD");

    expect(balanceMap(balances)).toEqual({ member_a: 100, member_b: 150, member_c: -250 });
  });

  test("custom split honors shareAmountsMinor instead of an equal split", () => {
    const expense = makeExpense({
      amountMinor: 1000,
      shareAmountsMinor: { member_a: 100, member_b: 300, member_c: 600 },
    });
    const balances = applyExpenseToBalances(emptyBalances(), expense, memberIds, "TWD");

    expect(balanceMap(balances)).toEqual({ member_a: 900, member_b: -300, member_c: -600 });
  });

  test("percent split derives amounts from shareAmountsMinor (already resolved by the adapter)", () => {
    const expense = makeExpense({
      amountMinor: 1000,
      shareType: "percent",
      sharePercents: { member_a: 20, member_b: 30, member_c: 50 },
      shareAmountsMinor: { member_a: 200, member_b: 300, member_c: 500 },
    });
    const balances = applyExpenseToBalances(emptyBalances(), expense, memberIds, "TWD");

    expect(balanceMap(balances)).toEqual({ member_a: 800, member_b: -300, member_c: -500 });
  });

  test("a settlement transfer moves balance from payer to recipient only", () => {
    const settlement = makeExpense({
      id: "settlement_1",
      kind: "settlement",
      amountMinor: 300,
      payerId: "member_b",
      shareMemberIds: ["member_a"],
      shareAmountsMinor: { member_a: 300 },
      transferToMemberId: "member_a",
    });
    const balances = applyExpenseToBalances(emptyBalances(), settlement, memberIds, "TWD");

    expect(balanceMap(balances)).toEqual({ member_a: -300, member_b: 300, member_c: 0 });
  });

  test("an income entry nets the collector negative and beneficiaries positive", () => {
    const income = makeExpense({
      id: "income_1",
      kind: "income",
      amountMinor: 900,
      payerId: "member_b",
      payments: [
        { payerId: "member_b", amountMinor: 450 },
        { payerId: "member_c", amountMinor: 450 },
      ],
      shareMemberIds: ["member_a"],
      shareAmountsMinor: { member_a: 900 },
    });
    const balances = applyExpenseToBalances(emptyBalances(), income, memberIds, "TWD");

    expect(balanceMap(balances)).toEqual({ member_a: -900, member_b: 450, member_c: 450 });
  });

  test("edit = remove old contribution then apply the new one nets to the new expense's effect", () => {
    const original = makeExpense({ amountMinor: 900, payerId: "member_a" });
    const edited = makeExpense({ amountMinor: 600, payerId: "member_b" });

    const afterOriginal = applyExpenseToBalances(emptyBalances(), original, memberIds, "TWD");
    const afterRemove = removeExpenseFromBalances(afterOriginal, original, memberIds, "TWD");
    const afterEdit = applyExpenseToBalances(afterRemove, edited, memberIds, "TWD");

    const expected = applyExpenseToBalances(emptyBalances(), edited, memberIds, "TWD");
    expect(balanceMap(afterEdit)).toEqual(balanceMap(expected));
  });
});

describe("applyExpenseToAggregates / removeExpenseFromAggregates", () => {
  test("an expense inside the window increments expenseCount, spendTotalMinor, spendByDay, and memberDayShares", () => {
    const expense = makeExpense({ amountMinor: 900, createdAt: "2026-07-03T12:00:00.000Z" });
    const aggregates = applyExpenseToAggregates(emptyAggregates(), expense, memberIds);

    expect(aggregates.expenseCount).toBe(1);
    expect(aggregates.spendTotalMinor).toBe(900);
    expect(aggregates.spendByDay).toEqual([{ day: "2026-07-03", totalMinor: 900 }]);
    expect(aggregates.memberDayShares).toEqual(
      expect.arrayContaining([
        { day: "2026-07-03", memberId: "member_a", shareMinor: 300 },
        { day: "2026-07-03", memberId: "member_b", shareMinor: 300 },
        { day: "2026-07-03", memberId: "member_c", shareMinor: 300 },
      ]),
    );
  });

  test("removeExpenseFromAggregates exactly undoes applyExpenseToAggregates", () => {
    const expense = makeExpense({ amountMinor: 900, createdAt: "2026-07-03T12:00:00.000Z" });
    const applied = applyExpenseToAggregates(emptyAggregates(), expense, memberIds);
    const removed = removeExpenseFromAggregates(applied, expense, memberIds);

    expect(removed).toEqual(emptyAggregates());
  });

  test("a date outside the 8-day window still gets an entry (harmless until the next background refresh)", () => {
    const expense = makeExpense({ amountMinor: 500, createdAt: "2020-01-01T00:00:00.000Z" });
    const aggregates = applyExpenseToAggregates(emptyAggregates(), expense, memberIds);

    expect(aggregates.spendByDay).toEqual([{ day: "2020-01-01", totalMinor: 500 }]);
    expect(aggregates.spendTotalMinor).toBe(500);
    expect(aggregates.expenseCount).toBe(1);
  });

  test("income entries increment expenseCount but never touch spend aggregates", () => {
    const income = makeExpense({
      id: "income_1",
      kind: "income",
      amountMinor: 900,
      payerId: "member_b",
      payments: [{ payerId: "member_b", amountMinor: 900 }],
      shareMemberIds: ["member_a"],
      shareAmountsMinor: { member_a: 900 },
    });
    const aggregates = applyExpenseToAggregates(emptyAggregates(), income, memberIds);

    expect(aggregates.expenseCount).toBe(1);
    expect(aggregates.spendTotalMinor).toBe(0);
    expect(aggregates.spendByDay).toEqual([]);
    expect(aggregates.memberDayShares).toEqual([]);
  });

  test("settlement entries increment expenseCount but never touch spend aggregates", () => {
    const settlement = makeExpense({
      id: "settlement_1",
      kind: "settlement",
      amountMinor: 300,
      payerId: "member_b",
      shareMemberIds: ["member_a"],
      shareAmountsMinor: { member_a: 300 },
      transferToMemberId: "member_a",
    });
    const aggregates = applyExpenseToAggregates(emptyAggregates(), settlement, memberIds);

    expect(aggregates.expenseCount).toBe(1);
    expect(aggregates.spendTotalMinor).toBe(0);
    expect(aggregates.spendByDay).toEqual([]);
    expect(aggregates.memberDayShares).toEqual([]);
  });

  test("removing the last expense on a day prunes the day's spendByDay/memberDayShares entries instead of leaving a zero", () => {
    const expense = makeExpense({ amountMinor: 900, createdAt: "2026-07-03T12:00:00.000Z" });
    const applied = applyExpenseToAggregates(emptyAggregates(), expense, memberIds);
    const removed = removeExpenseFromAggregates(applied, expense, memberIds);

    expect(removed.spendByDay).toEqual([]);
    expect(removed.memberDayShares).toEqual([]);
  });

  test("editing an expense (remove old + apply new) nets to the new expense's aggregate effect", () => {
    const original = makeExpense({ amountMinor: 900, createdAt: "2026-07-03T12:00:00.000Z" });
    const edited = makeExpense({ amountMinor: 600, createdAt: "2026-07-04T12:00:00.000Z" });

    const afterOriginal = applyExpenseToAggregates(emptyAggregates(), original, memberIds);
    const afterRemove = removeExpenseFromAggregates(afterOriginal, original, memberIds);
    const afterEdit = applyExpenseToAggregates(afterRemove, edited, memberIds);

    const expected = applyExpenseToAggregates(emptyAggregates(), edited, memberIds);
    expect(afterEdit).toEqual(expected);
  });

  test("spendByCategory accumulates per category, sorts largest first, and prunes zeros", () => {
    const dinner = makeExpense({ id: "e1", amountMinor: 900, category: "food" });
    const taxi = makeExpense({ id: "e2", amountMinor: 1200, category: "transport" });
    const uncategorized = makeExpense({ id: "e3", amountMinor: 100 });

    const applied = [dinner, taxi, uncategorized].reduce(
      (aggregates, expense) => applyExpenseToAggregates(aggregates, expense, memberIds),
      emptyAggregates(),
    );

    expect(applied.spendByCategory).toEqual([
      { category: "transport", totalMinor: 1200 },
      { category: "food", totalMinor: 900 },
      { category: "general", totalMinor: 100 },
    ]);

    const removed = removeExpenseFromAggregates(applied, taxi, memberIds);
    expect(removed.spendByCategory).toEqual([
      { category: "food", totalMinor: 900 },
      { category: "general", totalMinor: 100 },
    ]);
  });

  test("multiple expenses on the same day accumulate spendByDay/memberDayShares", () => {
    const first = makeExpense({ id: "e1", amountMinor: 900, createdAt: "2026-07-03T09:00:00.000Z" });
    const second = makeExpense({ id: "e2", amountMinor: 300, createdAt: "2026-07-03T10:00:00.000Z" });

    const afterFirst = applyExpenseToAggregates(emptyAggregates(), first, memberIds);
    const afterSecond = applyExpenseToAggregates(afterFirst, second, memberIds);

    expect(afterSecond.spendTotalMinor).toBe(1200);
    expect(afterSecond.spendByDay).toEqual([{ day: "2026-07-03", totalMinor: 1200 }]);
    expect(afterSecond.expenseCount).toBe(2);
  });
});
