import { describe, expect, test } from "vitest";
import type { Expense, Member } from "./appTypes";
import { computeMemberBalances } from "./groupBalances";

const members: Member[] = [
  { id: "member_a", name: "Alice", role: "owner" },
  { id: "member_b", name: "Bob" },
  { id: "member_c", name: "Cathy" },
];

function makeExpense(overrides: Partial<Expense>): Expense {
  return {
    id: "expense_1",
    title: "Dinner",
    amountMinor: 1000,
    currency: "TWD",
    createdAt: "2026-07-03T12:00:00.000Z",
    payerId: "member_a",
    shareMemberIds: ["member_a", "member_b", "member_c"],
    ...overrides,
  };
}

describe("computeMemberBalances", () => {
  test("allocates an uneven split with floor + remainder so totals reconcile exactly", () => {
    const expenses = [makeExpense({ amountMinor: 1000 })];
    const balances = computeMemberBalances(members, expenses);

    // 1000 / 3 = 334 + 333 + 333, payer gets +1000
    expect(balances.get("member_a")).toBe(1000 - 334);
    expect(balances.get("member_b")).toBe(-333);
    expect(balances.get("member_c")).toBe(-333);

    const total = [...balances.values()].reduce((sum, value) => sum + value, 0);
    expect(total).toBe(0);
  });

  test("handles a payer who is excluded from the shares", () => {
    const expenses = [
      makeExpense({
        amountMinor: 900,
        payerId: "member_a",
        shareMemberIds: ["member_b", "member_c"],
      }),
    ];
    const balances = computeMemberBalances(members, expenses);

    expect(balances.get("member_a")).toBe(900);
    expect(balances.get("member_b")).toBe(-450);
    expect(balances.get("member_c")).toBe(-450);

    const total = [...balances.values()].reduce((sum, value) => sum + value, 0);
    expect(total).toBe(0);
  });

  test("handles a payer who is included in their own shares", () => {
    const expenses = [
      makeExpense({
        amountMinor: 1000,
        payerId: "member_a",
        shareMemberIds: ["member_a", "member_b", "member_c"],
      }),
    ];
    const balances = computeMemberBalances(members, expenses);

    const total = [...balances.values()].reduce((sum, value) => sum + value, 0);
    expect(total).toBe(0);
    expect(balances.get("member_a")).toBe(1000 - 334);
  });

  test("a settlement transfer zeroes out an existing debt", () => {
    const expense = makeExpense({
      amountMinor: 900,
      payerId: "member_a",
      shareMemberIds: ["member_a", "member_b", "member_c"],
    });
    const withoutSettlement = computeMemberBalances(members, [expense]);
    expect(withoutSettlement.get("member_b")).toBe(-300);
    expect(withoutSettlement.get("member_a")).toBe(600);

    const settlement = makeExpense({
      id: "settlement_1",
      kind: "settlement",
      amountMinor: 300,
      payerId: "member_b",
      shareMemberIds: ["member_a"],
    });
    const withSettlement = computeMemberBalances(members, [expense, settlement]);
    expect(withSettlement.get("member_b")).toBe(0);
    expect(withSettlement.get("member_a")).toBe(300);

    const total = [...withSettlement.values()].reduce((sum, value) => sum + value, 0);
    expect(total).toBe(0);
  });
});
