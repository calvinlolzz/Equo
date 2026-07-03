import type { Expense, Member } from "./appTypes";
import { buildEqualExpenseShares } from "./expenseSplit";

export function computeMemberBalances(members: Member[], expenses: Expense[]): Map<string, number> {
  const balances = new Map<string, number>();
  members.forEach((member) => balances.set(member.id, 0));

  expenses.forEach((expense) => {
    balances.set(expense.payerId, (balances.get(expense.payerId) ?? 0) + expense.amountMinor);
    const shares = buildEqualExpenseShares(expense.shareMemberIds, expense.amountMinor);
    shares.forEach((share) => {
      balances.set(share.member_id, (balances.get(share.member_id) ?? 0) - share.amount_minor);
    });
  });

  return balances;
}
