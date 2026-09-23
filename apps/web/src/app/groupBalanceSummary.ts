import type { Group } from "./appTypes";
import { formatAmount } from "./formatAmount";
import { isPersonalGroup } from "./personalLedger";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

export type CurrencyTotal = {
  currency: string;
  /** Positive = owed to the user, negative = owed by them. Never zero. */
  netMinor: number;
};

export type GroupBalanceSummary = {
  /**
   * Whether any group in the list carried a balance at all. False means the
   * server did not send them (an old deployment, a failed decoration) - which
   * has to render as nothing, never as 已結清.
   */
  known: boolean;
  /** Non-zero nets per currency, largest first. Empty when everything nets out. */
  totals: CurrencyTotal[];
};

/**
 * "Do I owe anything, across everything?" - the one number a split-bill app is
 * expected to open on.
 *
 * Kept per currency and never summed across them. A trip group in JPY and a
 * flat-share in TWD have no common total, and inventing one by adding minor
 * units would produce a confident, meaningless number - the exchange rate at
 * the time each expense was recorded is already baked into each group's own
 * currency, and nothing here knows today's.
 */
export function summarizeGroupBalances(groups: Group[]): GroupBalanceSummary {
  const netByCurrency = new Map<string, number>();
  let known = false;

  groups.forEach((group) => {
    // A personal ledger has nobody else to owe or be owed by - it always
    // nets to zero, and folding that zero in here would read as "you have
    // settled up everywhere" the moment the only group left is the ledger,
    // which is not what "known" is meant to promise.
    if (isPersonalGroup(group)) return;
    if (group.balanceMinor === undefined) return;
    known = true;
    netByCurrency.set(group.currency, (netByCurrency.get(group.currency) ?? 0) + group.balanceMinor);
  });

  const totals = [...netByCurrency.entries()]
    .filter(([, netMinor]) => netMinor !== 0)
    .map(([currency, netMinor]) => ({ currency, netMinor }))
    .sort((left, right) => Math.abs(right.netMinor) - Math.abs(left.netMinor));

  return { known, totals };
}

/**
 * One balance as a phrase: 「應收 $300」/「應付 $300」/「已結清」.
 *
 * A signed number alone (-$300) does not say which way it points - people read
 * their own balance as "what I owe" about as often as "what I am owed", and
 * getting it backwards is the one mistake this screen cannot afford. Returns
 * null when the balance is unknown, so callers render nothing.
 */
export function describeBalance(balanceMinor: number | undefined, currency: string): string | null {
  if (balanceMinor === undefined) return null;
  if (balanceMinor === 0) return text.balanceSettled;

  const amount = formatAmount(Math.abs(balanceMinor), currency);
  return balanceMinor > 0 ? `${text.balanceOwedToYou} ${amount}` : `${text.balanceYouOwe} ${amount}`;
}

/**
 * One member's balance as a phrase, for a row that is not the reader's own:
 * 「應收 $300」/「應付 $300」/「已結清」.
 *
 * `isSelf` switches to the you-variants (應收/應付 read the same in zh, but
 * the English strings differ - "Gets back"/"Owes" is about a third person,
 * "Owed to you"/"You owe" is about the reader). A signed number alone does
 * not say which way it points, which is exactly what describeBalance above
 * exists to fix for the reader's own balance - this is the same fix for
 * everyone else's row.
 */
export function describeMemberBalance(balanceMinor: number, currency: string, isSelf: boolean): string {
  if (balanceMinor === 0) return text.balanceSettled;

  const amount = formatAmount(Math.abs(balanceMinor), currency);
  if (isSelf) {
    return balanceMinor > 0 ? `${text.balanceOwedToYou} ${amount}` : `${text.balanceYouOwe} ${amount}`;
  }
  return balanceMinor > 0 ? `${text.memberGetsBack} ${amount}` : `${text.memberOwes} ${amount}`;
}

/** "positive" | "negative" | "settled" | null - drives the row's colour. */
export function balanceTone(balanceMinor: number | undefined): "positive" | "negative" | "settled" | null {
  if (balanceMinor === undefined) return null;
  if (balanceMinor > 0) return "positive";
  if (balanceMinor < 0) return "negative";
  return "settled";
}
