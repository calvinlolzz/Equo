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

  test("credits each payment to its own payer when payments is present", () => {
    const expense = makeExpense({
      amountMinor: 1000,
      payerId: "member_a",
      payments: [
        { payerId: "member_a", amountMinor: 600 },
        { payerId: "member_b", amountMinor: 400 },
      ],
      shareMemberIds: ["member_a", "member_b", "member_c"],
      shareAmountsMinor: { member_a: 500, member_b: 250, member_c: 250 },
    });
    const balances = computeMemberBalances(members, [expense]);

    expect(balances.get("member_a")).toBe(600 - 500);
    expect(balances.get("member_b")).toBe(400 - 250);
    expect(balances.get("member_c")).toBe(-250);

    const total = [...balances.values()].reduce((sum, value) => sum + value, 0);
    expect(total).toBe(0);
  });

  test("income entry nets the collector negative and the beneficiaries positive with no kind special-casing", () => {
    // Agreed income encoding: payments = each beneficiary's portion (+),
    // shares = [{collector, full amount}] (-). member_a collected a 900
    // refund owned by member_b and member_c.
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
    const balances = computeMemberBalances(members, [income]);

    expect(balances.get("member_a")).toBe(-900);
    expect(balances.get("member_b")).toBe(450);
    expect(balances.get("member_c")).toBe(450);

    const total = [...balances.values()].reduce((sum, value) => sum + value, 0);
    expect(total).toBe(0);
  });

  test("honors a custom shareAmountsMinor split instead of the equal split", () => {
    const expense = makeExpense({
      amountMinor: 1000,
      payerId: "member_a",
      shareMemberIds: ["member_a", "member_b", "member_c"],
      shareAmountsMinor: { member_a: 100, member_b: 300, member_c: 600 },
    });
    const balances = computeMemberBalances(members, [expense]);

    expect(balances.get("member_a")).toBe(1000 - 100);
    expect(balances.get("member_b")).toBe(-300);
    expect(balances.get("member_c")).toBe(-600);

    const total = [...balances.values()].reduce((sum, value) => sum + value, 0);
    expect(total).toBe(0);
  });
});
