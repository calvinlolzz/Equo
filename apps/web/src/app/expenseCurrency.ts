export function convertToGroupAmountMinor({
  amount,
  exchangeRate,
}: {
  amount: string | number;
  exchangeRate: string | number;
}): number {
  const amountValue = Number(amount);
  const rateValue = Number(exchangeRate);
  if (!Number.isFinite(amountValue) || !Number.isFinite(rateValue)) return 0;
  return Math.round(amountValue * rateValue * 100);
}
