const LAST_CURRENCY_KEY = "equo.clean.last_currency";

type CurrencyStorage = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): CurrencyStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

/**
 * The currency this group's last expense was entered in.
 *
 * Per group, not global: someone can be in a Tokyo trip group and a rent group
 * in the same week, and the right default in one is the wrong one in the other.
 * A miss just falls back to the group currency, which is what the composer did
 * before this existed.
 */
export function readLastCurrency(groupId: string, storage: CurrencyStorage | null = browserStorage()): string {
  if (!storage || !groupId) return "";
  try {
    const raw = storage.getItem(LAST_CURRENCY_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const value = parsed?.[groupId];
    return typeof value === "string" ? value : "";
  } catch {
    return "";
  }
}

export function writeLastCurrency(
  groupId: string,
  currency: string,
  storage: CurrencyStorage | null = browserStorage(),
): void {
  if (!storage || !groupId || !currency) return;
  try {
    const raw = storage.getItem(LAST_CURRENCY_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    const entries = parsed && typeof parsed === "object" ? parsed : {};
    storage.setItem(LAST_CURRENCY_KEY, JSON.stringify({ ...entries, [groupId]: currency }));
  } catch {
    // Remembering the currency is a convenience; a full localStorage must not
    // take the expense down with it.
  }
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
