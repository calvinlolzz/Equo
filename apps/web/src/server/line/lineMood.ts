import { fill } from "../push/pushText.js";
import type { LineMoodCopy } from "./lineMoodText.js";

/**
 * What the mood card says, decided without any I/O: which moment a record was
 * (a bucket), which words go with it, and how the streak numbers are trusted.
 * Everything here is a pure function of its arguments - the clock is never read
 * and nothing is random - so the same webhook event always gets the same words.
 */

export const MOOD_BUCKETS = [
  "breakfast",
  "lunch",
  "afternoon",
  "dinner",
  "lateNight",
  "transport",
  "shopping",
  "entertainment",
  "health",
  "home",
  "education",
  "income",
  "large",
  "general",
] as const;

export type MoodBucket = (typeof MOOD_BUCKETS)[number];

/**
 * One emoji per bucket, plus the milestone and the streak. Each is a single code
 * point with Emoji_Presentation=Yes and nothing newer than Unicode 9 - the same
 * rule, for the same reasons, as LINE_CATEGORY_EMOJI in lineCardTheme.ts.
 */
export const MOOD_EMOJI: Readonly<Record<MoodBucket | "milestone" | "streak", string>> = {
  breakfast: "\u{1F373}",
  lunch: "\u{1F371}",
  afternoon: "\u{2615}",
  dinner: "\u{1F372}",
  lateNight: "\u{1F319}",
  transport: "\u{1F687}",
  shopping: "\u{1F6D2}",
  entertainment: "\u{1F3AC}",
  health: "\u{1F48A}",
  home: "\u{1F3E0}",
  education: "\u{1F4DA}",
  income: "\u{1F4B0}",
  large: "\u{1F4CC}",
  general: "\u{2728}",
  milestone: "\u{1F389}",
  streak: "\u{1F525}",
};

/** A single expense of at least NT$3,000 (minor units: TWD has two decimals) is a big one whatever the budget. */
export const LARGE_TWD_MINOR = 300_000;

/** ... and so is one that takes at least this share (1/5, i.e. 20%) of the monthly budget. */
const LARGE_BUDGET_DIVISOR = 5;

/** Taiwan time of day, in minutes since midnight, where the meals begin. */
const BREAKFAST_FROM = 5 * 60;
const LUNCH_FROM = 10 * 60 + 30;
const AFTERNOON_FROM = 14 * 60;
const DINNER_FROM = 17 * 60;
const LATE_NIGHT_FROM = 21 * 60;

type FoodBucket = Extract<MoodBucket, "breakfast" | "lunch" | "afternoon" | "dinner" | "lateNight">;

/**
 * What a title can say about the meal, tried in this order (so "早午餐" - which
 * contains "午餐" - is breakfast). A word wins over the clock: a 咖啡 at 07:00 is
 * the afternoon-tea mood, a 宵夜 at 18:00 is still a late-night one.
 */
const FOOD_KEYWORDS: ReadonlyArray<readonly [FoodBucket, readonly string[]]> = [
  ["breakfast", ["早餐", "早午餐", "breakfast", "brunch"]],
  ["lunch", ["午餐", "便當", "lunch"]],
  ["afternoon", ["下午茶", "咖啡", "飲料", "手搖", "點心", "coffee", "tea", "snack"]],
  ["dinner", ["晚餐", "dinner"]],
  ["lateNight", ["宵夜", "消夜", "supper"]],
];

const ASCII_WORD = /^[a-z]+$/;

/**
 * Whether a lower-cased title contains `keyword`. A Chinese keyword is a plain
 * substring (there are no spaces to anchor on); an English one must stand on
 * its own as a word, optionally plural, so "tea" is not found inside "steak".
 */
function titleHas(lowerTitle: string, keyword: string): boolean {
  if (!ASCII_WORD.test(keyword)) return lowerTitle.includes(keyword);
  return new RegExp(`(?<![a-z])${keyword}s?(?![a-z])`).test(lowerTitle);
}

function foodBucket(title: string, minuteOfDay: number): FoodBucket {
  const lower = title.toLowerCase();
  for (const [bucket, words] of FOOD_KEYWORDS) {
    if (words.some((word) => titleHas(lower, word))) return bucket;
  }

  if (minuteOfDay >= BREAKFAST_FROM && minuteOfDay < LUNCH_FROM) return "breakfast";
  if (minuteOfDay >= LUNCH_FROM && minuteOfDay < AFTERNOON_FROM) return "lunch";
  if (minuteOfDay >= AFTERNOON_FROM && minuteOfDay < DINNER_FROM) return "afternoon";
  if (minuteOfDay >= DINNER_FROM && minuteOfDay < LATE_NIGHT_FROM) return "dinner";
  return "lateNight";
}

const CATEGORY_BUCKETS: Readonly<Record<string, MoodBucket>> = {
  transport: "transport",
  shopping: "shopping",
  entertainment: "entertainment",
  health: "health",
  home: "home",
  bills: "home",
  lodging: "home",
  education: "education",
};

export type MoodBucketInput = {
  kind: "expense" | "income";
  category: string;
  title: string;
  amountMinor: number;
  currency: string;
  budgetMinor: number | null;
  /** Taiwan time of day in minutes, 0-1439 (lineTaiwanMinuteOfDay). */
  taiwanMinuteOfDay: number;
};

function isLarge(a: MoodBucketInput): boolean {
  if (a.kind !== "expense") return false;
  if (a.budgetMinor !== null && a.budgetMinor > 0 && a.amountMinor * LARGE_BUDGET_DIVISOR >= a.budgetMinor) return true;
  return a.currency === "TWD" && a.amountMinor >= LARGE_TWD_MINOR;
}

/**
 * The moment a record belongs to. The first rule that fits wins: income, then a
 * big expense, then what the food was by its title or the Taiwan clock, then
 * the category, and otherwise "general".
 */
export function moodBucket(a: MoodBucketInput): MoodBucket {
  if (a.kind === "income") return "income";
  if (isLarge(a)) return "large";
  if (a.category === "food") return foodBucket(a.title, a.taiwanMinuteOfDay);
  // An own-property check: the category is data, and "constructor" must not come back as a function.
  return Object.hasOwn(CATEGORY_BUCKETS, a.category) ? CATEGORY_BUCKETS[a.category] : "general";
}

export type LineStreakStats = {
  streakDays: number;
  /** Monday first; true where the day has an entry. Always seven. */
  week: boolean[];
  /** 0 = Monday ... 6 = Sunday. */
  todayIndex: number;
  monthDays: number;
  todayEntries: number;
  totalEntries: number;
};

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * The streak numbers line_streak sent, or null when they are not exactly what
 * was promised. The RPC answers with `unknown` on purpose: the mood card is
 * garnish, and a wrong shape must cost the card its streak section, never the
 * reply (a week of six days, a today_index of 7 or a string where a count
 * belongs are all "no streak").
 */
export function parseStreakStats(raw: unknown): LineStreakStats | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const s = raw as Record<string, unknown>;

  const week = s.week;
  if (!Array.isArray(week) || week.length !== 7 || !week.every((day) => typeof day === "boolean")) return null;

  const todayIndex = s.today_index;
  if (typeof todayIndex !== "number" || !Number.isInteger(todayIndex) || todayIndex < 0 || todayIndex > 6) return null;

  if (!count(s.streak_days) || !count(s.month_days) || !count(s.today_entries) || !count(s.total_entries)) return null;

  return {
    streakDays: s.streak_days,
    week: [...(week as boolean[])],
    todayIndex,
    monthDays: s.month_days,
    todayEntries: s.today_entries,
    totalEntries: s.total_entries,
  };
}

/**
 * FNV-1a, 32 bits, over the UTF-8 bytes of `seed`, reduced to 0..count-1. The
 * seed is the webhook event key, so a redelivered event picks the same variant;
 * nothing in here reads the clock or a random source. A `count` that is not a
 * positive integer gives 0.
 */
export function variantIndex(seed: string, count: number): number {
  if (!Number.isInteger(count) || count < 1) return 0;

  let hash = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(seed)) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0) % count;
}

/** The streak lengths with their own line, and the ones that share the "{days} in a row" one. */
const STREAK_NOTES = { 3: "streak3", 7: "streak7", 14: "streak14", 30: "streak30", 100: "streak100", 365: "streak365" } as const;
const OTHER_STREAKS: ReadonlySet<number> = new Set([21, 50, 200, 300]);
const TOTAL_NOTES: ReadonlySet<number> = new Set([10, 50, 100, 500, 1000]);

export type MoodPick = {
  bucket: MoodBucket;
  shortLine: string;
  note: string;
  noteKind: "milestone" | "encouragement";
  /** null exactly when there are no streak stats. */
  streakLine: string | null;
  statsLine: string | null;
};

/**
 * The words for one record: the short line for its bucket, then the second line
 * - a milestone if the numbers hit one, in this order: the very first entry, a
 * streak length, an entry count, the first entry of a month - else an
 * encouragement. With no stats there are no numbers to be proud of, so always an
 * encouragement and no streak lines. The variants are chosen by `seed`, with a
 * different salt for each so the two choices do not move together.
 */
export function pickMood(copy: LineMoodCopy, a: { seed: string; bucket: MoodBucket; stats: LineStreakStats | null }): MoodPick {
  const variants = copy.short[a.bucket];
  const shortLine = variants[variantIndex(`${a.seed}:s`, variants.length)];
  const encouragement = copy.encouragement[variantIndex(`${a.seed}:e`, copy.encouragement.length)];

  const stats = a.stats;
  if (stats === null) {
    return { bucket: a.bucket, shortLine, note: encouragement, noteKind: "encouragement", streakLine: null, statsLine: null };
  }

  const milestone = milestoneNote(copy, stats);
  return {
    bucket: a.bucket,
    shortLine,
    note: milestone ?? encouragement,
    noteKind: milestone === null ? "encouragement" : "milestone",
    streakLine: fill(copy.streakLine, { days: stats.streakDays }),
    statsLine: fill(copy.statsLine, { days: stats.monthDays, count: stats.todayEntries }),
  };
}

function milestoneNote(copy: LineMoodCopy, stats: LineStreakStats): string | null {
  if (stats.totalEntries === 1) return copy.milestones.firstEver;

  if (Object.hasOwn(STREAK_NOTES, stats.streakDays)) {
    return copy.milestones[STREAK_NOTES[stats.streakDays as keyof typeof STREAK_NOTES]];
  }
  if (OTHER_STREAKS.has(stats.streakDays)) return fill(copy.milestones.streakOther, { days: stats.streakDays });

  if (TOTAL_NOTES.has(stats.totalEntries)) return fill(copy.milestones.total, { count: stats.totalEntries });
  if (stats.monthDays === 1 && stats.todayEntries === 1) return copy.milestones.firstOfMonth;
  return null;
}

/** The mood card's altText - what the chat list and the notification show: the short line and, with a streak, its length. */
export function moodAltText(pick: MoodPick): string {
  return pick.streakLine === null ? pick.shortLine : `${pick.shortLine}\n${pick.streakLine}`;
}

/** Everything the card says as plain text: the mood card's fallback when LINE refuses the card. */
export function moodPlainText(pick: MoodPick): string {
  const lines = [pick.shortLine, pick.note];
  if (pick.streakLine !== null) lines.push(pick.streakLine);
  if (pick.statsLine !== null) lines.push(pick.statsLine);
  return lines.join("\n");
}
