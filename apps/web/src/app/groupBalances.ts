import type { Expense, Member } from "./appTypes";
import { getMemberShareMinor } from "./expenseShareSplit";

export function computeMemberBalances(members: Member[], expenses: Expense[]): Map<string, number> {
  const balances = new Map<string, number>();
  members.forEach((member) => balances.set(member.id, 0));

  expenses.forEach((expense) => {
    balances.set(expense.payerId, (balances.get(expense.payerId) ?? 0) + expense.amountMinor);
    members.forEach((member) => {
      const share = getMemberShareMinor(expense, member.id);
      if (share === 0) return;
      balances.set(member.id, (balances.get(member.id) ?? 0) - share);
    });
  });

  return balances;
}
