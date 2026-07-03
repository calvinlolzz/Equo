export function buildEqualShareAmountsMinor(memberIds: string[], amountMinor: number): Record<string, number> {
  if (memberIds.length === 0) return {};
  const baseAmount = Math.floor(amountMinor / memberIds.length);
  const remainder = amountMinor % memberIds.length;
  const result: Record<string, number> = {};
  memberIds.forEach((memberId, index) => {
    result[memberId] = baseAmount + (index < remainder ? 1 : 0);
  });
  return result;
}

export function sumShareAmountsMinor(shareAmountsMinor: Record<string, number>): number {
  return Object.values(shareAmountsMinor).reduce((sum, value) => sum + value, 0);
}

export function getCustomSplitRemainderMinor({
  totalAmountMinor,
  shareAmountsMinor,
}: {
  totalAmountMinor: number;
  shareAmountsMinor: Record<string, number>;
}): number {
  return totalAmountMinor - sumShareAmountsMinor(shareAmountsMinor);
}

export function isCustomSplitValid({
  totalAmountMinor,
  shareAmountsMinor,
}: {
  totalAmountMinor: number;
  shareAmountsMinor: Record<string, number>;
}): boolean {
  if (Object.keys(shareAmountsMinor).length === 0) return false;
  return getCustomSplitRemainderMinor({ totalAmountMinor, shareAmountsMinor }) === 0;
}
