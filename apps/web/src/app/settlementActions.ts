/**
 * Two things you can do with a debt that the app could not do before: pay part
 * of it, and pay it to somebody the suggestions did not name.
 */

/** A settlement waiting to be recorded: who pays whom, and how much. */
export type SettlementIntent = {
  fromMemberId: string;
  toMemberId: string;
  amountMinor: number;
};

/**
 * The amount typed into the settle confirm, in minor units.
 *
 * `valid` rather than a thrown error or a silent zero, because this drives a
 * disabled button: an empty field while somebody is still typing is not a
 * mistake to shout about, it is just not ready.
 *
 * Over-payment is refused rather than clamped. Paying more than the balance is
 * a real thing — it just is not a *settlement*, it is a loan in the other
 * direction, and silently trimming it to the balance would record something
 * other than what happened. The composer's 轉帳 mode takes any amount in any
 * direction, which is the honest place for that.
 */
export function parseSettleAmountMinor(input: string, maxMinor: number): { minor: number; valid: boolean } {
  // Commas come back from the formatted display; a full-width digit or 元 sign
  // comes from a phone keyboard.
  const cleaned = input.replace(/[,\s]/g, "").replace(/[０-９]/g, (digit) => String.fromCharCode(digit.charCodeAt(0) - 0xfee0));

  if (cleaned === "") return { minor: 0, valid: false };
  if (!/^\d*\.?\d*$/.test(cleaned)) return { minor: 0, valid: false };

  const value = Number(cleaned);
  if (!Number.isFinite(value)) return { minor: 0, valid: false };

  const minor = Math.round(value * 100);
  return { minor, valid: minor > 0 && minor <= maxMinor };
}

/** The amount as it goes into the input when the dialog opens. */
export function settleAmountInputValue(amountMinor: number): string {
  const value = amountMinor / 100;
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

/**
 * What settling directly between two members would mean.
 *
 * There is no pairwise ledger here — a member's balance is their net against
 * the whole group — so "what I owe you" is not a stored fact. What IS
 * well-defined is the transfer that clears as much as possible between the
 * two of us without touching anybody else: whoever is negative pays whoever is
 * positive, up to the smaller of the two.
 *
 * That is the same greedy step calculateSettlement takes, which is why a pair
 * it happens to name comes out at the same number. The difference is that this
 * one is reachable for a pair the minimal-transfer set skipped — A owing B is
 * often routed as A → C, and "I want to pay Bob back" is a thing people say
 * about Bob rather than about the graph.
 *
 * Returns null when there is nothing to settle: same sign, or either side flat.
 */
export function settlementBetween(
  a: { id: string; balanceMinor: number },
  b: { id: string; balanceMinor: number },
): SettlementIntent | null {
  if (a.id === b.id) return null;
  if (a.balanceMinor === 0 || b.balanceMinor === 0) return null;
  // Both owed, or both owing: nothing passes between these two.
  if (a.balanceMinor > 0 === b.balanceMinor > 0) return null;

  const payer = a.balanceMinor < 0 ? a : b;
  const payee = a.balanceMinor < 0 ? b : a;
  const amountMinor = Math.min(Math.abs(payer.balanceMinor), payee.balanceMinor);

  if (amountMinor <= 0) return null;

  return { fromMemberId: payer.id, toMemberId: payee.id, amountMinor };
}
