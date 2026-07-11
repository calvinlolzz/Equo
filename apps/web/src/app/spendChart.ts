export type SpendChartDay = { key: string; day: number; month: number };
export type SpendByDayEntry = { day: string; totalMinor: number };

export type SpendChartBar = {
  key: string;
  /** Axis label, e.g. "7/11". */
  label: string;
  totalMinor: number;
  x: number;
  barWidth: number;
  yTop: number;
  barHeight: number;
  centerX: number;
  /** Full-band hit-target x (wider than the visible bar, for taps). */
  bandX: number;
  bandWidth: number;
};

export type SpendChartLayout = {
  bars: SpendChartBar[];
  maxMinor: number;
  width: number;
  height: number;
  /** y of the baseline the bars sit on. */
  plotBottom: number;
};

export const SPEND_CHART_DEFAULTS = {
  width: 320,
  height: 150,
  /** Reserved above the tallest bar for the selected-value label. */
  topZone: 26,
  /** Reserved under the baseline for day labels. */
  labelZone: 22,
  /** Visible bar width as a fraction of the per-day band. */
  barRatio: 0.55,
  /** Bars representing a non-zero value never collapse below this. */
  minBarHeight: 3,
} as const;

/**
 * Pure layout for the 近 8 日支出 bar chart: one band per day, bar heights
 * proportional to the max day total. Days with no spendByDay entry are zero.
 * All-zero data yields bars of height 0 (the component renders an empty
 * state instead of an empty plot).
 */
export function buildSpendChart(
  days: SpendChartDay[],
  spendByDay: SpendByDayEntry[],
  options: Partial<typeof SPEND_CHART_DEFAULTS> = {},
): SpendChartLayout {
  const { width, height, topZone, labelZone, barRatio, minBarHeight } = {
    ...SPEND_CHART_DEFAULTS,
    ...options,
  };

  const totals = new Map(spendByDay.map((entry) => [entry.day, entry.totalMinor]));
  const maxMinor = days.reduce((max, day) => Math.max(max, totals.get(day.key) ?? 0), 0);

  const plotBottom = height - labelZone;
  const plotHeight = plotBottom - topZone;
  const bandWidth = width / Math.max(days.length, 1);
  const barWidth = bandWidth * barRatio;

  const bars = days.map((day, index) => {
    const totalMinor = totals.get(day.key) ?? 0;
    const rawHeight = maxMinor === 0 ? 0 : (totalMinor / maxMinor) * plotHeight;
    const barHeight = totalMinor > 0 ? Math.max(rawHeight, minBarHeight) : 0;
    const bandX = index * bandWidth;
    const x = bandX + (bandWidth - barWidth) / 2;

    return {
      key: day.key,
      label: `${day.month}/${day.day}`,
      totalMinor,
      x,
      barWidth,
      yTop: plotBottom - barHeight,
      barHeight,
      centerX: bandX + bandWidth / 2,
      bandX,
      bandWidth,
    };
  });

  return { bars, maxMinor, width, height, plotBottom };
}

/**
 * SVG path for a bar with rounded TOP corners only, anchored flat on the
 * baseline. Falls back to square corners when the bar is shorter than the
 * radius (a rounded cap taller than the bar would invert).
 */
export function roundedBarPath(bar: SpendChartBar, plotBottom: number, radius = 4): string {
  const { x, barWidth, yTop, barHeight } = bar;
  const right = x + barWidth;

  if (barHeight <= radius) {
    return `M${x},${plotBottom} L${x},${yTop} L${right},${yTop} L${right},${plotBottom} Z`;
  }

  return [
    `M${x},${plotBottom}`,
    `L${x},${yTop + radius}`,
    `Q${x},${yTop} ${x + radius},${yTop}`,
    `L${right - radius},${yTop}`,
    `Q${right},${yTop} ${right},${yTop + radius}`,
    `L${right},${plotBottom}`,
    "Z",
  ].join(" ");
}
