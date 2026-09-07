import { ACTIVE_LOCALE, dictionaryFor } from "./uiText";
import { dayHeading, monthDayLabel } from "./i18n/format";
import type { Locale } from "./i18n/locale";
/** Local-timezone YYYY-MM-DD key for a timestamp - matches the server's spend_by_day day keys. */
export function dateKey(value: string) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Today plus the 7 preceding days, oldest first - the home date chips and spend chart share this. */
export function lastEightDays() {
  const days: { key: string; day: number; month: number }[] = [];
  for (let offset = 7; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    days.push({ key: dateKey(date.toISOString()), day: date.getDate(), month: date.getMonth() + 1 });
  }
  return days;
}

/** Day-group heading for the records list, e.g. "7月13日 · 週一". */
export function formatDayLabel(value: string, locale: Locale = ACTIVE_LOCALE) {
  return dayHeading(new Date(value), locale);
}

/** Compact MM/DD HH:mm stamp for activity and settlement rows. */
export function formatActivityTime(value: string) {
  const date = new Date(value);
  return `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")} ${String(
    date.getHours(),
  ).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/**
 * Stamp for a record row: "今天 20:00" / "昨天 20:00" / "9月3日 20:00".
 *
 * What this replaced showed the clock alone, down to the second, in hard-coded
 * zh-TW. Three problems in one line: an English reader got 「下午8:00:00」, the
 * seconds were noise nobody has ever wanted on a receipt, and a list sorted
 * newest-first across several days rendered every row as a bare time — so
 * today's ramen and last week's looked identical.
 *
 * 24-hour clock in both locales, matching formatActivityTime above; the day is
 * what carries the meaning here and the hour is only there to order the rows
 * within it.
 */
export function formatRecordStamp(value: string, locale: Locale = ACTIVE_LOCALE, now: Date = new Date()) {
  const date = new Date(value);
  const clock = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);

  const key = dateKey(value);
  const words = dictionaryFor(locale).misc;
  if (key === dateKey(now.toISOString())) return `${words.today} ${clock}`;
  if (key === dateKey(yesterday.toISOString())) return `${words.yesterday} ${clock}`;

  return `${monthDayLabel(date.getMonth() + 1, date.getDate(), locale)} ${clock}`;
}

/**
 * The 日期 field's own rendering of a datetime-local value.
 *
 * iOS Safari centres a datetime-local's value inside its box, and it does not
 * honour `text-align` on the input or on ::-webkit-date-and-time-value — tried,
 * shipped, still centred. Its shadow root positions that value itself, and the
 * only reliable way out is to stop reading the native text: the input keeps the
 * picker, this string is what a touch device actually shows. See
 * `.composer-date-display`.
 *
 * `value` is a datetime-local string ("2026-09-07T08:14"), which Date parses as
 * local time — the same clock the field is showing.
 */
export function formatDateTimeField(value: string, locale: Locale = ACTIVE_LOCALE): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";

  const clock = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  const month = date.getMonth() + 1;
  const day = date.getDate();

  if (locale === "zh-Hant") return `${date.getFullYear()}年${month}月${day}日 ${clock}`;
  return `${monthDayLabel(month, day, locale)}, ${date.getFullYear()} ${clock}`;
}
