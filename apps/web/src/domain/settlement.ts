import { assertSameCurrency, type CurrencyCode, type Money } from "./money.js";

export type MemberBalance = {
  memberId: string;
  balance: Money;
};

export type SettlementTransfer = {
  fromMemberId: string;
  toMemberId: string;
  amount: Money;
};

export function calculateSettlement(balances: MemberBalance[]): SettlementTransfer[] {
  const currency = assertSameCurrency(balances.map((entry) => entry.balance));
  const debtors = balances
    .filter((entry) => entry.balance.amount_minor < 0)
    .map((entry) => ({ memberId: entry.memberId, amount_minor: Math.abs(entry.balance.amount_minor) }))
    .sort((a, b) => b.amount_minor - a.amount_minor);
  const creditors = balances
    .filter((entry) => entry.balance.amount_minor > 0)
    .map((entry) => ({ memberId: entry.memberId, amount_minor: entry.balance.amount_minor }))
    .sort((a, b) => b.amount_minor - a.amount_minor);

  const transfers: SettlementTransfer[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount_minor = Math.min(debtor.amount_minor, creditor.amount_minor);

    if (amount_minor > 0) {
      transfers.push({
        fromMemberId: debtor.memberId,
        toMemberId: creditor.memberId,
        amount: { amount_minor, currency: currency as CurrencyCode },
      });
    }

    debtor.amount_minor -= amount_minor;
    creditor.amount_minor -= amount_minor;

    if (debtor.amount_minor === 0) {
      debtorIndex += 1;
    }

    if (creditor.amount_minor === 0) {
      creditorIndex += 1;
    }
  }

  return transfers;
}
