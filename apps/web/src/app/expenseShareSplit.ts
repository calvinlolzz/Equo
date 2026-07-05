import type { Expense } from "./appTypes";

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

export function getMemberShareMinor(
  expense: Pick<Expense, "amountMinor" | "shareMemberIds" | "shareAmountsMinor">,
  memberId: string,
): number {
  if (!expense.shareMemberIds.includes(memberId)) return 0;
  if (expense.shareAmountsMinor) {
    return expense.shareAmountsMinor[memberId] ?? 0;
  }
  const equalShares = buildEqualShareAmountsMinor(expense.shareMemberIds, expense.amountMinor);
  return equalShares[memberId] ?? 0;
}

/**
 * Allocates totalMinor across memberIds by percent using the largest-
 * remainder method, so the allocated amounts always sum EXACTLY to
 * totalMinor (no off-by-one drift from independently rounding each
 * member's percent share).
 *
 * Algorithm: give each member floor(totalMinor * percent / 100), then
 * distribute the leftover minor units (totalMinor - sum of floors) one at a
 * time to the members with the largest fractional remainder, breaking ties
 * by memberIds order (stable/deterministic).
 */
export function buildPercentShareAmounts(
  memberIds: string[],
  percents: Record<string, number>,
  totalMinor: number,
): Record<string, number> {
  if (memberIds.length === 0) return {};

  const exact = memberIds.map((memberId) => {
    const percent = percents[memberId] ?? 0;
    const raw = (totalMinor * percent) / 100;
    return { memberId, floor: Math.floor(raw), remainder: raw - Math.floor(raw) };
  });

  const result: Record<string, number> = {};
  exact.forEach(({ memberId, floor }) => {
    result[memberId] = floor;
  });

  const flooredTotal = exact.reduce((sum, entry) => sum + entry.floor, 0);
  let leftover = totalMinor - flooredTotal;

  const byRemainderDesc = [...exact].sort((a, b) => b.remainder - a.remainder);
  for (const entry of byRemainderDesc) {
    if (leftover <= 0) break;
    result[entry.memberId] += 1;
    leftover -= 1;
  }

  return result;
}

const PERCENT_TOTAL_TOLERANCE = 1e-9;

/**
 * Validates a percent-mode split per the agreed rule: percents must sum to
 * exactly 100 (within floating point tolerance) and each member's percent
 * must be greater than 0. validation.ts itself has no percent-specific
 * checks (it only ever reconciles amount_minor totals), so this rule is a
 * frontend-only gate that keeps the UI from submitting a percent split the
 * user hasn't finished balancing.
 */
export function isPercentSplitValid(memberIds: string[], percents: Record<string, number>): boolean {
  if (memberIds.length === 0) return false;
  if (!memberIds.every((memberId) => (percents[memberId] ?? 0) > 0)) return false;
  const total = memberIds.reduce((sum, memberId) => sum + (percents[memberId] ?? 0), 0);
  return Math.abs(total - 100) <= PERCENT_TOTAL_TOLERANCE;
}

/**
 * Live remainder (in percentage points) versus the required 100% total, for
 * showing a "剩餘" indicator in percent-split mode alongside the existing
 * amount-based getCustomSplitRemainderMinor.
 */
export function getPercentSplitRemainder(memberIds: string[], percents: Record<string, number>): number {
  const total = memberIds.reduce((sum, memberId) => sum + (percents[memberId] ?? 0), 0);
  return 100 - total;
}

/**
 * Mirrors getCustomSplitRemainderMinor's pattern but for a multi-payer
 * payments list versus the expense total, so the composer can show a live
 * "剩餘" indicator for the payer-amount rows the same way it does for
 * custom expense shares.
 */
export function getPaymentsRemainderMinor({
  totalAmountMinor,
  paymentAmountsMinor,
}: {
  totalAmountMinor: number;
  paymentAmountsMinor: Record<string, number>;
}): number {
  return totalAmountMinor - sumShareAmountsMinor(paymentAmountsMinor);
}

/**
 * Mirrors isCustomSplitValid: gates submission until the payments sum
 * exactly matches the total amount and there's at least one payer. Unlike
 * shares (which validation.ts allows to be zero), every payment must be a
 * POSITIVE integer server-side, so each payer row must also be > 0 here.
 */
export function isPaymentsSplitValid({
  totalAmountMinor,
  paymentAmountsMinor,
}: {
  totalAmountMinor: number;
  paymentAmountsMinor: Record<string, number>;
}): boolean {
  const amounts = Object.values(paymentAmountsMinor);
  if (amounts.length === 0) return false;
  if (!amounts.every((amount) => Number.isInteger(amount) && amount > 0)) return false;
  return getPaymentsRemainderMinor({ totalAmountMinor, paymentAmountsMinor }) === 0;
}
