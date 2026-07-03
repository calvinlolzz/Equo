export function canSubmitExpenseDraft({
  amount,
  selectedShareMemberCount,
}: {
  amount: string;
  selectedShareMemberCount: number;
}) {
  return Number(amount) > 0 && selectedShareMemberCount > 0;
}
