import { describe, expect, test } from "vitest";
import { lineDateKey, lineMonthStart, lineTaiwanMinuteOfDay } from "./lineDates.js";

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

describe("lineTaiwanMinuteOfDay", () => {
  const utc = (iso: string) => Date.parse(iso);

  // [MV]: drop the +8h shift (or use the UTC clock) and every row goes red.
  test.each([
    ["Taiwan midnight (16:00Z the day before)", "2026-09-20T16:00:00Z", 0],
    ["one minute before Taiwan midnight", "2026-09-21T15:59:00Z", 1439],
    ["05:00 Taiwan (21:00Z)", "2026-09-20T21:00:00Z", 300],
    ["10:29 Taiwan", "2026-09-21T02:29:00Z", 629],
    ["10:30 Taiwan", "2026-09-21T02:30:00Z", 630],
    ["noon Taiwan (04:00Z)", "2026-09-21T04:00:00Z", 720],
    ["21:00 Taiwan (13:00Z)", "2026-09-21T13:00:00Z", 1260],
    ["the fixture timestamp 1790000000000 (2026-09-21 22:13 Taiwan)", new Date(1790000000000).toISOString(), 22 * 60 + 13],
  ])("%s", (_label, iso, expected) => {
    expect(lineTaiwanMinuteOfDay(utc(iso))).toBe(expected);
  });

  test("seconds and milliseconds do not move the minute", () => {
    expect(lineTaiwanMinuteOfDay(utc("2026-09-21T04:00:59.999Z"))).toBe(720);
  });

  test("agrees with lineDateKey: the minute of day wraps exactly where the Taiwan date changes", () => {
    const before = utc("2026-09-30T15:59:59Z");
    const after = utc("2026-09-30T16:00:00Z");
    expect(lineDateKey(before)).toBe("2026-09-30");
    expect(lineTaiwanMinuteOfDay(before)).toBe(1439);
    expect(lineDateKey(after)).toBe("2026-10-01");
    expect(lineTaiwanMinuteOfDay(after)).toBe(0);
  });

  test("a timestamp before 1970 is still 0-1439", () => {
    const minute = lineTaiwanMinuteOfDay(-1);
    expect(minute).toBeGreaterThanOrEqual(0);
    expect(minute).toBeLessThan(1440);
    expect(minute).toBe(8 * 60 - 1);
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
