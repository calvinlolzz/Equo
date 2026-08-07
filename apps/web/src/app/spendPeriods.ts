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
    if (key === String(year)) return "今年";
    if (key === String(year - 1)) return "去年";
    return key;
  }

  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  if (key === monthKey(currentYear, currentMonth)) return "本月";
  // Previous month, rolling back over a year boundary (2026-01 -> 2025-12).
  const previous = currentMonth === 1 ? monthKey(currentYear - 1, 12) : monthKey(currentYear, currentMonth - 1);
  if (key === previous) return "上個月";

  const parsed = parseMonthKey(key);
  if (!parsed) return key;
  return parsed.year === currentYear ? `${parsed.month}月` : `${parsed.year}/${String(parsed.month).padStart(2, "0")}`;
}

/** The heading above the period total, e.g. "2026 總計" / "2026年8月 總計". */
export function formatPeriodTitle(kind: SpendPeriodKind, key: string | null): string {
  if (!key) return "總計";
  if (kind === "year") return `${key} 總計`;
  const parsed = parseMonthKey(key);
  return parsed ? `${parsed.year}年${parsed.month}月 總計` : `${key} 總計`;
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
