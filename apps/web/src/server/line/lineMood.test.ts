import { afterEach, describe, expect, test, vi } from "vitest";
import { fill } from "../push/pushText.js";
import {
  LARGE_TWD_MINOR,
  type LineStreakStats,
  MOOD_BUCKETS,
  MOOD_EMOJI,
  type MoodBucket,
  type MoodBucketInput,
  moodAltText,
  moodBucket,
  moodPlainText,
  parseStreakStats,
  pickMood,
  variantIndex,
} from "./lineMood.js";
import { LINE_MOOD_TEXT } from "./lineMoodText.js";

const at = (hour: number, minute = 0) => hour * 60 + minute;

function input(overrides: Partial<MoodBucketInput> = {}): MoodBucketInput {
  return {
    kind: "expense",
    category: "general",
    title: "東西",
    amountMinor: 6000,
    currency: "TWD",
    budgetMinor: null,
    taiwanMinuteOfDay: at(12),
    ...overrides,
  };
}

const bucketOf = (overrides: Partial<MoodBucketInput> = {}) => moodBucket(input(overrides));

describe("moodBucket - the table", () => {
  // [MV]: drop or swap any row and this names it. Every bucket is reachable from here.
  test.each<[string, Partial<MoodBucketInput>, MoodBucket]>([
    ["food in the morning", { category: "food", title: "麵包", taiwanMinuteOfDay: at(8) }, "breakfast"],
    ["food at noon", { category: "food", title: "麵", taiwanMinuteOfDay: at(12) }, "lunch"],
    ["food mid-afternoon", { category: "food", title: "麵", taiwanMinuteOfDay: at(15) }, "afternoon"],
    ["food in the evening", { category: "food", title: "麵", taiwanMinuteOfDay: at(19) }, "dinner"],
    ["food at night", { category: "food", title: "麵", taiwanMinuteOfDay: at(23) }, "lateNight"],
    ["transport", { category: "transport" }, "transport"],
    ["shopping", { category: "shopping" }, "shopping"],
    ["entertainment", { category: "entertainment" }, "entertainment"],
    ["health", { category: "health" }, "health"],
    ["home", { category: "home" }, "home"],
    ["bills", { category: "bills" }, "home"],
    ["lodging", { category: "lodging" }, "home"],
    ["education", { category: "education" }, "education"],
    ["income", { kind: "income", category: "salary", amountMinor: 5_200_000 }, "income"],
    ["a large expense", { category: "shopping", amountMinor: LARGE_TWD_MINOR }, "large"],
    ["general", { category: "general" }, "general"],
    ["other", { category: "other" }, "general"],
    ["a category nobody has heard of", { category: "pet_food" }, "general"],
    ["a category named like an Object.prototype member", { category: "constructor" }, "general"],
    ["a category named __proto__", { category: "__proto__" }, "general"],
  ])("%s -> %s", (_label, overrides, expected) => {
    expect(bucketOf(overrides)).toBe(expected);
  });

  test("every bucket is produced by some row of the table above", () => {
    const reached = new Set<MoodBucket>([
      bucketOf({ category: "food", title: "麵", taiwanMinuteOfDay: at(8) }),
      bucketOf({ category: "food", title: "麵", taiwanMinuteOfDay: at(12) }),
      bucketOf({ category: "food", title: "麵", taiwanMinuteOfDay: at(15) }),
      bucketOf({ category: "food", title: "麵", taiwanMinuteOfDay: at(19) }),
      bucketOf({ category: "food", title: "麵", taiwanMinuteOfDay: at(23) }),
      bucketOf({ category: "transport" }),
      bucketOf({ category: "shopping" }),
      bucketOf({ category: "entertainment" }),
      bucketOf({ category: "health" }),
      bucketOf({ category: "home" }),
      bucketOf({ category: "education" }),
      bucketOf({ kind: "income" }),
      bucketOf({ amountMinor: LARGE_TWD_MINOR }),
      bucketOf({}),
    ]);
    expect([...reached].sort()).toEqual([...MOOD_BUCKETS].sort());
  });
});

describe("moodBucket - Taiwan time of day for food", () => {
  const food = (minute: number) => bucketOf({ category: "food", title: "麵", taiwanMinuteOfDay: minute });

  // [MV]: move any boundary by one minute and the pair around it goes red.
  test.each<[string, number, MoodBucket]>([
    ["00:00", at(0), "lateNight"],
    ["04:59", at(4, 59), "lateNight"],
    ["05:00", at(5, 0), "breakfast"],
    ["10:29", at(10, 29), "breakfast"],
    ["10:30", at(10, 30), "lunch"],
    ["13:59", at(13, 59), "lunch"],
    ["14:00", at(14, 0), "afternoon"],
    ["16:59", at(16, 59), "afternoon"],
    ["17:00", at(17, 0), "dinner"],
    ["20:59", at(20, 59), "dinner"],
    ["21:00", at(21, 0), "lateNight"],
    ["23:59", at(23, 59), "lateNight"],
  ])("%s", (_clock, minute, expected) => {
    expect(food(minute)).toBe(expected);
  });

  test("the clock only decides food: a shopping trip at breakfast time is still shopping", () => {
    expect(bucketOf({ category: "shopping", taiwanMinuteOfDay: at(8) })).toBe("shopping");
  });
});

describe("moodBucket - a word in the title beats the clock", () => {
  const food = (title: string, minute: number) => bucketOf({ category: "food", title, taiwanMinuteOfDay: minute });

  test.each<[string, number, MoodBucket]>([
    ["早餐", at(15), "breakfast"],
    ["早午餐", at(12), "breakfast"],
    ["Brunch", at(19), "breakfast"],
    ["BREAKFAST burrito", at(23), "breakfast"],
    ["午餐", at(7), "lunch"],
    ["便當", at(23), "lunch"],
    ["Lunch special", at(7), "lunch"],
    ["下午茶", at(7), "afternoon"],
    ["咖啡", at(7), "afternoon"],
    ["飲料", at(23), "afternoon"],
    ["手搖", at(12), "afternoon"],
    ["點心", at(12), "afternoon"],
    ["Coffee", at(7), "afternoon"],
    ["iced tea", at(7), "afternoon"],
    ["snacks", at(7), "afternoon"],
    ["晚餐", at(7), "dinner"],
    ["Dinner", at(7), "dinner"],
    ["宵夜", at(12), "lateNight"],
    ["消夜", at(12), "lateNight"],
    ["supper", at(12), "lateNight"],
  ])("%s at the given time", (title, minute, expected) => {
    expect(food(title, minute)).toBe(expected);
  });

  test("an English word must stand alone: 'tea' is not in 'steak'", () => {
    expect(food("steak", at(12))).toBe("lunch");
    expect(food("Steak", at(19))).toBe("dinner");
    expect(food("instead", at(19))).toBe("dinner");
  });

  test("the first listed meal wins when a title names two", () => {
    expect(food("早餐 咖啡", at(15))).toBe("breakfast");
    expect(food("午餐 咖啡", at(7))).toBe("lunch");
  });

  test("a word in the title of something that is not food is ignored", () => {
    expect(bucketOf({ category: "shopping", title: "咖啡機", taiwanMinuteOfDay: at(7) })).toBe("shopping");
    expect(bucketOf({ category: "general", title: "早餐", taiwanMinuteOfDay: at(15) })).toBe("general");
  });
});

describe("moodBucket - income, large, then everything else", () => {
  test("income beats a large amount and beats food", () => {
    expect(bucketOf({ kind: "income", category: "food", amountMinor: 99_999_999, title: "早餐", budgetMinor: 100 })).toBe("income");
  });

  test("a large expense beats food and its keywords", () => {
    expect(bucketOf({ category: "food", title: "早餐", amountMinor: LARGE_TWD_MINOR })).toBe("large");
  });

  // [MV]: >= to > on the 20% rule (or / 5 to / 4) and the pair below goes red.
  test("20% of the monthly budget is large, one minor unit less is not", () => {
    const budget = 1_000_000;
    expect(bucketOf({ amountMinor: 200_000, budgetMinor: budget })).toBe("large");
    expect(bucketOf({ amountMinor: 199_999, budgetMinor: budget })).toBe("general");
  });

  // [MV]: >= to > on 300000 and the pair below goes red.
  test("NT$3,000 is large with no budget at all, NT$2,999.99 is not", () => {
    expect(bucketOf({ amountMinor: 300_000, budgetMinor: null })).toBe("large");
    expect(bucketOf({ amountMinor: 299_999, budgetMinor: null })).toBe("general");
  });

  test("a budget of zero or none counts for nothing", () => {
    expect(bucketOf({ amountMinor: 100, budgetMinor: 0 })).toBe("general");
    expect(bucketOf({ amountMinor: 100, budgetMinor: null })).toBe("general");
  });

  test("the NT$3,000 rule is for TWD: another currency with no budget is never large", () => {
    expect(bucketOf({ currency: "USD", amountMinor: 99_999_999, budgetMinor: null })).toBe("general");
    expect(bucketOf({ currency: "JPY", amountMinor: 300_000, budgetMinor: null })).toBe("general");
  });

  test("the budget rule applies in any currency", () => {
    expect(bucketOf({ currency: "USD", amountMinor: 20_000, budgetMinor: 100_000 })).toBe("large");
  });

  test("income is never large", () => {
    expect(bucketOf({ kind: "income", amountMinor: 99_999_999, budgetMinor: 100 })).toBe("income");
  });
});

describe("variantIndex", () => {
  afterEach(() => vi.restoreAllMocks());

  // [MV]: any change to the offset basis, the prime or the xor-then-multiply order turns these red.
  test("is 32-bit FNV-1a over UTF-8: the published test vectors", () => {
    const FULL = 0xffff_ffff;
    expect(variantIndex("", FULL)).toBe(0x811c9dc5);
    expect(variantIndex("a", FULL)).toBe(0xe40c292c);
    expect(variantIndex("foobar", FULL)).toBe(0xbf9cf968);
  });

  test("hashes the UTF-8 bytes, not the UTF-16 units", () => {
    // "é" is the two bytes 0xC3 0xA9 in UTF-8 (one UTF-16 unit, 0x00E9); the reference below hashes those two bytes.
    let hash = 0x811c9dc5;
    for (const byte of [0xc3, 0xa9]) hash = Math.imul(hash ^ byte, 0x01000193) >>> 0;
    expect(variantIndex("é", 0xffff_ffff)).toBe(hash);
  });

  test("is deterministic", () => {
    for (const seed of ["01J0000000000000000000000X", "msg:4711000000001", "短"]) {
      expect(variantIndex(seed, 7)).toBe(variantIndex(seed, 7));
    }
  });

  test("stays within 0..count-1 for every count from 1 to 10", () => {
    for (let count = 1; count <= 10; count += 1) {
      for (let n = 0; n < 200; n += 1) {
        const index = variantIndex(`seed-${n}`, count);
        expect(Number.isInteger(index)).toBe(true);
        expect(index).toBeGreaterThanOrEqual(0);
        expect(index).toBeLessThan(count);
      }
    }
  });

  test("a count of one is always 0, and a count that is not a positive integer is 0 rather than NaN", () => {
    expect(variantIndex("anything", 1)).toBe(0);
    expect(variantIndex("anything", 0)).toBe(0);
    expect(variantIndex("anything", -3)).toBe(0);
    expect(variantIndex("anything", 2.5)).toBe(0);
    expect(variantIndex("anything", Number.NaN)).toBe(0);
  });

  test("different keys spread over all of the variants", () => {
    for (const count of [3, 8]) {
      const seen = new Map<number, number>();
      for (let n = 0; n < 600; n += 1) {
        const index = variantIndex(`01J${String(n).padStart(23, "0")}`, count);
        seen.set(index, (seen.get(index) ?? 0) + 1);
      }
      expect([...seen.keys()].sort()).toEqual(Array.from({ length: count }, (_, i) => i));
      // Roughly even: no variant under half of its fair share.
      for (const hits of seen.values()) expect(hits).toBeGreaterThan(600 / count / 2);
    }
  });

  // [MV]: put Math.random or Date.now into the hash and a redelivered event says something else.
  test("reads neither the clock nor a random source", () => {
    const random = vi.spyOn(Math, "random").mockImplementation(() => {
      throw new Error("Math.random must not be used");
    });
    const now = vi.spyOn(Date, "now").mockImplementation(() => {
      throw new Error("Date.now must not be used");
    });

    expect(() => variantIndex("01J0000000000000000000000X", 3)).not.toThrow();
    expect(() =>
      pickMood(LINE_MOOD_TEXT["zh-Hant"], { seed: "01J0000000000000000000000X", bucket: "lunch", stats: null }),
    ).not.toThrow();
    expect(random).not.toHaveBeenCalled();
    expect(now).not.toHaveBeenCalled();
  });
});

const BASE_STATS: LineStreakStats = {
  streakDays: 2,
  week: [true, true, false, false, false, false, false],
  todayIndex: 1,
  monthDays: 12,
  todayEntries: 2,
  totalEntries: 40,
};

const stats = (overrides: Partial<LineStreakStats> = {}): LineStreakStats => ({ ...BASE_STATS, ...overrides });

describe("pickMood", () => {
  const SEED = "01J0000000000000000000000X";

  describe.each(["zh-Hant", "en"] as const)("%s", (locale) => {
    const copy = LINE_MOOD_TEXT[locale];
    const pick = (s: LineStreakStats | null, bucket: MoodBucket = "general", seed = SEED) =>
      pickMood(copy, { seed, bucket, stats: s });

    // [MV]: swap any rung's number or text and its row goes red.
    test.each<[string, Partial<LineStreakStats>, string]>([
      ["the very first entry", { totalEntries: 1, streakDays: 1, monthDays: 1, todayEntries: 1 }, copy.milestones.firstEver],
      ["a 3-day streak", { streakDays: 3 }, copy.milestones.streak3],
      ["a 7-day streak", { streakDays: 7 }, copy.milestones.streak7],
      ["a 14-day streak", { streakDays: 14 }, copy.milestones.streak14],
      ["a 30-day streak", { streakDays: 30 }, copy.milestones.streak30],
      ["a 100-day streak", { streakDays: 100 }, copy.milestones.streak100],
      ["a 365-day streak", { streakDays: 365 }, copy.milestones.streak365],
      ["a 21-day streak", { streakDays: 21 }, fill(copy.milestones.streakOther, { days: 21 })],
      ["a 50-day streak", { streakDays: 50, totalEntries: 51 }, fill(copy.milestones.streakOther, { days: 50 })],
      ["a 200-day streak", { streakDays: 200 }, fill(copy.milestones.streakOther, { days: 200 })],
      ["a 300-day streak", { streakDays: 300 }, fill(copy.milestones.streakOther, { days: 300 })],
      ["the 10th entry", { totalEntries: 10 }, fill(copy.milestones.total, { count: 10 })],
      ["the 50th entry", { totalEntries: 50 }, fill(copy.milestones.total, { count: 50 })],
      ["the 100th entry", { totalEntries: 100 }, fill(copy.milestones.total, { count: 100 })],
      ["the 500th entry", { totalEntries: 500 }, fill(copy.milestones.total, { count: 500 })],
      ["the 1000th entry", { totalEntries: 1000 }, fill(copy.milestones.total, { count: 1000 })],
      ["the first entry of a month", { monthDays: 1, todayEntries: 1 }, copy.milestones.firstOfMonth],
    ])("%s is a milestone, shown as the note", (_label, overrides, expected) => {
      const result = pick(stats(overrides));
      expect(result.note).toBe(expected);
      expect(result.noteKind).toBe("milestone");
    });

    test("a day that is not a milestone gets an encouragement from the pool", () => {
      for (const streakDays of [1, 2, 4, 5, 6, 8, 13, 15, 20, 22, 29, 31, 99, 101, 364, 366]) {
        const result = pick(stats({ streakDays }));
        expect(result.noteKind).toBe("encouragement");
        expect(copy.encouragement).toContain(result.note);
      }
      for (const totalEntries of [2, 9, 11, 49, 51, 99, 101, 999, 1001]) {
        expect(pick(stats({ totalEntries })).noteKind).toBe("encouragement");
      }
    });

    test("the first-of-month line needs BOTH it being the month's first day and its first entry", () => {
      expect(pick(stats({ monthDays: 1, todayEntries: 2 })).noteKind).toBe("encouragement");
      expect(pick(stats({ monthDays: 2, todayEntries: 1 })).noteKind).toBe("encouragement");
    });

    // [MV]: reorder the priority and one of these goes red.
    test("priority: first ever > streak > entry count > first of month > encouragement", () => {
      const all = { totalEntries: 1, streakDays: 7, monthDays: 1, todayEntries: 1 };
      expect(pick(stats(all)).note).toBe(copy.milestones.firstEver);
      expect(pick(stats({ ...all, totalEntries: 10 })).note).toBe(copy.milestones.streak7);
      expect(pick(stats({ ...all, totalEntries: 10, streakDays: 21 })).note).toBe(
        fill(copy.milestones.streakOther, { days: 21 }),
      );
      expect(pick(stats({ ...all, totalEntries: 10, streakDays: 2 })).note).toBe(fill(copy.milestones.total, { count: 10 }));
      expect(pick(stats({ ...all, totalEntries: 11, streakDays: 2 })).note).toBe(copy.milestones.firstOfMonth);
      expect(pick(stats({ ...all, totalEntries: 11, streakDays: 2, todayEntries: 2 })).noteKind).toBe("encouragement");
    });

    test("the streak and stats lines carry the numbers", () => {
      const result = pick(stats({ streakDays: 4, monthDays: 9, todayEntries: 3 }));
      expect(result.streakLine).toBe(fill(copy.streakLine, { days: 4 }));
      expect(result.statsLine).toBe(fill(copy.statsLine, { days: 9, count: 3 }));
      expect(result.streakLine).toContain("4");
      expect(result.statsLine).toContain("9");
      expect(result.statsLine).toContain("3");
    });

    test("with no stats: an encouragement even where a milestone would be, and no streak lines", () => {
      const result = pick(null);
      expect(result.noteKind).toBe("encouragement");
      expect(copy.encouragement).toContain(result.note);
      expect(result.streakLine).toBeNull();
      expect(result.statsLine).toBeNull();
    });

    test("the short line is one of the bucket's three, and it is the bucket that was asked for", () => {
      for (const bucket of MOOD_BUCKETS) {
        const result = pick(stats(), bucket);
        expect(result.bucket).toBe(bucket);
        expect(copy.short[bucket]).toContain(result.shortLine);
      }
    });

    // [MV]: Math.random / Date.now, or a seed that is not the event key, and the redelivered reply differs.
    test("the same event key says the same words, with the same or different streak numbers", () => {
      const first = pick(stats(), "dinner");
      const again = pick(stats({ todayEntries: 5, monthDays: 20 }), "dinner");
      expect(again.shortLine).toBe(first.shortLine);
      expect(again.note).toBe(first.note);
    });

    test("different event keys spread across the variants of a bucket and of the pool", () => {
      const shorts = new Set<string>();
      const notes = new Set<string>();
      for (let n = 0; n < 200; n += 1) {
        const result = pick(stats(), "breakfast", `01J${String(n).padStart(23, "0")}`);
        shorts.add(result.shortLine);
        notes.add(result.note);
      }
      expect(shorts.size).toBe(3);
      expect(notes.size).toBe(8);
    });

    // [MV]: change a salt (or drop it) and the line is no longer the one the plan's seed+":s" / seed+":e" names.
    test("the short line and the note are drawn with the event key salted \":s\" and \":e\"", () => {
      for (let n = 0; n < 20; n += 1) {
        const seed = `01J${String(n).padStart(23, "0")}`;
        const result = pick(stats(), "lunch", seed);
        expect(result.shortLine).toBe(copy.short.lunch[variantIndex(`${seed}:s`, 3)]);
        expect(result.note).toBe(copy.encouragement[variantIndex(`${seed}:e`, 8)]);
      }
    });

    test("moodAltText is the short line, plus the streak line when there is one", () => {
      const withStats = pick(stats({ streakDays: 4 }));
      expect(moodAltText(withStats)).toBe(`${withStats.shortLine}\n${fill(copy.streakLine, { days: 4 })}`);
      const without = pick(null);
      expect(moodAltText(without)).toBe(without.shortLine);
    });

    test("moodPlainText has every line the card has, in order", () => {
      const withStats = pick(stats());
      expect(moodPlainText(withStats).split("\n")).toEqual([
        withStats.shortLine,
        withStats.note,
        withStats.streakLine,
        withStats.statsLine,
      ]);
      const without = pick(null);
      expect(moodPlainText(without).split("\n")).toEqual([without.shortLine, without.note]);
    });
  });

  test("an emoji for every bucket, for the milestone and for the streak", () => {
    for (const bucket of MOOD_BUCKETS) expect(MOOD_EMOJI[bucket]).toBeTruthy();
    expect(MOOD_EMOJI.milestone).toBeTruthy();
    expect(MOOD_EMOJI.streak).toBeTruthy();
  });
});

describe("parseStreakStats", () => {
  const raw = (overrides: Record<string, unknown> = {}) => ({
    streak_days: 3,
    week: [true, true, true, false, false, false, false],
    today_index: 2,
    month_days: 12,
    today_entries: 2,
    total_entries: 40,
    ...overrides,
  });

  test("a good object becomes the camel-cased stats", () => {
    expect(parseStreakStats(raw())).toEqual({
      streakDays: 3,
      week: [true, true, true, false, false, false, false],
      todayIndex: 2,
      monthDays: 12,
      todayEntries: 2,
      totalEntries: 40,
    });
  });

  test("extra keys are ignored, zeros are fine, and the week is a copy", () => {
    const week = [false, false, false, false, false, false, false];
    const parsed = parseStreakStats(raw({ extra: "x", streak_days: 0, month_days: 0, today_entries: 0, week }));
    expect(parsed).not.toBeNull();
    expect(parsed?.streakDays).toBe(0);
    expect(parsed?.week).not.toBe(week);
  });

  // [MV]: relax the week length check (or any other row) and its case goes red.
  test.each<[string, unknown]>([
    ["null", null],
    ["undefined", undefined],
    ["a string", "stats"],
    ["a number", 3],
    ["an array", [1, 2, 3]],
    ["an empty object", {}],
    ["a week of six days", raw({ week: [true, true, true, false, false, false] })],
    ["a week of eight days", raw({ week: [true, true, true, false, false, false, false, false] })],
    ["a week that is not an array", raw({ week: "1110000" })],
    ["a week of numbers", raw({ week: [1, 1, 1, 0, 0, 0, 0] })],
    ["a week with a null in it", raw({ week: [true, true, true, false, false, false, null] })],
    ["a missing week", raw({ week: undefined })],
    ["today_index 7", raw({ today_index: 7 })],
    ["today_index -1", raw({ today_index: -1 })],
    ["today_index 1.5", raw({ today_index: 1.5 })],
    ["today_index as a string", raw({ today_index: "2" })],
    ["a missing today_index", raw({ today_index: undefined })],
    ["a negative streak_days", raw({ streak_days: -1 })],
    ["a fractional streak_days", raw({ streak_days: 2.5 })],
    ["streak_days as a string", raw({ streak_days: "3" })],
    ["streak_days NaN", raw({ streak_days: Number.NaN })],
    ["streak_days Infinity", raw({ streak_days: Number.POSITIVE_INFINITY })],
    ["a missing month_days", raw({ month_days: undefined })],
    ["a negative month_days", raw({ month_days: -4 })],
    ["a null today_entries", raw({ today_entries: null })],
    ["a missing total_entries", raw({ total_entries: undefined })],
    ["a negative total_entries", raw({ total_entries: -1 })],
  ])("%s is rejected", (_label, value) => {
    expect(parseStreakStats(value)).toBeNull();
  });
});
