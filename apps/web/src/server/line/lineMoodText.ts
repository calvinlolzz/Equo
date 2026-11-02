import type { Locale } from "../../app/i18n/locale.js";
import type { MoodBucket } from "./lineMood.js";

/**
 * The words of the mood card: a short line for the moment (by what was
 * recorded and when), an encouragement, the milestones that replace it, and the
 * streak strings. Kept apart from LineDictionary on purpose - it is a hundred
 * strings of voice, not UI labels - but typed the same way: a
 * `Record<Locale, LineMoodCopy>` whose shape is fixed by tuples, so a locale
 * that misses a bucket, a variant or a weekday is a compile error.
 *
 * The voice is plain and a little warm, in the first person at most: no mascot,
 * no kaomoji, and no emoji inside a string (the card draws its own emoji, and
 * lineMoodText.test.ts keeps the strings free of them, of U+FE0F and of mojibake).
 */

type Three = readonly [string, string, string];

export type LineMoodCopy = {
  /** Three short lines per bucket; the event key picks one. */
  short: Record<MoodBucket, Three>;
  /** The pool the second line is drawn from when nothing has a milestone. */
  encouragement: readonly [string, string, string, string, string, string, string, string];
  /** A milestone replaces the encouragement. `streakOther` takes {days}, `total` takes {count}. */
  milestones: {
    firstEver: string;
    firstOfMonth: string;
    streak3: string;
    streak7: string;
    streak14: string;
    streak30: string;
    streak100: string;
    streak365: string;
    streakOther: string;
    total: string;
  };
  /** "連續記帳 {days} 天" */
  streakLine: string;
  /** "本月記帳 {days} 天 · 今天第 {count} 筆" */
  statsLine: string;
  /** Monday first - the week row's labels. */
  weekdays: readonly [string, string, string, string, string, string, string];
};

const ZH_HANT: LineMoodCopy = {
  short: {
    breakfast: ["早餐記好了，今天有個好的開始。", "吃飽才有力氣，早安！", "一早就把帳記好，今天的節奏很穩。"],
    lunch: ["午餐記好了，好好吃飯吧。", "中午補充能量，下午繼續加油。", "午餐記下來，下午花多少心裡也有數。"],
    afternoon: ["來杯飲料喘口氣，辛苦了。", "小確幸也值得記下來。", "提個神，晚點繼續努力。"],
    dinner: ["晚餐記好了，今天辛苦了。", "好好吃頓晚餐，犒賞一下自己。", "一天快結束了，帳也跟上了。"],
    lateNight: ["宵夜也記得記，真的很自律。", "夜深了，記完早點休息。", "這麼晚還記得記帳，佩服。"],
    transport: ["出門一路順風！", "交通費記好了，路上小心。", "移動中也能隨手記，效率滿分。"],
    shopping: ["買到喜歡的東西了嗎？記下來就不會忘。", "花得明明白白，買得也開心。", "記下來，月底對帳就輕鬆了。"],
    entertainment: ["好好放鬆，玩得開心！", "娛樂也是生活的一部分，記好了。", "享受當下，數字交給我。"],
    health: ["照顧好自己，這筆花得值得。", "健康的花費，是給自己的投資。", "記好了，記得好好照顧自己。"],
    home: ["生活必要開銷，記好了。", "固定支出記下來，預算更好抓。", "把家裡的帳顧好，生活也更安心。"],
    education: ["投資自己，最划算。", "學習的花費記好了，繼續加油。", "今天也有在進步，很棒。"],
    income: ["有進帳！辛苦有了回報。", "收入記好了，也留一點給未來的自己吧。", "進帳的感覺真好，繼續保持。"],
    large: ["這筆比較大，記下來心裡就有底。", "大筆支出也記好了，月底不會嚇一跳。", "重要的花費，記清楚最安心。"],
    general: ["記好了，積少成多。", "又記下一筆，習慣正在養成。", "隨手記一筆，錢花去哪都清楚。"],
  },
  encouragement: [
    "記帳不用完美，持續就很厲害。",
    "每一筆都是更了解自己的線索。",
    "知道錢去哪裡，就是掌握生活的開始。",
    "小小一筆，累積起來就是清楚的帳本。",
    "今天的你，比昨天更清楚自己的花費。",
    "慢慢來，比較快。",
    "每一筆都是寫給未來自己的備忘。",
    "能持續記帳的人，真的很了不起。",
  ],
  milestones: {
    firstEver: "第一筆記好了！好的開始，就從這裡。",
    firstOfMonth: "新的一個月，從這一筆開始。",
    streak3: "連續 3 天了，習慣正在成形。",
    streak7: "整整一週沒漏，太穩了！",
    streak14: "連續兩週，你已經是記帳高手了。",
    streak30: "連續 30 天！一整個月都記得清清楚楚。",
    streak100: "連續 100 天，這份堅持很不簡單。",
    streak365: "連續一整年！向你致敬。",
    streakOther: "連續 {days} 天！繼續保持。",
    total: "這是你的第 {count} 筆記錄，累積的力量很驚人。",
  },
  streakLine: "連續記帳 {days} 天",
  statsLine: "本月記帳 {days} 天 · 今天第 {count} 筆",
  weekdays: ["一", "二", "三", "四", "五", "六", "日"],
};

const EN: LineMoodCopy = {
  short: {
    breakfast: [
      "Breakfast logged — a good start to the day.",
      "Fueled up. Good morning!",
      "Logged first thing — nice rhythm today.",
    ],
    lunch: [
      "Lunch is logged — go enjoy it.",
      "Midday refuel done. Keep going this afternoon.",
      "Lunch noted — the afternoon starts on track.",
    ],
    afternoon: ["A little break — you've earned it.", "Small treats count too.", "A quick pick-me-up, noted."],
    dinner: [
      "Dinner logged. Long day — well done.",
      "Enjoy dinner, you deserve it.",
      "The day's winding down and your books are up to date.",
    ],
    lateNight: [
      "Even the late-night snack — that's discipline.",
      "It's late. Logged — now get some rest.",
      "Logging at this hour. Impressive.",
    ],
    transport: ["Safe travels!", "Fare logged. Take care out there.", "Logging on the move — efficient."],
    shopping: [
      "Found something good? Now it's on the books.",
      "Spending with your eyes open.",
      "Noted — month-end will be easy.",
    ],
    entertainment: [
      "Have fun — you've earned the break.",
      "Fun is part of life too. Logged.",
      "Enjoy it. I've got the numbers.",
    ],
    health: [
      "Looking after yourself is money well spent.",
      "Spending on your health is an investment.",
      "Logged. Take good care of yourself.",
    ],
    home: ["Essentials logged.", "Fixed costs on the books make budgeting easier.", "Household books in order."],
    education: [
      "Investing in yourself always pays.",
      "Learning costs logged — keep going.",
      "Growing a little every day.",
    ],
    income: [
      "Money in! Your effort paid off.",
      "Income logged — set a little aside for future you.",
      "That feels good. Keep it up.",
    ],
    large: [
      "A bigger one — now it's on the books.",
      "Big expense logged — no month-end surprises.",
      "Important spending, clearly recorded.",
    ],
    general: [
      "Logged. Every entry counts.",
      "Another one — the habit is forming.",
      "One quick note and you know where it went.",
    ],
  },
  encouragement: [
    "It doesn't have to be perfect — keeping at it is what counts.",
    "Every entry tells you a little more about yourself.",
    "Knowing where it goes is where control begins.",
    "Small entries add up to a clear picture.",
    "You know your spending better than you did yesterday.",
    "Slow and steady gets there.",
    "Each entry is a note to future you.",
    "Sticking with it is the hard part — and you are.",
  ],
  milestones: {
    firstEver: "Your first entry! This is where it starts.",
    firstOfMonth: "A new month starts with this entry.",
    streak3: "3 days in a row — a habit is forming.",
    streak7: "A full week without a gap!",
    streak14: "Two weeks straight — you're a natural.",
    streak30: "30 days in a row — a whole month, fully tracked.",
    streak100: "100 days straight. That takes real commitment.",
    streak365: "A full year in a row. Hats off.",
    streakOther: "{days} days in a row! Keep it going.",
    total: "That's entry number {count}. It all adds up.",
  },
  streakLine: "{days}-day streak",
  statsLine: "{days} days logged this month · entry {count} today",
  weekdays: ["M", "T", "W", "T", "F", "S", "S"],
};

export const LINE_MOOD_TEXT: Record<Locale, LineMoodCopy> = { "zh-Hant": ZH_HANT, en: EN };

/** The mood copy for one reply. Falls back to 繁體中文, the way lineText does. */
export function lineMoodText(locale: string | null | undefined): LineMoodCopy {
  if (locale && Object.hasOwn(LINE_MOOD_TEXT, locale)) return LINE_MOOD_TEXT[locale as Locale];
  return ZH_HANT;
}
