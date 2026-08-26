import type { SpendBreakdown, SpendPeriodKind } from "./apiClient";
import { UI_TEXT } from "./uiText";

export type SpendComparison = {
  /** Signed percentage against the previous period, rounded to a whole number. */
  changePct: number;
  /** The period being compared against, as its key (e.g. "2026-07"). */
  previousKey: string;
  previousMinor: number;
};

/**
 * "More than last month", from data the panel already has.
 *
 * Deliberately returns null rather than a zero in three cases, because each
 * would be a different kind of lie:
 *
 *   * no previous period — a group's first month is not "up 0%"
 *   * the previous period was zero — every increase from nothing is infinite,
 *     and "+∞%" tells nobody anything
 *   * the selected period is not the newest one — the chips let you look at
 *     March, and March's neighbour is February, not "last month"
 *
 * `scope` matters: the periods list carries a group total and the caller's own
 * share, and comparing the wrong one against the headline is wrong in a way
 * that looks right.
 */
export function spendComparison(
  breakdown: SpendBreakdown | null,
  scope: "personal" | "group",
): SpendComparison | null {
  const periods = breakdown?.periods ?? [];

  if (!breakdown || periods.length < 2) return null;

  // periods is newest-first, so index 0 is the latest bucket.
  const [current, previous] = periods;

  // Only the newest period has a meaningful "last" to compare with here.
  if (breakdown.period_key !== current.key) return null;

  const pick = (entry: (typeof periods)[number]) =>
    scope === "personal" ? entry.personal_total_minor : entry.total_minor;

  const currentMinor = pick(current);
  const previousMinor = pick(previous);

  // An API without personal period totals: say nothing rather than fall back
  // to the group figure under a personal heading.
  if (currentMinor === undefined || previousMinor === undefined) return null;
  if (previousMinor <= 0) return null;

  return {
    changePct: Math.round(((currentMinor - previousMinor) / previousMinor) * 100),
    previousKey: previous.key,
    previousMinor,
  };
}

/** "比上個月多 30%" / "比上個月少 12%" / "跟上個月差不多". */
export function describeSpendComparison(
  comparison: SpendComparison,
  kind: SpendPeriodKind,
): string {
  const label = kind === "month" ? UI_TEXT.comparison.lastMonth : UI_TEXT.comparison.lastYear;
  // Under a percent either way reads as noise, not as a trend.
  if (comparison.changePct === 0) {
    return UI_TEXT.comparison.aboutTheSame.replace("{period}", label);
  }
  const template = comparison.changePct > 0 ? UI_TEXT.comparison.more : UI_TEXT.comparison.less;
  return template.replace("{period}", label).replace("{pct}", String(Math.abs(comparison.changePct)));
}
