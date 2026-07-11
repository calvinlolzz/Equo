import { describe, expect, test } from "vitest";
import type { Expense } from "./appTypes";
import { listSettlementRecords } from "./settlementHistory";

function makeExpense(overrides: Partial<Expense>): Expense {
  return {
    id: "expense_1",
    title: "清償轉帳",
    amountMinor: 50000,
    currency: "TWD",
    createdAt: "2026-07-10T12:00:00.000Z",
    payerId: "member_a",
    shareMemberIds: ["member_b"],
    kind: "settlement",
    ...overrides,
  } as Expense;
}

describe("listSettlementRecords", () => {
  test("keeps only settlement entries and maps from/to/amount", () => {
    const records = listSettlementRecords([
      makeExpense({ id: "s1", transferToMemberId: "member_b" }),
      makeExpense({ id: "e1", kind: "expense" }),
      makeExpense({ id: "i1", kind: "income" }),
    ]);

    expect(records).toEqual([
      {
        id: "s1",
        fromMemberId: "member_a",
        toMemberId: "member_b",
        amountMinor: 50000,
        currency: "TWD",
        createdAt: "2026-07-10T12:00:00.000Z",
      },
    ]);
  });

  test("falls back to shareMemberIds[0] when transferToMemberId is absent", () => {
    const records = listSettlementRecords([makeExpense({ transferToMemberId: undefined })]);

    expect(records[0]?.toMemberId).toBe("member_b");
  });

  test("drops settlements whose recipient cannot be resolved", () => {
    const records = listSettlementRecords([
      makeExpense({ transferToMemberId: undefined, shareMemberIds: [] }),
    ]);

    expect(records).toEqual([]);
  });
});
