import { describe, expect, test } from "vitest";
import type { Expense, Member } from "./appTypes";
import { buildSettlementTransfers } from "./buildSettlementTransfers";

function makeExpense(overrides: Partial<Expense>): Expense {
  return {
    id: "expense_1",
    title: "title",
    amountMinor: 1000,
    currency: "TWD",
    createdAt: "2026-01-01T00:00:00.000Z",
    payerId: "member_a",
    shareMemberIds: ["member_a", "member_b"],
    kind: "expense",
    ...overrides,
  };
}

describe("buildSettlementTransfers", () => {
  test("returns no transfers when there are no members", () => {
    expect(buildSettlementTransfers([], [], "TWD")).toEqual([]);
  });

  test("returns no transfers when balances are already settled", () => {
    const members: Member[] = [
      { id: "member_a", name: "Alice", role: "owner" },
      { id: "member_b", name: "Bob" },
    ];
    expect(buildSettlementTransfers(members, [], "TWD")).toEqual([]);
  });

  test("returns a single transfer for a simple two-member debt", () => {
    const members: Member[] = [
      { id: "member_a", name: "Alice", role: "owner" },
      { id: "member_b", name: "Bob" },
    ];
    const expenses = [makeExpense({ amountMinor: 1000, payerId: "member_a", shareMemberIds: ["member_a", "member_b"] })];
    expect(buildSettlementTransfers(members, expenses, "TWD")).toEqual([
      { fromMemberId: "member_b", toMemberId: "member_a", amount: { amount_minor: 500, currency: "TWD" } },
    ]);
  });

  test("produces two transfers for a three-member scenario", () => {
    const members: Member[] = [
      { id: "member_a", name: "Alice", role: "owner" },
      { id: "member_b", name: "Bob" },
      { id: "member_c", name: "Cora" },
    ];
    // Alice pays 900 shared by all three (each owes 300): a +600, b -300, c -300
    // Bob pays 300 shared by all three (each owes 100): a -100, b +200, c -100
    // Net: a = 500, b = -100, c = -400
    const expenses = [
      makeExpense({
        id: "expense_1",
        amountMinor: 900,
        payerId: "member_a",
        shareMemberIds: ["member_a", "member_b", "member_c"],
      }),
      makeExpense({
        id: "expense_2",
        amountMinor: 300,
        payerId: "member_b",
        shareMemberIds: ["member_a", "member_b", "member_c"],
      }),
    ];
    const transfers = buildSettlementTransfers(members, expenses, "TWD");
    expect(transfers).toEqual([
      { fromMemberId: "member_c", toMemberId: "member_a", amount: { amount_minor: 400, currency: "TWD" } },
      { fromMemberId: "member_b", toMemberId: "member_a", amount: { amount_minor: 100, currency: "TWD" } },
    ]);
  });
});
