import { describe, expect, test } from "vitest";
import type { Expense } from "./appTypes";
import { listSettlementRecords, mergeSettlementRecords, type SettlementRecord } from "./settlementHistory";

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

describe("mergeSettlementRecords", () => {
  function record(id: string, createdAt: string, amountMinor = 50_000): SettlementRecord {
    return { id, fromMemberId: "a", toMemberId: "b", amountMinor, currency: "TWD", createdAt };
  }

  test("returns everything from both sides, newest first", () => {
    const merged = mergeSettlementRecords(
      [record("local", "2026-08-01T00:00:00.000Z")],
      [record("old", "2026-06-01T00:00:00.000Z"), record("mid", "2026-07-01T00:00:00.000Z")],
    );

    expect(merged.map((entry) => entry.id)).toEqual(["local", "mid", "old"]);
  });

  test("a settlement in both copies appears once", () => {
    // The just-tapped 清償 is optimistic locally and, a moment later, also in
    // the server's answer. Two rows for one transfer would read as paying twice.
    const merged = mergeSettlementRecords(
      [record("same", "2026-08-01T00:00:00.000Z")],
      [record("same", "2026-08-01T00:00:00.000Z")],
    );

    expect(merged).toHaveLength(1);
  });

  test("the local copy wins, because it is what the screen already shows", () => {
    const merged = mergeSettlementRecords(
      [record("same", "2026-08-01T00:00:00.000Z", 12_345)],
      [record("same", "2026-08-01T00:00:00.000Z", 99_999)],
    );

    expect(merged[0].amountMinor).toBe(12_345);
  });

  test("history older than the loaded window survives — the whole point", () => {
    // Before this, the list was a filter over the ~100 loaded expenses, so a
    // settlement from March simply vanished and the user's reading was "I
    // definitely settled up, where did it go".
    const merged = mergeSettlementRecords([], [record("march", "2026-03-01T00:00:00.000Z")]);

    expect(merged.map((entry) => entry.id)).toEqual(["march"]);
  });

  test("no records at all is still an empty list, not a crash", () => {
    expect(mergeSettlementRecords([], [])).toEqual([]);
  });
});
