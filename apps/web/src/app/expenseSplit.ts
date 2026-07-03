import type { ExpenseShareInput } from "../contracts/schemas";

export function buildEqualExpenseShares(memberIds: string[], amountMinor: number): ExpenseShareInput[] {
  if (memberIds.length === 0) return [];

  const baseAmount = Math.floor(amountMinor / memberIds.length);
  const remainder = amountMinor % memberIds.length;

  return memberIds.map((memberId, index) => ({
    member_id: memberId,
    share_type: "fixed",
    amount_minor: baseAmount + (index < remainder ? 1 : 0),
  }));
}
