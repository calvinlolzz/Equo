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
 * Formatting rules (unchanged from the old formatTwd):
 * - amountMinor is rounded to whole units (Math.round(amountMinor / 100))
 *   before formatting - this app never shows cents.
 * - thousands separators via toLocaleString("zh-TW").
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
  return `${currencyPrefix(currency)}${Math.round(amountMinor / 100).toLocaleString("zh-TW")}`;
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
