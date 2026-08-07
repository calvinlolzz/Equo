import { describe, expect, test } from "vitest";
import { formatPeriodChipLabel, formatPeriodTitle } from "./spendPeriods";

const NOW = new Date("2026-08-07T00:00:00");

describe("formatPeriodChipLabel", () => {
  test("names the two nearest years and numbers the rest", () => {
    expect(formatPeriodChipLabel("year", "2026", NOW)).toBe("今年");
    expect(formatPeriodChipLabel("year", "2025", NOW)).toBe("去年");
    expect(formatPeriodChipLabel("year", "2024", NOW)).toBe("2024");
    expect(formatPeriodChipLabel("year", "2022", NOW)).toBe("2022");
  });

  test("names the two nearest months", () => {
    expect(formatPeriodChipLabel("month", "2026-08", NOW)).toBe("本月");
    expect(formatPeriodChipLabel("month", "2026-07", NOW)).toBe("上個月");
  });

  test("rolls 上個月 back over a year boundary", () => {
    const january = new Date("2026-01-09T00:00:00");
    expect(formatPeriodChipLabel("month", "2026-01", january)).toBe("本月");
    expect(formatPeriodChipLabel("month", "2025-12", january)).toBe("上個月");
  });

  test("keeps the year on a month from another year so Decembers stay distinct", () => {
    expect(formatPeriodChipLabel("month", "2026-03", NOW)).toBe("3月");
    expect(formatPeriodChipLabel("month", "2025-12", NOW)).toBe("2025/12");
    expect(formatPeriodChipLabel("month", "2024-12", NOW)).toBe("2024/12");
  });

  test("passes a malformed key through rather than rendering NaN", () => {
    expect(formatPeriodChipLabel("month", "nonsense", NOW)).toBe("nonsense");
    expect(formatPeriodChipLabel("month", "2026-13", NOW)).toBe("2026-13");
  });
});

describe("formatPeriodTitle", () => {
  test("reads as a year or a year+month heading", () => {
    expect(formatPeriodTitle("year", "2026")).toBe("2026 總計");
    expect(formatPeriodTitle("month", "2026-08")).toBe("2026年8月 總計");
    expect(formatPeriodTitle("month", "2026-12")).toBe("2026年12月 總計");
  });

  test("falls back to a bare heading when the group has no period at all", () => {
    expect(formatPeriodTitle("year", null)).toBe("總計");
    expect(formatPeriodTitle("month", null)).toBe("總計");
  });
});
