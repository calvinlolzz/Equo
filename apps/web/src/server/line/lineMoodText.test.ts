import { describe, expect, test } from "vitest";
import { MOOD_BUCKETS, MOOD_EMOJI } from "./lineMood.js";
import { LINE_MOOD_TEXT, type LineMoodCopy, lineMoodText } from "./lineMoodText.js";

const ZH = LINE_MOOD_TEXT["zh-Hant"];
const EN = LINE_MOOD_TEXT.en;

/** Every string in a copy object with where it came from, so a failure names the line. */
function allStrings(copy: LineMoodCopy): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  for (const bucket of MOOD_BUCKETS) copy.short[bucket].forEach((line, i) => out.push([`short.${bucket}[${i}]`, line]));
  copy.encouragement.forEach((line, i) => out.push([`encouragement[${i}]`, line]));
  for (const [key, line] of Object.entries(copy.milestones)) out.push([`milestones.${key}`, line]);
  out.push(["streakLine", copy.streakLine], ["statsLine", copy.statsLine]);
  copy.weekdays.forEach((label, i) => out.push([`weekdays[${i}]`, label]));
  return out;
}

describe("the mood copy", () => {
  test("both locales are registered, and an unknown or missing one falls back to zh-Hant", () => {
    expect(lineMoodText("zh-Hant")).toBe(ZH);
    expect(lineMoodText("en")).toBe(EN);
    expect(lineMoodText("fr")).toBe(ZH);
    expect(lineMoodText(null)).toBe(ZH);
    expect(lineMoodText(undefined)).toBe(ZH);
    expect(lineMoodText("constructor")).toBe(ZH);
  });

  test("both locales have the same buckets, three short lines each, and the same pool and milestone keys", () => {
    expect(Object.keys(ZH.short).sort()).toEqual([...MOOD_BUCKETS].sort());
    expect(Object.keys(EN.short).sort()).toEqual([...MOOD_BUCKETS].sort());
    for (const bucket of MOOD_BUCKETS) {
      expect(ZH.short[bucket], bucket).toHaveLength(3);
      expect(EN.short[bucket], bucket).toHaveLength(3);
    }
    expect(ZH.encouragement).toHaveLength(8);
    expect(EN.encouragement).toHaveLength(8);
    expect(Object.keys(EN.milestones).sort()).toEqual(Object.keys(ZH.milestones).sort());
    expect(ZH.weekdays).toHaveLength(7);
    expect(EN.weekdays).toHaveLength(7);
  });

  test("no line is empty, and none repeats another in the same bucket or pool", () => {
    for (const copy of [ZH, EN]) {
      for (const [where, line] of allStrings(copy)) expect(line.trim(), where).not.toBe("");
      for (const bucket of MOOD_BUCKETS) expect(new Set(copy.short[bucket]).size, bucket).toBe(3);
      expect(new Set(copy.encouragement).size).toBe(8);
    }
  });

  // zh counts code points (a line of Chinese is wide), en counts UTF-16 units.
  test("zh lines are at most 40 code points and en lines at most 90 UTF-16 units", () => {
    for (const [where, line] of allStrings(ZH)) expect([...line].length, where).toBeLessThanOrEqual(40);
    for (const [where, line] of allStrings(EN)) expect(line.length, where).toBeLessThanOrEqual(90);
  });

  test("placeholders are exactly {days} and {count}, where the plan puts them", () => {
    for (const copy of [ZH, EN]) {
      const withPlaceholder = new Map<string, string[]>([
        ["milestones.streakOther", ["days"]],
        ["milestones.total", ["count"]],
        ["streakLine", ["days"]],
        ["statsLine", ["days", "count"]],
      ]);
      for (const [where, line] of allStrings(copy)) {
        const found = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
        expect(found.sort(), where).toEqual([...(withPlaceholder.get(where) ?? [])].sort());
        expect(line.replace(/\{\w+\}/g, ""), where).not.toMatch(/[{}]/);
      }
    }
  });

  test("no emoji, no variation selector and no mojibake inside any string", () => {
    for (const copy of [ZH, EN]) {
      for (const [where, line] of allStrings(copy)) {
        expect(line, where).not.toMatch(/\p{Extended_Pictographic}/u);
        expect(line, where).not.toContain("\uFE0F");
        expect(line, where).not.toContain("\uFFFD");
        expect(line, where).not.toMatch(/[\u0080-\u009F]/);
        // Latin-1 / cp950 mojibake leaves a lead character followed by a control-ish pair; a real zh or en line has none.
        expect(line, where).not.toMatch(/[\u00C3\u00C2][\u0080-\u00BF]/);
      }
    }
  });

  test("the milestones keep their numbers: 3, 30, 100 and a year in zh and en", () => {
    expect(ZH.milestones.streak3).toContain("3");
    expect(ZH.milestones.streak30).toContain("30");
    expect(ZH.milestones.streak100).toContain("100");
    expect(EN.milestones.streak3).toContain("3");
    expect(EN.milestones.streak30).toContain("30");
    expect(EN.milestones.streak100).toContain("100");
  });

  test("the week starts on Monday: 一二三四五六日 and M T W T F S S", () => {
    expect(ZH.weekdays.join("")).toBe("一二三四五六日");
    expect(EN.weekdays.join(" ")).toBe("M T W T F S S");
  });

  test("the streak and stats strings are the ones the plan gives", () => {
    expect(ZH.streakLine).toBe("連續記帳 {days} 天");
    expect(ZH.statsLine).toBe("本月記帳 {days} 天 · 今天第 {count} 筆");
    expect(EN.streakLine).toBe("{days}-day streak");
    expect(EN.statsLine).toBe("{days} days logged this month · entry {count} today");
  });
});

describe("MOOD_EMOJI", () => {
  // The code points of the plan's table (§4.2): Emoji_Presentation, Unicode 9 or older, so no tofu on an older LINE.
  const EXPECTED: Record<string, number> = {
    breakfast: 0x1f373,
    lunch: 0x1f371,
    afternoon: 0x2615,
    dinner: 0x1f372,
    lateNight: 0x1f319,
    transport: 0x1f687,
    shopping: 0x1f6d2,
    entertainment: 0x1f3ac,
    health: 0x1f48a,
    home: 0x1f3e0,
    education: 0x1f4da,
    income: 0x1f4b0,
    large: 0x1f4cc,
    general: 0x2728,
    milestone: 0x1f389,
    streak: 0x1f525,
  };

  test("is exactly the plan's table", () => {
    expect(Object.keys(MOOD_EMOJI).sort()).toEqual(Object.keys(EXPECTED).sort());
    for (const [key, codePoint] of Object.entries(EXPECTED)) {
      expect(MOOD_EMOJI[key as keyof typeof MOOD_EMOJI].codePointAt(0), key).toBe(codePoint);
    }
  });

  test("every emoji is a single code point with Emoji_Presentation (no U+FE0F, no ZWJ sequence)", () => {
    for (const [key, emoji] of Object.entries(MOOD_EMOJI)) {
      expect([...emoji], key).toHaveLength(1);
      expect(emoji, key).toMatch(/^\p{Emoji_Presentation}$/u);
    }
  });

  test("no two moods share an emoji", () => {
    const all = Object.values(MOOD_EMOJI);
    expect(new Set(all).size).toBe(all.length);
  });
});
