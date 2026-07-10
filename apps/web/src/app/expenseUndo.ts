import type { Expense } from "./appTypes";
import type { ExpenseDraft } from "./ExpenseComposerSheet";

/**
 * Convert a deleted Expense back into a submittable ExpenseDraft so an undo
 * can re-create it via cloudStore.addExpense. This is the exact inverse of
 * the mapping cloudAdapters uses (toExpense on read, toCreateExpenseRequest
 * on write), so the round trip Expense -> draft -> create-request reproduces
 * the same wire shape the server originally stored. Per-kind semantics
 * mirror buildExpenseEditPrefill / draftToExpense:
 *
 * - settlement -> transfer draft: payerId = sender, transferToMemberId =
 *   recipient (falling back to shareMemberIds[0] for older data), a single
 *   full-amount share to the recipient.
 * - income: payerId = the collector (shareMemberIds[0], who holds the full
 *   share), shareMemberIds = the beneficiaries (payments' payers), and the
 *   beneficiary portions become a fixed (amount) split.
 * - expense: payer(s), split (percent keeps shareType/sharePercents, custom/
 *   equal keep the exact shareAmountsMinor the server built).
 *
 * The draft's createdAt (which toCreateExpenseRequest turns into
 * expense_date) prefers expenseDate - the user-picked date the server
 * stored - over createdAt, which for cloud-fetched expenses is the
 * INSERTION timestamp and would re-date a backdated expense to its deletion
 * day. Optimistic local expenses have no expenseDate; their createdAt IS
 * the picked date, so the fallback is exact. imageUrl (an already-uploaded
 * cloud photo URL) is preserved as-is - never imageDataUrl, which would
 * trigger a re-upload. Foreign-currency source fields are carried through
 * for fidelity, though toCreateExpenseRequest drops them for cloud sync
 * (group-currency v1).
 */
export function expenseToDraft(expense: Expense): ExpenseDraft {
  const base = {
    title: expense.title,
    amountMinor: expense.amountMinor,
    createdAt: expense.expenseDate ?? expense.createdAt,
    category: expense.category ?? "general",
    note: expense.note,
    imageUrl: expense.imageUrl,
  };

  if (expense.kind === "settlement") {
    const toId = expense.transferToMemberId ?? expense.shareMemberIds[0] ?? "";
    return {
      ...base,
      kind: "transfer",
      payerId: expense.payerId,
      shareMemberIds: [toId],
      transferToMemberId: toId,
      shareAmountsMinor: { [toId]: expense.amountMinor },
    };
  }

  if (expense.kind === "income") {
    // Income encoding: payments = the beneficiaries' portions, the single
    // share = the collector holding the full amount. Reopen with the
    // collector as payer and the beneficiary amounts as a fixed split.
    const payments = expense.payments ?? [];
    const shareAmountsMinor: Record<string, number> = {};
    payments.forEach((payment) => {
      shareAmountsMinor[payment.payerId] = payment.amountMinor;
    });
    return {
      ...base,
      kind: "income",
      payerId: expense.shareMemberIds[0] ?? "",
      shareMemberIds: payments.map((payment) => payment.payerId),
      shareType: "fixed",
      shareAmountsMinor,
    };
  }

  const draft: ExpenseDraft = {
    ...base,
    kind: "expense",
    payerId: expense.payerId,
    shareMemberIds: expense.shareMemberIds,
    shareAmountsMinor: expense.shareAmountsMinor,
  };
  if (expense.payments && expense.payments.length > 0) {
    draft.payments = expense.payments.map((payment) => ({
      payerId: payment.payerId,
      amountMinor: payment.amountMinor,
    }));
  }
  if (expense.shareType === "percent" && expense.sharePercents) {
    draft.shareType = "percent";
    draft.sharePercents = expense.sharePercents;
  }
  if (expense.sourceCurrency) {
    draft.sourceCurrency = expense.sourceCurrency;
    draft.sourceAmountMinor = expense.sourceAmountMinor;
    draft.exchangeRate = expense.exchangeRate;
  }
  return draft;
}
