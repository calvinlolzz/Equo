import { isCustomSplitValid } from "./expenseShareSplit";

export function canSubmitExpenseDraft({
  amount,
  selectedShareMemberCount,
  isCustomSplit,
  totalAmountMinor,
  shareAmountsMinor,
}: {
  amount: string;
  selectedShareMemberCount: number;
  isCustomSplit?: boolean;
  totalAmountMinor?: number;
  shareAmountsMinor?: Record<string, number>;
}) {
  if (!(Number(amount) > 0) || selectedShareMemberCount <= 0) return false;
  if (isCustomSplit) {
    return isCustomSplitValid({
      totalAmountMinor: totalAmountMinor ?? 0,
      shareAmountsMinor: shareAmountsMinor ?? {},
    });
  }
  return true;
}
