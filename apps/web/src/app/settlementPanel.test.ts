import { describe, expect, test } from "vitest";
import { getSettlementPanelSummary } from "./settlementPanel";
import type { SettlementTransferSummary } from "./apiClient";

const transfers: SettlementTransferSummary[] = [
  {
    fromMemberId: "member_a",
    toMemberId: "member_b",
    amount: { amount_minor: 33000, currency: "TWD" },
  },
  {
    fromMemberId: "member_c",
    toMemberId: "member_b",
    amount: { amount_minor: 12000, currency: "TWD" },
  },
];

describe("getSettlementPanelSummary", () => {
  test("summarizes transfer count and total amount", () => {
    expect(getSettlementPanelSummary(transfers)).toEqual({
      transferCount: 2,
      totalAmountMinor: 45000,
      statusLabel: "2 筆清償轉帳",
      isSettled: false,
    });
  });

  test("marks an empty transfer list as settled", () => {
    expect(getSettlementPanelSummary([])).toEqual({
      transferCount: 0,
      totalAmountMinor: 0,
      statusLabel: "已結清",
      isSettled: true,
    });
  });
});
