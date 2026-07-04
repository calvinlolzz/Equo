import type { Expense, Member } from "./appTypes";
import { calculateSettlement, type SettlementTransfer } from "../domain/settlement";
import { computeMemberBalances } from "./groupBalances";

export function buildSettlementTransfers(members: Member[], expenses: Expense[], currency: string): SettlementTransfer[] {
  if (members.length === 0) return [];
  const balances = computeMemberBalances(members, expenses);
  const balanceSummaries = members.map((member) => ({
    memberId: member.id,
    balance: { amount_minor: balances.get(member.id) ?? 0, currency },
  }));
  return calculateSettlement(balanceSummaries);
}
