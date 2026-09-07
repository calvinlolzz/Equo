import { dateKey } from "./app/appDates";

/**
 * The screenshot harness's fixture dates, relative to the day the screenshot is
 * taken so the home screen's date strip never reads as a group abandoned in
 * 2026.
 *
 * It lives here, and delegates, for one reason: it used to build the string
 * itself with toISOString(), which is UTC. East of Greenwich that is yesterday
 * for most of the day, so every fixture expense landed on a key the home screen
 * never looks up — 個人消費 came out $0 with an empty date strip in every asset
 * the harness has ever produced, including the ones in the install prompt.
 *
 * dateKey is the function the app keys its daily aggregates with. Calling it
 * rather than matching it is what stops the two drifting apart again.
 */
export function daysAgo(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() - days);
  return dateKey(date.toISOString());
}
