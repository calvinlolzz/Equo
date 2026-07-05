import type { Expense, Member } from "./appTypes";
import { getMemberShareMinor } from "./expenseShareSplit";

/**
 * Credits each payment to its respective payer. When expense.payments is
 * present (multi-payer expense, or an income entry's beneficiary payments
 * encoded as payments per the agreed sign semantics), every payer/beneficiary
 * in the array is credited their exact amount. Otherwise falls back to the
 * existing single payerId + full amountMinor behavior.
 *
 * No kind-special-casing is needed here: an income expense is encoded with
 * expense_shares = [{collector, full amount}] (subtracted below via
 * getMemberShareMinor) and expense_payments = one entry per beneficiary
 * (credited here), so the collector's balance goes negative and
 * beneficiaries' balances go positive purely from the existing signs.
 */
function creditPayments(balances: Map<string, number>, expense: Expense) {
  if (expense.payments && expense.payments.length > 0) {
    expense.payments.forEach((payment) => {
      balances.set(payment.payerId, (balances.get(payment.payerId) ?? 0) + payment.amountMinor);
    });
    return;
  }
  balances.set(expense.payerId, (balances.get(expense.payerId) ?? 0) + expense.amountMinor);
}

export function computeMemberBalances(members: Member[], expenses: Expense[]): Map<string, number> {
  const balances = new Map<string, number>();
  members.forEach((member) => balances.set(member.id, 0));

  expenses.forEach((expense) => {
    creditPayments(balances, expense);
    members.forEach((member) => {
      const share = getMemberShareMinor(expense, member.id);
      if (share === 0) return;
      balances.set(member.id, (balances.get(member.id) ?? 0) - share);
    });
  });

  return balances;
}
