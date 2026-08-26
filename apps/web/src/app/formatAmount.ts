import { ACTIVE_LOCALE } from "./uiText.js";
/**
 * Currency-aware replacement for the old per-file `formatTwd`/`formatSigned`
 * copies (App.tsx, ExpenseComposerSheet.tsx, ExpenseDetailDialog.tsx all had
 * their own byte-identical TWD-only copy). Every call site now passes the
 * currency that actually applies at that point - the group's currency for
 * group-level amounts, or the expense's own currency where a specific
 * expense's amount is being displayed (in practice these are almost always
 * the same value today, since the composer converts everything into the
 * group currency before submit, but keeping the distinction explicit avoids
 * silently hard-coding TWD/group currency assumptions into a shared helper).
 *
 * Formatting rules:
 * - Whole amounts show no cents ($100, not $100.00) - the common case, and
 *   the clean look the app has always had.
 * - Amounts with a fractional part show exactly two decimals ($33.34). This
 *   matters for uneven splits: $100 / 3 stores as 3334 / 3333 / 3333 minor,
 *   and rounding each to $33 made three shares look like $99 - as if a dollar
 *   had vanished. Showing the real $33.34 / $33.33 keeps the on-screen total
 *   honest. (See the review report's issue ③.)
 * - thousands separators from the active locale. Both shipped locales group
 *   in threes with a comma, so this is a no-op today; it is here so a locale
 *   that groups differently is a translation, not a bug.
 */
const CURRENCY_SYMBOLS: Record<string, string> = {
  TWD: "$",
  USD: "$",
  EUR: "€",
  JPY: "¥",
  KRW: "₩",
};

function currencyPrefix(currency: string): string {
  return CURRENCY_SYMBOLS[currency] ?? `${currency} `;
}

export function formatAmount(amountMinor: number, currency: string): string {
  const hasCents = amountMinor % 100 !== 0;
  const formatted = (amountMinor / 100).toLocaleString(ACTIVE_LOCALE, {
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: hasCents ? 2 : 0,
  });
  return `${currencyPrefix(currency)}${formatted}`;
}

export function formatSigned(amountMinor: number, currency: string): string {
  if (amountMinor > 0) return `+${formatAmount(amountMinor, currency)}`;
  if (amountMinor < 0) return `-${formatAmount(Math.abs(amountMinor), currency)}`;
  return formatAmount(0, currency);
}

/**
 * Sanitizes raw amount-input keystrokes to a clean numeric string (digits
 * and at most one decimal point) that Number() can parse. Commas and any
 * other characters the display grouping adds are stripped here, so the
 * stored composer amount is always comma-free.
 */
export function stripAmountInput(value: string): string {
  const cleaned = value.replace(/[^\d.]/g, "");
  const firstDot = cleaned.indexOf(".");
  if (firstDot === -1) return cleaned;
  return cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, "");
}

/**
 * Groups the integer part of a clean amount string with thousands
 * separators for display in the amount input, preserving a trailing "."
 * and any decimals exactly as typed so the caret behaviour stays sane.
 */
export function formatAmountInputDisplay(value: string): string {
  if (value === "") return "";
  const dot = value.indexOf(".");
  const intPart = dot === -1 ? value : value.slice(0, dot);
  const fraction = dot === -1 ? "" : value.slice(dot + 1);
  const grouped = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return dot === -1 ? grouped : `${grouped}.${fraction}`;
}
