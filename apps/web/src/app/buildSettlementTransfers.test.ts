import { describe, expect, test } from "vitest";
import type { BalanceSummary } from "./apiClient";
import { buildSettlementTransfers } from "./buildSettlementTransfers";

function balances(entries: Record<string, number>, currency = "TWD"): BalanceSummary[] {
  return Object.entries(entries).map(([memberId, amount_minor]) => ({
    memberId,
    balance: { amount_minor, currency },
  }));
}

describe("buildSettlementTransfers", () => {
  test("returns no transfers when there are no balances", () => {
    expect(buildSettlementTransfers([])).toEqual([]);
  });

  test("returns no transfers when balances are already settled", () => {
    expect(buildSettlementTransfers(balances({ member_a: 0, member_b: 0 }))).toEqual([]);
  });

  test("returns a single transfer for a simple two-member debt", () => {
    expect(buildSettlementTransfers(balances({ member_a: 500, member_b: -500 }))).toEqual([
      { fromMemberId: "member_b", toMemberId: "member_a", amount: { amount_minor: 500, currency: "TWD" } },
    ]);
  });

  test("produces two transfers for a three-member scenario", () => {
    // Alice pays 900 shared by all three (each owes 300): a +600, b -300, c -300
    // Bob pays 300 shared by all three (each owes 100): a -100, b +200, c -100
    // Net: a = 500, b = -100, c = -400
    const transfers = buildSettlementTransfers(balances({ member_a: 500, member_b: -100, member_c: -400 }));
    expect(transfers).toEqual([
      { fromMemberId: "member_c", toMemberId: "member_a", amount: { amount_minor: 400, currency: "TWD" } },
      { fromMemberId: "member_b", toMemberId: "member_a", amount: { amount_minor: 100, currency: "TWD" } },
    ]);
  });
});
