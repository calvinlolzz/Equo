import { ACTIVE_LOCALE, UI_TEXT } from "./uiText";
import { monthLabel, monthYearLabel } from "./i18n/format";
import type { SpendPeriodKind } from "./apiClient";

/**
 * Labels for the 分析 period chips. Keys are what the server buckets by:
 * "2026" for a year, "2026-08" for a month.
 *
 * The two nearest periods read as 今年/去年 and 本月/上個月 rather than as
 * bare numbers - that is the difference the eye is actually looking for in a
 * row of chips. Everything older keeps its number, and a month from another
 * year keeps that year so "12月" can never mean two different Decembers.
 */
export function formatPeriodChipLabel(kind: SpendPeriodKind, key: string, now = new Date()): string {
  if (kind === "year") {
    const year = now.getFullYear();
    if (key === String(year)) return UI_TEXT.periods.thisYear;
    if (key === String(year - 1)) return UI_TEXT.periods.lastYear;
    return key;
  }

  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  if (key === monthKey(currentYear, currentMonth)) return UI_TEXT.periods.thisMonth;
  // Previous month, rolling back over a year boundary (2026-01 -> 2025-12).
  const previous = currentMonth === 1 ? monthKey(currentYear - 1, 12) : monthKey(currentYear, currentMonth - 1);
  if (key === previous) return UI_TEXT.periods.lastMonth;

  const parsed = parseMonthKey(key);
  if (!parsed) return key;
  return parsed.year === currentYear
    ? monthLabel(parsed.month, ACTIVE_LOCALE, UI_TEXT.periods.monthSuffix)
    : `${parsed.year}/${String(parsed.month).padStart(2, "0")}`;
}

/** The heading above the period total, e.g. "2026 總計" / "2026年8月 總計". */
export function formatPeriodTitle(kind: SpendPeriodKind, key: string | null): string {
  const total = UI_TEXT.periods.total;
  if (!key) return total;
  if (kind === "year") return `${key} ${total}`;
  const parsed = parseMonthKey(key);
  return parsed ? `${monthYearLabel(parsed.year, parsed.month, ACTIVE_LOCALE)} ${total}` : `${key} ${total}`;
}

function monthKey(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function parseMonthKey(key: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(key);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year: Number(match[1]), month };
}
