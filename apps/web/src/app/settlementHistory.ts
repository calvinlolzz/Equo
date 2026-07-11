import type { Expense } from "./appTypes";

export type SettlementRecord = {
  id: string;
  fromMemberId: string;
  toMemberId: string;
  amountMinor: number;
  currency: string;
  createdAt: string;
};

/**
 * The group's settlement history, derived from the loaded expense window:
 * every kind==="settlement" entry (API kind "transfer") is a completed 清償
 * from payerId to transferToMemberId. Older display data may predate the
 * transfer_to_member_id passthrough, so shareMemberIds[0] stays as the
 * fallback recipient. Entries whose recipient can't be resolved at all are
 * dropped rather than rendered half-empty. Order follows the input
 * (newest-first from the server).
 */
export function listSettlementRecords(expenses: Expense[]): SettlementRecord[] {
  const records: SettlementRecord[] = [];

  for (const expense of expenses) {
    if (expense.kind !== "settlement") continue;

    const toMemberId = expense.transferToMemberId ?? expense.shareMemberIds[0];
    if (!toMemberId) continue;

    records.push({
      id: expense.id,
      fromMemberId: expense.payerId,
      toMemberId,
      amountMinor: expense.amountMinor,
      currency: expense.currency,
      createdAt: expense.createdAt,
    });
  }

  return records;
}
