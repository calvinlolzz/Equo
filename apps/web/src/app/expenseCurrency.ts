import { readGroupMemory, writeGroupMemory } from "./composerMemory";

const LAST_CURRENCY_KEY = "equo.clean.last_currency";

type CurrencyStorage = Pick<Storage, "getItem" | "setItem">;

/**
 * The currency this group's last expense was entered in.
 *
 * Per group, not global: someone can be in a Tokyo trip group and a rent group
 * in the same week, and the right default in one is the wrong one in the other.
 * A miss just falls back to the group currency, which is what the composer did
 * before this existed.
 *
 * The storage mechanics moved to composerMemory.ts when the category grew the
 * same memory — one copy of "a map of groupId to a string, and never throw".
 */
export function readLastCurrency(groupId: string, storage?: CurrencyStorage | null): string {
  return storage === undefined
    ? readGroupMemory(LAST_CURRENCY_KEY, groupId)
    : readGroupMemory(LAST_CURRENCY_KEY, groupId, storage);
}

export function writeLastCurrency(groupId: string, currency: string, storage?: CurrencyStorage | null): void {
  if (storage === undefined) {
    writeGroupMemory(LAST_CURRENCY_KEY, groupId, currency);
    return;
  }
  writeGroupMemory(LAST_CURRENCY_KEY, groupId, currency, storage);
}

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
