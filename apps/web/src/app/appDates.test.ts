import { describe, expect, test } from "vitest";
import { formatRecordStamp } from "./appDates";

/**
 * Fixed "now" so the today/yesterday branches are testable at all: these are
 * relative labels, and a test that reads the wall clock would pass or fail
 * depending on what time the suite ran.
 */
const NOW = new Date(2026, 8, 6, 21, 30); // 2026-09-06 21:30 local

/** Local-time constructor - the formatter reads local getters, as the rows do. */
function at(month: number, day: number, hour: number, minute: number) {
  return new Date(2026, month - 1, day, hour, minute).toISOString();
}

describe("formatRecordStamp", () => {
  test("today and yesterday are named, so a list spanning days is readable", () => {
    expect(formatRecordStamp(at(9, 6, 20, 0), "zh-Hant", NOW)).toBe("今天 20:00");
    expect(formatRecordStamp(at(9, 5, 20, 0), "zh-Hant", NOW)).toBe("昨天 20:00");
    expect(formatRecordStamp(at(9, 6, 20, 0), "en", NOW)).toBe("Today 20:00");
    expect(formatRecordStamp(at(9, 5, 20, 0), "en", NOW)).toBe("Yesterday 20:00");
  });

  test("anything older carries its date, which is what tells the rows apart", () => {
    expect(formatRecordStamp(at(9, 3, 20, 0), "zh-Hant", NOW)).toBe("9月3日 20:00");
    expect(formatRecordStamp(at(9, 3, 20, 0), "en", NOW)).toBe("Sep 3 20:00");
  });

  test("never seconds - the row this feeds used to show 下午8:00:00", () => {
    expect(formatRecordStamp(at(9, 6, 20, 0, ), "zh-Hant", NOW)).not.toMatch(/:\d\d:\d\d/);
    expect(formatRecordStamp(at(9, 3, 20, 5), "zh-Hant", NOW)).toBe("9月3日 20:05");
  });

  test("an English reader gets no Chinese - the old formatter hard-coded zh-TW", () => {
    const stamps = [at(9, 6, 8, 0), at(9, 5, 8, 0), at(9, 3, 8, 0)].map((value) =>
      formatRecordStamp(value, "en", NOW),
    );
    for (const stamp of stamps) expect(stamp).not.toMatch(/[\u4e00-\u9fff]/);
  });

  test("midnight and noon are unambiguous, which a 12-hour clock without a suffix is not", () => {
    expect(formatRecordStamp(at(9, 3, 0, 5), "zh-Hant", NOW)).toBe("9月3日 00:05");
    expect(formatRecordStamp(at(9, 3, 12, 5), "zh-Hant", NOW)).toBe("9月3日 12:05");
  });

  test("the day boundary is the calendar date, not 24 hours ago", () => {
    // 00:10 today is "今天" even though NOW is 21:30 and that is 21 hours back.
    expect(formatRecordStamp(at(9, 6, 0, 10), "zh-Hant", NOW)).toBe("今天 00:10");
    // 23:50 yesterday is "昨天" even though it is under two hours back.
    expect(formatRecordStamp(at(9, 5, 23, 50), "zh-Hant", NOW)).toBe("昨天 23:50");
  });
});
