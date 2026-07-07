import type { BalanceSummary } from "./apiClient";
import { calculateSettlement, type SettlementTransfer } from "../domain/settlement";

/**
 * Builds the minimal-transfer settlement suggestions from the group-level
 * server balances (get_group_detail's balances array) - NOT a client-side
 * recompute from the expense history. This is deliberate: the expenses
 * array the client holds is capped to a window (see EXPENSE_WINDOW_LIMIT),
 * so computeMemberBalances over just the loaded expenses would silently
 * under/overstate balances for any group with more history than the
 * window. The server's balances are always the full-history truth;
 * computeMemberBalances/groupBalances.ts stay in use only for the
 * composer's per-expense split preview, which has nothing to do with
 * group-level settlement math.
 */
export function buildSettlementTransfers(balances: BalanceSummary[]): SettlementTransfer[] {
  if (balances.length === 0) return [];
  return calculateSettlement(balances);
}
