import { describe, expect, test } from "vitest";
import { lineDateKey, lineMonthStart } from "./lineDates.js";

describe("lineDateKey", () => {
  test("an ordinary daytime-Taiwan timestamp", () => {
    expect(lineDateKey(1790000000000)).toBe("2026-09-21");
  });

  test("one second before Taiwan midnight (2026-09-30T15:59:59Z = 2026-09-30 23:59:59 +08:00)", () => {
    expect(lineDateKey(1790783999000)).toBe("2026-09-30");
  });

  // [MV]: the +8h shift is the whole point of this module. Change
  // LINE_UTC_OFFSET_MINUTES to 0 (or drop the shift) and both this test and
  // the one above must go red - one second later in UTC crosses into the
  // next Taiwan day.
  test("one second after Taiwan midnight rolls to the next day", () => {
    expect(lineDateKey(1790785800000)).toBe("2026-10-01");
  });
});

describe("lineMonthStart", () => {
  test("the first of the month for a mid-month date", () => {
    expect(lineMonthStart("2026-09-21")).toBe("2026-09-01");
  });

  // [MV]: paired with the date-rollover test above - a date that rolled into
  // October must bucket into October's month start, not September's.
  test("a date that just rolled into the next month", () => {
    expect(lineMonthStart(lineDateKey(1790785800000))).toBe("2026-10-01");
  });
});
