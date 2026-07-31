import type { Expense } from "./appTypes";

export type ComposerSplitMode = "equal" | "amount" | "percent";

/**
 * Everything the composer needs to reopen an existing expense/income/
 * transfer in the right mode with the right fields filled in.
 *
 * Per-mode field semantics (mirrors ExpenseDraft's per-kind semantics):
 * - mode "expense": payerId = first payer, payments = the per-payer rows
 *   (only populated when there is more than one payer - a single payer
 *   keeps the zero-effort auto-tracking row), shareMemberIds = who owes.
 * - mode "income": payerId = the collector, shareMemberIds = the
 *   beneficiaries, shareAmounts = each beneficiary's portion.
 * - mode "transfer": payerId = sender (轉出), transferToMemberId =
 *   recipient (轉入).
 */
export type ExpenseEditPrefill = {
  mode: "expense" | "income" | "transfer";
  title: string;
  category: string;
  currency: string;
  amount: string;
  exchangeRate: string;
  payerId: string;
  shareMemberIds: string[];
  splitMode: ComposerSplitMode;
  shareAmounts: Record<string, string>;
  sharePercents: Record<string, string>;
  payments: Array<{ payerId: string; amount: string }>;
  transferToMemberId: string;
  imageUrl: string;
  note: string;
  dateTimeIso: string;
};

/**
 * The same expense as the starting point for a new one: 重複這筆.
 *
 * Everything that describes *how* the cost is shared carries over (title,
 * category, payers, split, note, currency) because that is the part nobody
 * wants to key in again for the weekly grocery run or the monthly rent. Two
 * things deliberately do not:
 *
 * - the timestamp, which becomes now - a duplicate is a thing that happened
 *   today, and silently re-filing it under the original's date would put it in
 *   the wrong month's total;
 * - the receipt photo, which is evidence of one specific transaction and would
 *   be a lie attached to a different one.
 *
 * The exchange rate does carry over, but the composer refreshes it from
 * today's rates for anything that is not an edit (see ExpenseComposerSheet).
 */
export function buildExpenseDuplicatePrefill(
  expense: Expense,
  groupCurrency: string,
  nowIso: string,
): ExpenseEditPrefill {
  return {
    ...buildExpenseEditPrefill(expense, groupCurrency),
    dateTimeIso: nowIso,
    imageUrl: "",
  };
}

function minorToAmountString(amountMinor: number): string {
  const value = amountMinor / 100;
  return (Math.round(value * 100) / 100).toString();
}

export function buildExpenseEditPrefill(expense: Expense, groupCurrency: string): ExpenseEditPrefill {
  const currency = expense.sourceCurrency || groupCurrency;
  const amountMinor = expense.sourceCurrency ? expense.sourceAmountMinor ?? expense.amountMinor : expense.amountMinor;

  const base = {
    title: expense.title,
    category: expense.category ?? "general",
    currency,
    amount: minorToAmountString(amountMinor),
    exchangeRate: expense.exchangeRate ? expense.exchangeRate.toString() : "1",
    imageUrl: expense.imageUrl ?? "",
    note: expense.note ?? "",
    dateTimeIso: expense.createdAt,
  };

  if (expense.kind === "settlement") {
    return {
      ...base,
      mode: "transfer",
      payerId: expense.payerId,
      transferToMemberId: expense.transferToMemberId ?? expense.shareMemberIds[0] ?? "",
      shareMemberIds: expense.shareMemberIds,
      splitMode: "equal",
      shareAmounts: {},
      sharePercents: {},
      payments: [],
    };
  }

  if (expense.kind === "income") {
    // Agreed income encoding: payments = the beneficiaries' portions,
    // shares = [collector, full amount]. Reopen with the collector selected
    // and the beneficiary amounts as a custom (amount) split. Percent-split
    // incomes reopen as amounts: the wire format has no share_value slot on
    // expense_payments, so the original percents are not recoverable.
    const payments = expense.payments ?? [];
    const shareAmounts: Record<string, string> = {};
    payments.forEach((payment) => {
      shareAmounts[payment.payerId] = minorToAmountString(payment.amountMinor);
    });
    return {
      ...base,
      mode: "income",
      payerId: expense.shareMemberIds[0] ?? "",
      shareMemberIds: payments.map((payment) => payment.payerId),
      splitMode: payments.length > 0 ? "amount" : "equal",
      shareAmounts,
      sharePercents: {},
      payments: [],
      transferToMemberId: "",
    };
  }

  const shareAmounts: Record<string, string> = {};
  if (expense.shareAmountsMinor) {
    expense.shareMemberIds.forEach((id) => {
      shareAmounts[id] = minorToAmountString(expense.shareAmountsMinor?.[id] ?? 0);
    });
  }

  const sharePercents: Record<string, string> = {};
  if (expense.sharePercents) {
    expense.shareMemberIds.forEach((id) => {
      const percent = expense.sharePercents?.[id];
      if (typeof percent === "number") sharePercents[id] = percent.toString();
    });
  }

  const isPercent = expense.shareType === "percent" && Object.keys(sharePercents).length > 0;
  const payments =
    expense.payments && expense.payments.length > 1
      ? expense.payments.map((payment) => ({ payerId: payment.payerId, amount: minorToAmountString(payment.amountMinor) }))
      : [];

  return {
    ...base,
    mode: "expense",
    payerId: expense.payerId,
    shareMemberIds: expense.shareMemberIds,
    splitMode: isPercent ? "percent" : expense.shareAmountsMinor ? "amount" : "equal",
    shareAmounts,
    sharePercents,
    payments,
    transferToMemberId: "",
  };
}
