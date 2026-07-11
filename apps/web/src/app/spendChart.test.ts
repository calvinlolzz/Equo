import { describe, expect, test } from "vitest";
import { buildSpendChart, roundedBarPath, SPEND_CHART_DEFAULTS } from "./spendChart";

const days = [
  { key: "2026-07-08", day: 8, month: 7 },
  { key: "2026-07-09", day: 9, month: 7 },
  { key: "2026-07-10", day: 10, month: 7 },
];

describe("buildSpendChart", () => {
  test("scales bar heights to the max day and zero-fills missing days", () => {
    const layout = buildSpendChart(days, [
      { day: "2026-07-08", totalMinor: 5000 },
      { day: "2026-07-10", totalMinor: 10000 },
    ]);

    const plotHeight = layout.plotBottom - SPEND_CHART_DEFAULTS.topZone;
    expect(layout.maxMinor).toBe(10000);
    expect(layout.bars[2].barHeight).toBeCloseTo(plotHeight);
    expect(layout.bars[0].barHeight).toBeCloseTo(plotHeight / 2);
    expect(layout.bars[1].barHeight).toBe(0);
    expect(layout.bars[1].totalMinor).toBe(0);
  });

  test("labels bars as month/day and spreads bands across the width", () => {
    const layout = buildSpendChart(days, []);

    expect(layout.bars.map((bar) => bar.label)).toEqual(["7/8", "7/9", "7/10"]);
    expect(layout.bars[0].bandX).toBe(0);
    expect(layout.bars[2].bandX + layout.bars[2].bandWidth).toBeCloseTo(layout.width);
    expect(layout.bars[0].barWidth).toBeLessThan(layout.bars[0].bandWidth);
  });

  test("tiny non-zero values keep a visible minimum height", () => {
    const layout = buildSpendChart(days, [
      { day: "2026-07-08", totalMinor: 1 },
      { day: "2026-07-10", totalMinor: 1_000_000 },
    ]);

    expect(layout.bars[0].barHeight).toBe(SPEND_CHART_DEFAULTS.minBarHeight);
  });

  test("all-zero data yields zero max and zero-height bars", () => {
    const layout = buildSpendChart(days, []);

    expect(layout.maxMinor).toBe(0);
    expect(layout.bars.every((bar) => bar.barHeight === 0)).toBe(true);
  });
});

describe("roundedBarPath", () => {
  test("rounds only the top and closes on the baseline", () => {
    const layout = buildSpendChart(days, [{ day: "2026-07-08", totalMinor: 100 }]);
    const path = roundedBarPath(layout.bars[0], layout.plotBottom);

    expect(path).toContain(`M${layout.bars[0].x},${layout.plotBottom}`);
    expect(path).toContain("Q");
    expect(path.endsWith("Z")).toBe(true);
  });

  test("falls back to square corners for bars shorter than the radius", () => {
    const layout = buildSpendChart(days, [
      { day: "2026-07-08", totalMinor: 1 },
      { day: "2026-07-09", totalMinor: 1_000_000 },
    ]);
    const path = roundedBarPath(layout.bars[0], layout.plotBottom);

    expect(path).not.toContain("Q");
  });
});
