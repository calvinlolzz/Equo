import type { Locale } from "../../app/i18n/locale.js";

/**
 * Reply text for the LINE bot, on the same footing as server/push/pushText.ts:
 * typed as a `Record<Locale, LineDictionary>` so a locale missing a key is a
 * compile error, not a blank bubble somebody notices in production.
 */
export type LineDictionary = {
  welcome: string;
  welcomeBack: string;
  linkPrompt: string;
  linkButton: string;
  linkAltText: string;
  linkUnavailable: string;
  linked: string;
  linkFailed: string;
  alreadyLinked: string;
  unlinked: string;
  notLinked: string;
  recordedExpense: string;
  budgetLeftSuffix: string;
  budgetOverSuffix: string;
  recordedIncome: string;
  monthLabel: string;
  monthSummary: string;
  budgetLeftLine: string;
  budgetOverLine: string;
  undone: string;
  undoNothing: string;
  undoAlreadyGone: string;
  help: string;
  notUnderstood: string;
  multipleAmounts: string;
  missingTitle: string;
  invalidAmount: string;
  noDecimals: string;
  amountTooLarge: string;
  titleTooLong: string;
  dateNotSupported: string;
  nonText: string;
  groupNotSupported: string;
  maintenance: string;
  rateLimited: string;
  accountDisabled: string;
  noLedger: string;
  genericError: string;
  undoLabel: string;
  undoText: string;
  monthButtonLabel: string;
  monthText: string;
  openLedgerLabel: string;
  budgetSet: string;
  budgetShow: string;
  budgetRemainingLeft: string;
  budgetRemainingOver: string;
  budgetNone: string;
  budgetCleared: string;
  budgetInvalid: string;
  budgetTooLarge: string;
  budgetAmbiguous: string;

  // Copy for the Flex reply cards (lineCards.ts). Each *Cmd value is a list of
  // example commands joined by " · " (U+00B7 with spaces); lineText.test.ts
  // splits on it and parses every example, so a command a card teaches always
  // does what the card says. Emoji are not prose and live in lineCardTheme.ts.
  cardExpenseTitle: string;
  cardIncomeTitle: string;
  cardDate: string;
  cardMonthSpent: string;
  cardMonthIncome: string;
  cardBudgetOf: string;
  cardSpentLabel: string;
  cardIncomeLabel: string;
  cardNetLabel: string;
  cardByCategory: string;
  cardOtherCategories: string;
  cardNoSpending: string;
  cardBudgetSetTitle: string;
  cardBudgetShowTitle: string;
  cardBudgetUsed: string;
  cardBudgetHint: string;
  helpCardTitle: string;
  helpCardLead: string;
  helpExpenseTitle: string;
  helpExpenseCmd: string;
  helpIncomeTitle: string;
  helpIncomeCmd: string;
  helpMonthTitle: string;
  helpMonthCmd: string;
  helpBudgetTitle: string;
  helpBudgetCmd: string;
  helpUndoTitle: string;
  helpUndoCmd: string;
  helpUnlinkTitle: string;
  helpUnlinkCmd: string;
  helpCardNote: string;
  welcomeCardTitle: string;
  linkCardTitle: string;
  linkedCardTitle: string;
  linkedCardHint: string;
};

const ZH_HANT: LineDictionary = {
  welcome: "你好，我是 Equo 記帳小幫手。連結 Equo 帳號後，傳「早餐 60」就能記進你的個人帳本。",
  welcomeBack: "歡迎回來！直接傳「早餐 60」就能記帳，傳「說明」看所有指令。",
  linkPrompt: "先連結你的 Equo 帳號才能開始記帳。連結後隨時可以傳「解除綁定」取消。",
  linkButton: "連結 Equo 帳號",
  linkAltText: "連結 Equo 帳號",
  linkUnavailable: "現在無法產生連結，請稍後傳「綁定」再試一次。",
  linked: "已連結 Equo 帳號（{email}）。試試傳「早餐 60」，或傳「說明」看所有指令。",
  linkFailed: "連結沒有完成，可能是連結已過期。請點下方按鈕重新連結。",
  alreadyLinked: "你已經連結 Equo 帳號（{email}）。要改連其他帳號，請先傳「解除綁定」。",
  unlinked: "已解除與 Equo 帳號的連結。想再記帳時，傳「綁定」就能重新連結。",
  notLinked: "目前沒有連結任何 Equo 帳號。",
  recordedExpense: "已記下支出：{title} {amount}（{category}）\n本月支出 {spent}{budget}",
  budgetLeftSuffix: "，預算剩 {left}",
  budgetOverSuffix: "，已超出預算 {over}",
  recordedIncome: "已記下收入：{title} {amount}（{category}）\n本月收入 {income}",
  monthLabel: "本月（{year} 年 {month} 月）",
  monthSummary: "{month}\n支出 {spent}\n收入 {income}\n結餘 {net}",
  budgetLeftLine: "\n預算剩餘 {left}",
  budgetOverLine: "\n超出預算 {over}",
  undone: "已刪除：{title} {amount}",
  undoNothing: "沒有可以復原的記錄。只能復原 {minutes} 分鐘內從 LINE 記下的記錄。",
  undoAlreadyGone: "上一筆已經在 App 裡修改或刪除了，請到 App 查看。",
  help: "Equo 記帳小幫手指令：\n・記支出：早餐 60、60 早餐、午餐 120 餐飲\n・記收入：+52000 薪水、收入 52000 薪水\n・本月：本月支出、收入與預算\n・預算：傳「預算 15000」設定或修改每月預算，「預算」查看，「取消預算」取消\n・復原：刪除 {minutes} 分鐘內從 LINE 記的最後一筆\n・解除綁定：取消與 Equo 帳號的連結\n日期以台灣時間計算。",
  notUnderstood: "看不懂這句話。記帳請傳「項目 金額」，例如「早餐 60」；傳「說明」看所有指令。",
  multipleAmounts: "一次只能記一筆，這句有好幾個金額。請分開傳，例如「午餐 120」。",
  missingTitle: "請加上項目名稱，例如「早餐 60」。",
  invalidAmount: "金額看起來不對。請用大於 0 的數字，最多兩位小數，例如「咖啡 85」。",
  noDecimals: "{currency} 金額不能有小數。",
  amountTooLarge: "金額太大了，這筆請到 App 裡記。",
  titleTooLong: "項目名稱太長了（最多 60 字）。",
  dateNotSupported: "日期請到 App 裡修改，LINE 記帳一律記在今天。",
  nonText: "目前只看得懂文字。傳「說明」看怎麼用。",
  groupNotSupported: "目前只支援一對一私訊記帳，群組分帳還在準備中，我先離開這個群組。",
  maintenance: "Equo 正在維護，暫時無法記帳，請稍後再試。",
  rateLimited: "傳得有點快，請稍等一下再試。",
  accountDisabled: "這個 Equo 帳號已被停用。",
  noLedger: "還找不到你的個人帳本，請先開啟一次 Equo App。",
  genericError: "出了點問題，請稍後再試。",
  undoLabel: "復原",
  undoText: "復原",
  monthButtonLabel: "本月",
  monthText: "本月",
  openLedgerLabel: "開啟帳本",
  budgetSet: "每月預算已設為 {budget}。\n本月已花 {spent}，{remaining}",
  budgetShow: "每月預算 {budget}\n本月已花 {spent}，{remaining}",
  budgetRemainingLeft: "還剩 {left}",
  budgetRemainingOver: "已超出 {over}",
  budgetNone: "還沒有設定每月預算。傳「預算 15000」就能設定。",
  budgetCleared: "已取消每月預算。",
  budgetInvalid: "預算請用大於 0 的金額，例如「預算 15000」。要取消預算請傳「取消預算」。",
  budgetTooLarge: "預算金額太大了，請到 App 裡設定。",
  budgetAmbiguous: "是要設定每月預算嗎？請傳「預算 15000」；要記一筆支出，請換個項目名稱，例如「買預算書 200」。",

  cardExpenseTitle: "已記下支出",
  cardIncomeTitle: "已記下收入",
  cardDate: "{month}月{day}日",
  cardMonthSpent: "本月支出",
  cardMonthIncome: "本月收入",
  cardBudgetOf: "預算 {budget}",
  cardSpentLabel: "支出",
  cardIncomeLabel: "收入",
  cardNetLabel: "結餘",
  cardByCategory: "支出分類",
  cardOtherCategories: "其餘分類",
  cardNoSpending: "這個月還沒有支出",
  cardBudgetSetTitle: "已設定每月預算",
  cardBudgetShowTitle: "每月預算",
  cardBudgetUsed: "已用 {percent}%",
  cardBudgetHint: "傳「預算 20000」修改，傳「取消預算」取消",
  helpCardTitle: "Equo 記帳小幫手",
  helpCardLead: "直接傳一句話就能記帳",
  helpExpenseTitle: "記支出",
  helpExpenseCmd: "早餐 60 · 午餐 120 餐飲",
  helpIncomeTitle: "記收入",
  helpIncomeCmd: "+52000 薪水 · 收入 52000 薪水",
  helpMonthTitle: "本月支出、收入與預算",
  helpMonthCmd: "本月",
  helpBudgetTitle: "設定、查看或取消每月預算",
  helpBudgetCmd: "預算 15000 · 預算 · 取消預算",
  helpUndoTitle: "刪除 {minutes} 分鐘內從 LINE 記的最後一筆",
  helpUndoCmd: "復原",
  helpUnlinkTitle: "取消與 Equo 帳號的連結",
  helpUnlinkCmd: "解除綁定",
  helpCardNote: "日期以台灣時間計算。",
  welcomeCardTitle: "歡迎使用 Equo 記帳",
  linkCardTitle: "連結你的 Equo 帳號",
  linkedCardTitle: "已連結 Equo 帳號",
  linkedCardHint: "試試傳「早餐 60」記下第一筆，或傳「說明」看所有指令。",
};

const EN: LineDictionary = {
  welcome:
    'Hi, I\'m the Equo bookkeeping bot. Link your Equo account, then send "breakfast 60" to record it in your personal ledger.',
  welcomeBack: 'Welcome back! Send "breakfast 60" to record, or "help" for all commands.',
  linkPrompt: 'Link your Equo account to start recording. You can send "unlink" anytime to undo it.',
  linkButton: "Link Equo account",
  linkAltText: "Link your Equo account",
  linkUnavailable: 'Couldn\'t create a link right now. Send "link" again in a moment.',
  linked: 'Linked to your Equo account ({email}). Try sending "breakfast 60", or "help" for all commands.',
  linkFailed: "Linking didn't finish — the link may have expired. Tap below to try again.",
  alreadyLinked: 'You\'re already linked to {email}. To switch accounts, send "unlink" first.',
  unlinked: 'Unlinked from your Equo account. Send "link" whenever you want to reconnect.',
  notLinked: "No Equo account is linked.",
  recordedExpense: "Recorded expense: {title} {amount} ({category})\nSpent this month: {spent}{budget}",
  budgetLeftSuffix: ", {left} left in budget",
  budgetOverSuffix: ", {over} over budget",
  recordedIncome: "Recorded income: {title} {amount} ({category})\nIncome this month: {income}",
  monthLabel: "This month ({year}-{month2})",
  monthSummary: "{month}\nSpent {spent}\nIncome {income}\nNet {net}",
  budgetLeftLine: "\nBudget left {left}",
  budgetOverLine: "\nOver budget by {over}",
  undone: "Deleted: {title} {amount}",
  undoNothing: "Nothing to undo. Only entries recorded from LINE in the last {minutes} minutes can be undone.",
  undoAlreadyGone: "That entry was already edited or deleted in the app.",
  help:
    'Equo bot commands:\n• Expense: breakfast 60, 60 breakfast, lunch 120 Food\n• Income: +52000 salary, income 52000 salary\n• month: this month\'s spending, income and budget\n• budget 15000: set or change your monthly budget ("budget" to view, "budget off" to remove)\n• undo: delete the last entry recorded from LINE in the past {minutes} minutes\n• unlink: disconnect your Equo account\nDates use Taiwan time.',
  notUnderstood: 'I didn\'t get that. To record, send "item amount", e.g. "breakfast 60". Send "help" for all commands.',
  multipleAmounts: 'One entry at a time, please — I found more than one amount. Send them separately, e.g. "lunch 120".',
  missingTitle: 'Add what it was for, e.g. "breakfast 60".',
  invalidAmount: 'That amount doesn\'t look right. Use a number above 0 with at most two decimals, e.g. "coffee 85".',
  noDecimals: "{currency} amounts can't have decimals.",
  amountTooLarge: "That amount is too large — please record it in the app.",
  titleTooLong: "The description is too long (60 characters max).",
  dateNotSupported: "To change the date, use the app — LINE entries are dated today.",
  nonText: 'I can only read text for now. Send "help" to see how.',
  groupNotSupported: "I only work in one-on-one chats for now — group splitting is coming. I'll leave this group.",
  maintenance: "Equo is under maintenance. Recording is paused — please try again later.",
  rateLimited: "That's a lot of messages — please wait a moment and try again.",
  accountDisabled: "This Equo account has been disabled.",
  noLedger: "Couldn't find your personal ledger yet — open the Equo app once first.",
  genericError: "Something went wrong. Please try again later.",
  undoLabel: "Undo",
  undoText: "undo",
  monthButtonLabel: "This month",
  monthText: "month",
  openLedgerLabel: "Open ledger",
  budgetSet: "Monthly budget set to {budget}.\nSpent this month: {spent}, {remaining}",
  budgetShow: "Monthly budget: {budget}\nSpent this month: {spent}, {remaining}",
  budgetRemainingLeft: "{left} left",
  budgetRemainingOver: "{over} over",
  budgetNone: 'No monthly budget yet. Send "budget 15000" to set one.',
  budgetCleared: "Monthly budget removed.",
  budgetInvalid: 'The budget must be an amount above 0, e.g. "budget 15000". To remove it, send "budget off".',
  budgetTooLarge: "That budget is too large — please set it in the app.",
  budgetAmbiguous:
    'Did you mean to set your monthly budget? Send "budget 15000". To record an expense, use a different item name.',

  cardExpenseTitle: "Expense recorded",
  cardIncomeTitle: "Income recorded",
  cardDate: "{month}/{day}",
  cardMonthSpent: "Spent this month",
  cardMonthIncome: "Income this month",
  cardBudgetOf: "Budget {budget}",
  cardSpentLabel: "Spent",
  cardIncomeLabel: "Income",
  cardNetLabel: "Net",
  cardByCategory: "By category",
  cardOtherCategories: "Other categories",
  cardNoSpending: "No spending yet this month",
  cardBudgetSetTitle: "Monthly budget set",
  cardBudgetShowTitle: "Monthly budget",
  cardBudgetUsed: "{percent}% used",
  cardBudgetHint: 'Send "budget 20000" to change it, or "budget off" to remove it',
  helpCardTitle: "Equo bookkeeping bot",
  helpCardLead: "Just send a message to record",
  helpExpenseTitle: "Record an expense",
  helpExpenseCmd: "breakfast 60 · lunch 120 Food",
  helpIncomeTitle: "Record income",
  helpIncomeCmd: "+52000 salary · income 52000 salary",
  helpMonthTitle: "This month's spending, income and budget",
  helpMonthCmd: "month",
  helpBudgetTitle: "Set, view or remove your monthly budget",
  helpBudgetCmd: "budget 15000 · budget · budget off",
  helpUndoTitle: "Delete your last LINE entry (within {minutes} minutes)",
  helpUndoCmd: "undo",
  helpUnlinkTitle: "Disconnect your Equo account",
  helpUnlinkCmd: "unlink",
  helpCardNote: "Dates use Taiwan time.",
  welcomeCardTitle: "Welcome to Equo",
  linkCardTitle: "Link your Equo account",
  linkedCardTitle: "Equo account linked",
  linkedCardHint: 'Try "breakfast 60" for your first entry, or send "help" for all commands.',
};

const LINE_TEXT: Record<Locale, LineDictionary> = { "zh-Hant": ZH_HANT, en: EN };

/** The dictionary for one bot reply. Falls back to 繁體中文, same as pushText. */
export function lineText(locale: string | null | undefined): LineDictionary {
  if (locale && locale in LINE_TEXT) return LINE_TEXT[locale as Locale];
  return ZH_HANT;
}

export { LINE_TEXT, ZH_HANT as LINE_TEXT_ZH_HANT, EN as LINE_TEXT_EN };
