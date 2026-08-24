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

/**
 * The list the panel renders: everything the server knows, plus anything the
 * local expense window has that the server has not answered with yet.
 *
 * Both halves are needed. The server's copy is the only one that reaches past
 * the loaded window - the whole reason this stopped being a pure derivation -
 * but it is a snapshot taken when the panel opened, so a 清償 tapped a second
 * ago exists only in the optimistic local list. Merging by id means the row
 * appears immediately and does not double up once the fetch catches up.
 *
 * Newest first, matching every other list in the app.
 */
export function mergeSettlementRecords(
  local: SettlementRecord[],
  remote: SettlementRecord[],
): SettlementRecord[] {
  const byId = new Map<string, SettlementRecord>();

  // Remote first so a locally-optimistic row overwrites it with the copy the
  // UI is already showing - same id, and the local one cannot be staler.
  for (const record of [...remote, ...local]) {
    byId.set(record.id, record);
  }

  return [...byId.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
