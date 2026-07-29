import { describe, expect, test } from "vitest";
import type { Expense } from "./appTypes";
import {
  EMPTY_EXPENSE_FILTER,
  expenseDayKey,
  filterExpenses,
  isExpenseFilterActive,
  summariseFilteredExpenses,
  type ExpenseFilter,
} from "./expenseFilter";

function makeExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "expense_1",
    title: "拉麵",
    amountMinor: 120000,
    currency: "TWD",
    createdAt: "2026-07-04T10:00:00.000Z",
    expenseDate: "2026-07-04",
    payerId: "member_1",
    shareMemberIds: ["member_1", "member_2"],
    kind: "expense",
    category: "food",
    ...overrides,
  };
}

function withFilter(patch: Partial<ExpenseFilter>): ExpenseFilter {
  return { ...EMPTY_EXPENSE_FILTER, ...patch };
}

describe("isExpenseFilterActive", () => {
  test("an untouched filter is inactive", () => {
    expect(isExpenseFilterActive(EMPTY_EXPENSE_FILTER)).toBe(false);
  });

  test("whitespace alone does not count as a search", () => {
    expect(isExpenseFilterActive(withFilter({ query: "   " }))).toBe(false);
  });

  test.each([["query", { query: "拉" }], ["kind", { kind: "income" as const }], ["from", { from: "2026-07-01" }]])(
    "%s makes it active",
    (_label, patch) => {
      expect(isExpenseFilterActive(withFilter(patch))).toBe(true);
    },
  );
});

describe("filterExpenses", () => {
  const ramen = makeExpense();
  const taxi = makeExpense({
    id: "expense_2",
    title: "計程車",
    category: "transport",
    amountMinor: 25000,
    expenseDate: "2026-07-06",
    payerId: "member_2",
    shareMemberIds: ["member_2"],
    note: "從機場到旅館",
  });
  const salary = makeExpense({
    id: "expense_3",
    title: "退款",
    kind: "income",
    amountMinor: 50000,
    expenseDate: "2026-07-08",
    shareMemberIds: ["member_1"],
  });
  const all = [ramen, taxi, salary];

  test("an inactive filter returns the input untouched", () => {
    expect(filterExpenses(all, EMPTY_EXPENSE_FILTER)).toBe(all);
  });

  test("matches the title case-insensitively", () => {
    expect(filterExpenses(all, withFilter({ query: "計程" })).map((expense) => expense.id)).toEqual(["expense_2"]);
  });

  test("matches the note as well as the title", () => {
    expect(filterExpenses(all, withFilter({ query: "機場" })).map((expense) => expense.id)).toEqual(["expense_2"]);
  });

  test("matches the amount as it is displayed, not as minor units", () => {
    // $1,200 is stored as 120000 minor - typing what is on screen has to work.
    expect(filterExpenses(all, withFilter({ query: "1200" })).map((expense) => expense.id)).toEqual(["expense_1"]);
  });

  test("ignores separators in a numeric query", () => {
    expect(filterExpenses(all, withFilter({ query: "1,200" })).map((expense) => expense.id)).toEqual(["expense_1"]);
  });

  test("filters by kind, treating a missing kind as an expense", () => {
    const legacy = makeExpense({ id: "expense_4", kind: undefined });
    expect(filterExpenses([...all, legacy], withFilter({ kind: "expense" })).map((expense) => expense.id)).toEqual([
      "expense_1",
      "expense_2",
      "expense_4",
    ]);
    expect(filterExpenses(all, withFilter({ kind: "income" })).map((expense) => expense.id)).toEqual(["expense_3"]);
  });

  test("filters by category", () => {
    expect(filterExpenses(all, withFilter({ category: "transport" })).map((expense) => expense.id)).toEqual(["expense_2"]);
  });

  test("member filter matches payers and share participants alike", () => {
    // member_2 pays for the taxi and shares the ramen; both must come back.
    expect(filterExpenses(all, withFilter({ memberId: "member_2" })).map((expense) => expense.id)).toEqual([
      "expense_1",
      "expense_2",
    ]);
  });

  test("member filter matches a settlement's recipient", () => {
    const settlement = makeExpense({
      id: "expense_5",
      kind: "settlement",
      payerId: "member_1",
      shareMemberIds: ["member_3"],
      transferToMemberId: "member_3",
    });
    expect(filterExpenses([settlement], withFilter({ memberId: "member_3" })).map((expense) => expense.id)).toEqual([
      "expense_5",
    ]);
  });

  test("date bounds are inclusive on both ends", () => {
    const result = filterExpenses(all, withFilter({ from: "2026-07-04", to: "2026-07-06" }));
    expect(result.map((expense) => expense.id)).toEqual(["expense_1", "expense_2"]);
  });

  test("filters combine as AND, not OR", () => {
    expect(filterExpenses(all, withFilter({ query: "計程車", kind: "income" }))).toEqual([]);
  });

  test("falls back to createdAt for a row that has no server expense_date yet", () => {
    const offline = makeExpense({ id: "local-1", expenseDate: undefined, createdAt: "2026-07-09T02:00:00.000Z" });
    expect(expenseDayKey(offline)).toBe("2026-07-09");
    expect(filterExpenses([offline], withFilter({ from: "2026-07-09" })).map((expense) => expense.id)).toEqual(["local-1"]);
  });
});

describe("summariseFilteredExpenses", () => {
  test("counts every row but only sums real spend", () => {
    const summary = summariseFilteredExpenses([
      makeExpense({ amountMinor: 10000 }),
      makeExpense({ id: "expense_2", amountMinor: 5000, kind: "income" }),
      makeExpense({ id: "expense_3", amountMinor: 3000, kind: "settlement" }),
    ]);

    // Income and settlements are not spending - the same rule the group
    // aggregates apply, so the two totals cannot disagree.
    expect(summary).toEqual({ count: 3, totalMinor: 10000 });
  });
});
