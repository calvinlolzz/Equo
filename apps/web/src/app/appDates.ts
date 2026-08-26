import { ACTIVE_LOCALE } from "./uiText";
import { dayHeading } from "./i18n/format";
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
