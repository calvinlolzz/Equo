import type { Locale } from "../../app/i18n/locale";

/**
 * The words that go on a lock screen.
 *
 * Kept apart from the app's UI dictionary on purpose. These are read by someone
 * who has not opened the app, in a strip of text a phone will truncate - so
 * they are written short and they answer "do I care", which is a different job
 * from labelling a button. Sharing one dictionary would invite reusing an
 * in-app phrase here and quietly producing a notification nobody can parse at a
 * glance.
 *
 * Sentences with a moving part are whole templates with {placeholders} rather
 * than fragments a caller joins: Chinese and English disagree about where the
 * name, the amount and the verb go, and there is no join order that serves
 * both.
 */
export type PushDictionary = {
  fallbackGroupName: string;
  fallbackActorName: string;
  /** "{who} recorded a settlement of {amount}" */
  expenseTransfer: string;
  expenseIncome: string;
  expenseDefault: string;
  addExpenseAction: string;
  nudge: string;
  autoNudge: string;
  memberJoined: string;
  comment: string;
  commentNoTitle: string;
  errorAlertNew: string;
  errorAlertAgain: string;
  errorAlertBody: string;
};

const ZH_HANT: PushDictionary = {
  fallbackGroupName: "Equo",
  fallbackActorName: "有人",
  expenseTransfer: "{who} 記錄了一筆清償 {amount}",
  expenseIncome: "{who} 記了一筆收入：{title} {amount}",
  expenseDefault: "{who} 記了一筆：{title} {amount}",
  addExpenseAction: "記一筆",
  nudge: "{who} 提醒你還有 {amount} 未結清",
  autoNudge: "你還有 {amount} 未結清",
  memberJoined: "{who} 加入了群組",
  comment: "{who} 在「{title}」說：{body}",
  commentNoTitle: "{who} 說：{body}",
  errorAlertNew: "Equo 出現新錯誤",
  errorAlertAgain: "Equo 錯誤又出現了",
  errorAlertBody: "{summary}（24 小時內 {count} 次）",
};

const EN: PushDictionary = {
  fallbackGroupName: "Equo",
  fallbackActorName: "Someone",
  expenseTransfer: "{who} recorded a settlement of {amount}",
  expenseIncome: "{who} added income: {title} {amount}",
  expenseDefault: "{who} added {title} {amount}",
  addExpenseAction: "Add expense",
  nudge: "{who} reminded you that {amount} is still unsettled",
  autoNudge: "You still have {amount} unsettled",
  memberJoined: "{who} joined the group",
  comment: "{who} said on “{title}”: {body}",
  commentNoTitle: "{who} said: {body}",
  errorAlertNew: "New error in Equo",
  errorAlertAgain: "That Equo error is back",
  errorAlertBody: "{summary} ({count} times in 24h)",
};

const DICTIONARIES: Record<Locale, PushDictionary> = { "zh-Hant": ZH_HANT, en: EN };

/**
 * The dictionary for one device.
 *
 * `locale` is whatever that subscription reported when it was saved, which is
 * null for every device that subscribed before this shipped and for any client
 * too old to send it. Those fall back to 繁體中文 rather than to English: it is
 * what they have been receiving, and silently switching somebody's phone to a
 * language they did not ask for is worse than leaving it where it was.
 */
export function pushText(locale: string | null | undefined): PushDictionary {
  if (locale && locale in DICTIONARIES) return DICTIONARIES[locale as Locale];
  return ZH_HANT;
}

/** Fill {placeholders}. Absent keys are left alone rather than blanked. */
export function fill(template: string, values: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in values ? String(values[key]) : whole,
  );
}
