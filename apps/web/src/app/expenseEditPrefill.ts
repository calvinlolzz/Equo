import type { Expense } from "./appTypes";

export type ExpenseEditPrefill = {
  title: string;
  category: string;
  currency: string;
  amount: string;
  exchangeRate: string;
  payerId: string;
  shareMemberIds: string[];
  isCustomSplit: boolean;
  shareAmounts: Record<string, string>;
  imageDataUrl: string;
  note: string;
  dateTimeIso: string;
};

function minorToAmountString(amountMinor: number): string {
  const value = amountMinor / 100;
  return (Math.round(value * 100) / 100).toString();
}

export function buildExpenseEditPrefill(expense: Expense, groupCurrency: string): ExpenseEditPrefill {
  const currency = expense.sourceCurrency || groupCurrency;
  const amountMinor = expense.sourceCurrency ? expense.sourceAmountMinor ?? expense.amountMinor : expense.amountMinor;
  const shareAmounts: Record<string, string> = {};
  if (expense.shareAmountsMinor) {
    expense.shareMemberIds.forEach((id) => {
      shareAmounts[id] = minorToAmountString(expense.shareAmountsMinor?.[id] ?? 0);
    });
  }

  return {
    title: expense.title,
    category: expense.category ?? "general",
    currency,
    amount: minorToAmountString(amountMinor),
    exchangeRate: expense.exchangeRate ? expense.exchangeRate.toString() : "1",
    payerId: expense.payerId,
    shareMemberIds: expense.shareMemberIds,
    isCustomSplit: Boolean(expense.shareAmountsMinor),
    shareAmounts,
    imageDataUrl: expense.imageDataUrl ?? "",
    note: expense.note ?? "",
    dateTimeIso: expense.createdAt,
  };
}
