import type { ComposerSplitMode } from "./expenseEditPrefill";
import { isCustomSplitValid, isPaymentsSplitValid, isPercentSplitValid } from "./expenseShareSplit";

/**
 * Gating for the expense/income composer modes. On top of the original
 * amount/member checks:
 * - splitMode "amount" (or legacy isCustomSplit) requires the custom share
 *   amounts to sum exactly to the total.
 * - splitMode "percent" requires the percents to sum to exactly 100 with
 *   every included member above 0.
 * - paymentAmountsMinor (present only when the composer shows more than one
 *   payer row) requires the payments to sum exactly to the total with every
 *   row a positive amount - mirroring validation.ts's positive-integer rule
 *   for expense_payments.
 */
export function canSubmitExpenseDraft({
  amount,
  selectedShareMemberCount,
  isCustomSplit,
  totalAmountMinor,
  shareAmountsMinor,
  splitMode,
  shareMemberIds,
  sharePercents,
  paymentAmountsMinor,
}: {
  amount: string;
  selectedShareMemberCount: number;
  isCustomSplit?: boolean;
  totalAmountMinor?: number;
  shareAmountsMinor?: Record<string, number>;
  splitMode?: ComposerSplitMode;
  shareMemberIds?: string[];
  sharePercents?: Record<string, number>;
  paymentAmountsMinor?: Record<string, number>;
}) {
  if (!(Number(amount) > 0) || selectedShareMemberCount <= 0) return false;

  if (
    paymentAmountsMinor &&
    !isPaymentsSplitValid({ totalAmountMinor: totalAmountMinor ?? 0, paymentAmountsMinor })
  ) {
    return false;
  }

  const effectiveSplitMode: ComposerSplitMode = splitMode ?? (isCustomSplit ? "amount" : "equal");
  if (effectiveSplitMode === "amount") {
    return isCustomSplitValid({
      totalAmountMinor: totalAmountMinor ?? 0,
      shareAmountsMinor: shareAmountsMinor ?? {},
    });
  }
  if (effectiveSplitMode === "percent") {
    return isPercentSplitValid(shareMemberIds ?? [], sharePercents ?? {});
  }
  return true;
}

/**
 * Gating for the transfer composer mode: a positive amount and two
 * DIFFERENT members (validation.ts requires transfer_to_member_id, and a
 * self-transfer is meaningless - it would net to zero anyway).
 */
export function canSubmitTransferDraft({
  amount,
  fromMemberId,
  toMemberId,
}: {
  amount: string;
  fromMemberId: string;
  toMemberId: string;
}) {
  if (!(Number(amount) > 0)) return false;
  if (!fromMemberId || !toMemberId) return false;
  return fromMemberId !== toMemberId;
}
