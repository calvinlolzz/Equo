import type { Locale } from "./locale";

/**
 * The locale-aware bits of formatting that are not just a string swap.
 *
 * Month and weekday names come from Intl rather than a hand-kept table: it is
 * already in every browser, it is right for languages nobody here has thought
 * about yet, and a table of seven weekday names per locale is exactly the kind
 * of thing that goes stale when a language is added.
 *
 * The Chinese output is deliberately produced by hand rather than by Intl. Its
 * exact shape ("7月13日 · 週一") is what the app has always shown and what its
 * tests assert; letting Intl decide would quietly change punctuation and
 * spacing on the locale that is already shipped, to no one's benefit.
 */

const CJK_WEEKDAYS = ["週日", "週一", "週二", "週三", "週四", "週五", "週六"];

function intl(locale: Locale, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(locale, options);
}

/** "8月" / "Aug". */
export function monthLabel(month: number, locale: Locale, monthSuffix: string): string {
  if (locale === "zh-Hant") return `${month}${monthSuffix}`;
  // Any year works - only the month name is read out of it.
  return intl(locale, { month: "short" }).format(new Date(2026, month - 1, 1));
}

/** "8月13日" / "13 Aug", for the home screen date strip. */
export function monthDayLabel(month: number, day: number, locale: Locale): string {
  if (locale === "zh-Hant") return `${month}月${day}日`;
  return intl(locale, { day: "numeric", month: "short" }).format(new Date(2026, month - 1, day));
}

/** "2026年8月" / "August 2026", for a period heading. */
export function monthYearLabel(year: number, month: number, locale: Locale): string {
  if (locale === "zh-Hant") return `${year}年${month}月`;
  return intl(locale, { month: "long", year: "numeric" }).format(new Date(year, month - 1, 1));
}

/** Day-group heading for the records list: "7月13日 · 週一" / "13 Jul · Mon". */
export function dayHeading(date: Date, locale: Locale): string {
  if (locale === "zh-Hant") {
    return `${date.getMonth() + 1}月${date.getDate()}日 · ${CJK_WEEKDAYS[date.getDay()]}`;
  }
  const day = intl(locale, { day: "numeric", month: "short" }).format(date);
  const weekday = intl(locale, { weekday: "short" }).format(date);
  return `${day} · ${weekday}`;
}

/**
 * Thousands separators for a bare number.
 *
 * Both shipped locales group in threes with a comma, so this changes nothing
 * today - it exists so that adding a locale that does not (de-DE, fr-FR) is a
 * dictionary entry rather than a bug report about amounts.
 */
export function groupNumber(value: number, locale: Locale, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString(locale, options);
}
