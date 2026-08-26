import { describe, expect, test } from "vitest";
import type { SpendBreakdown } from "./apiClient";
import { describeSpendComparison, spendComparison } from "./spendComparison";

function breakdown(
  periods: Array<{ key: string; total_minor: number; personal_total_minor?: number }>,
  periodKey = periods[0]?.key ?? null,
): SpendBreakdown {
  return {
    period_kind: "month",
    period_key: periodKey,
    currency: "TWD",
    periods,
    group_total_minor: periods[0]?.total_minor ?? 0,
    personal_total_minor: periods[0]?.personal_total_minor ?? 0,
    by_category: [],
  } as SpendBreakdown;
}

const twoMonths = [
  { key: "2026-08", total_minor: 130_000, personal_total_minor: 20_000 },
  { key: "2026-07", total_minor: 100_000, personal_total_minor: 40_000 },
];

describe("spendComparison", () => {
  test("compares the group figure in 群組 mode", () => {
    expect(spendComparison(breakdown(twoMonths), "group")).toMatchObject({
      changePct: 30,
      previousKey: "2026-07",
    });
  });

  test("compares the caller's own figure in 個人 mode", () => {
    // The same two months are +30% for the group and -50% for this person.
    // Showing the group delta under a personal heading is the exact mistake
    // this scope argument exists to prevent.
    expect(spendComparison(breakdown(twoMonths), "personal")?.changePct).toBe(-50);
  });

  test("says nothing about a group's first period", () => {
    expect(spendComparison(breakdown([twoMonths[0]]), "group")).toBeNull();
  });

  test("says nothing when the previous period was zero", () => {
    // Every increase from nothing is infinite; "+∞%" informs nobody.
    const periods = [
      { key: "2026-08", total_minor: 5_000, personal_total_minor: 5_000 },
      { key: "2026-07", total_minor: 0, personal_total_minor: 0 },
    ];

    expect(spendComparison(breakdown(periods), "group")).toBeNull();
  });

  test("says nothing while an older period is selected", () => {
    // The chips let you look at July. July's neighbour is June, not "last
    // month" - so comparing it against August would be backwards.
    expect(spendComparison(breakdown(twoMonths, "2026-07"), "group")).toBeNull();
  });

  test("says nothing when the API predates personal period totals", () => {
    const periods = [
      { key: "2026-08", total_minor: 130_000 },
      { key: "2026-07", total_minor: 100_000 },
    ];

    // The group comparison still works; the personal one stays silent rather
    // than quietly showing the group's number.
    expect(spendComparison(breakdown(periods), "group")?.changePct).toBe(30);
    expect(spendComparison(breakdown(periods), "personal")).toBeNull();
  });

  test("no breakdown at all is not a comparison", () => {
    expect(spendComparison(null, "group")).toBeNull();
  });
});

describe("describeSpendComparison", () => {
  test("names the direction and the period it is against", () => {
    expect(describeSpendComparison({ changePct: 30, previousKey: "2026-07", previousMinor: 1 }, "month")).toBe(
      "比上個月多 30%",
    );
    expect(describeSpendComparison({ changePct: -12, previousKey: "2026-07", previousMinor: 1 }, "month")).toBe(
      "比上個月少 12%",
    );
  });

  test("a flat period reads as flat, not as +0%", () => {
    expect(describeSpendComparison({ changePct: 0, previousKey: "2026-07", previousMinor: 1 }, "month")).toBe(
      "跟上個月差不多",
    );
  });

  test("year bucketing compares against last year", () => {
    expect(describeSpendComparison({ changePct: 5, previousKey: "2025", previousMinor: 1 }, "year")).toBe(
      "比去年多 5%",
    );
  });
});
