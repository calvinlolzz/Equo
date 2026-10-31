import { formatAmount } from "../../app/formatAmount.js";
import { fill } from "../push/pushText.js";
import { helpCard } from "./lineCards.js";
import { redactForLog } from "./lineCrypto.js";
import type {
  LineAction,
  LineFlexMessage,
  LineMessage,
  LineQuickReply,
  LineTemplateMessage,
  LineTextMessage,
} from "./lineFlex.js";
import type { LineDictionary } from "./lineText.js";
import type { LineMonthTotals, RecordLineEntryResult } from "./lineRepository.js";

/**
 * Builders for the messages this bot sends. Kept apart from lineWebhook.ts so
 * the "what does the reply look like" concern is separate from "what
 * triggers a reply" - see the LINE reference for the message object shapes:
 * https://developers.line.biz/en/reference/messaging-api/#message-objects
 */

export function textMessage(text: string, quickReply?: LineQuickReply): LineTextMessage {
  return quickReply ? { type: "text", text, quickReply } : { type: "text", text };
}

/** The closed set of card names. They are the only thing about a card that reaches a log line. */
export type LineCardName = "record" | "month" | "budget" | "help" | "link" | "linked";

/**
 * A Flex card together with what to send if LINE refuses it. `fallback` is
 * exactly the plain reply this card replaced - same text, same quick reply,
 * same link button - so the worst a rejected card can do is look like the bot
 * did yesterday. `message` is null when building the card threw; the wire then
 * carries the fallback straight away.
 *
 * This is NOT a LINE message (it has no `type`), and LineMessage no longer
 * lets it pose as one: it cannot be passed to LineClient.reply, only to
 * wireMessages / fallbackMessages, which turn it into real messages.
 */
export type LineCard = {
  kind: "card";
  name: LineCardName;
  message: LineFlexMessage | null;
  fallback: LineMessage[];
};

/** What a handler hands to safeReply: plain messages and cards, in the order they are shown. */
export type LineOutgoing = LineMessage | LineCard;

export function isLineCard(item: LineOutgoing): item is LineCard {
  return "kind" in item && item.kind === "card";
}

/**
 * Builds a card, or - if the builder throws - falls back to `fallback` and
 * says so in the log. A rendering bug must never cost the user the reply to
 * something that already happened (an entry saved, a budget set): the card is
 * decoration, so its failure is logged and swallowed.
 *
 * The log line carries the card's name and the error message, redacted for a
 * LINE user id. It never carries the card's content.
 */
export function cardOrFallback(name: LineCardName, build: () => LineFlexMessage, fallback: LineMessage[]): LineCard {
  try {
    return { kind: "card", name, message: build(), fallback };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`[line] card build failed (${name}): ${redactForLog(message)}`);
    return { kind: "card", name, message: null, fallback };
  }
}

/** The messages to put on the wire: a card as its Flex message (or, when it did not build, its fallback), anything else untouched. */
export function wireMessages(items: readonly LineOutgoing[]): LineMessage[] {
  return items.flatMap((item) => (isLineCard(item) ? (item.message ? [item.message] : item.fallback) : [item]));
}

/** What to send when LINE refuses the cards: every card as its plain fallback, anything else untouched. */
export function fallbackMessages(items: readonly LineOutgoing[]): LineMessage[] {
  return items.flatMap((item) => (isLineCard(item) ? item.fallback : [item]));
}

function quickReply(actions: readonly LineAction[]): LineQuickReply {
  return { items: actions.map((action) => ({ type: "action" as const, action })) };
}

export function linkPageUrl(appOrigin: string, linkToken: string): string {
  return `${appOrigin}/line/link?linkToken=${encodeURIComponent(linkToken)}&openExternalBrowser=1`;
}

/** A buttons template carrying one uri action to the /line/link page. */
export function linkButtonsMessage(dict: LineDictionary, url: string, text?: string): LineTemplateMessage {
  return {
    type: "template",
    altText: dict.linkAltText,
    template: {
      type: "buttons",
      text: text ?? dict.linkPrompt,
      actions: [{ type: "uri", label: dict.linkButton, uri: url }],
    },
  };
}

export function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return email;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  return `${local.slice(0, 2)}***@${domain}`;
}

function ledgerUri(appOrigin: string, ledgerId: string): string {
  return `${appOrigin}/group/${ledgerId}?openExternalBrowser=1`;
}

function recordQuickReply(dict: LineDictionary, appOrigin: string, ledgerId: string) {
  return quickReply([
    { type: "message", label: dict.undoLabel, text: dict.undoText },
    { type: "message", label: dict.monthButtonLabel, text: dict.monthText },
    { type: "uri", label: dict.openLedgerLabel, uri: ledgerUri(appOrigin, ledgerId) },
  ]);
}

function budgetQuickReply(dict: LineDictionary, appOrigin: string, ledgerId: string) {
  return quickReply([
    { type: "message", label: dict.monthButtonLabel, text: dict.monthText },
    { type: "uri", label: dict.openLedgerLabel, uri: ledgerUri(appOrigin, ledgerId) },
  ]);
}

/** The suffix appended to "本月支出 {spent}" when the ledger has a budget set. Empty string when it doesn't. */
function budgetSuffix(dict: LineDictionary, currency: string, budgetMinor: number | null, spentMinor: number): string {
  if (!budgetMinor || budgetMinor <= 0) return "";
  const left = budgetMinor - spentMinor;
  if (left >= 0) return fill(dict.budgetLeftSuffix, { left: formatAmount(left, currency) });
  return fill(dict.budgetOverSuffix, { over: formatAmount(Math.abs(left), currency) });
}

function budgetLine(dict: LineDictionary, currency: string, budgetMinor: number | null, spentMinor: number): string {
  if (!budgetMinor || budgetMinor <= 0) return "";
  const left = budgetMinor - spentMinor;
  if (left >= 0) return fill(dict.budgetLeftLine, { left: formatAmount(left, currency) });
  return fill(dict.budgetOverLine, { over: formatAmount(Math.abs(left), currency) });
}

/** The reply for a successful record (expense or income), with the undo/month/open-ledger quick replies. */
export function recordedReply(
  dict: LineDictionary,
  args: {
    kind: "expense" | "income";
    title: string;
    amountMinor: number;
    categoryLabel: string;
    currency: string;
    budgetMinor: number | null;
    month: LineMonthTotals;
    ledgerId: string;
    appOrigin: string;
  },
): LineMessage {
  const amount = formatAmount(args.amountMinor, args.currency);
  const text =
    args.kind === "expense"
      ? fill(dict.recordedExpense, {
          title: args.title,
          amount,
          category: args.categoryLabel,
          spent: formatAmount(args.month.expense_minor, args.currency),
          budget: budgetSuffix(dict, args.currency, args.budgetMinor, args.month.expense_minor),
        })
      : fill(dict.recordedIncome, {
          title: args.title,
          amount,
          category: args.categoryLabel,
          income: formatAmount(args.month.income_minor, args.currency),
        });

  return textMessage(text, recordQuickReply(dict, args.appOrigin, args.ledgerId));
}

/** The "本月" summary reply. */
export function monthReply(
  dict: LineDictionary,
  args: { year: number; month: number; currency: string; budgetMinor: number | null; month_totals: LineMonthTotals; ledgerId: string; appOrigin: string },
): LineMessage {
  const monthLabel = fill(dict.monthLabel, {
    year: args.year,
    month: args.month,
    month2: String(args.month).padStart(2, "0"),
  });

  const spent = formatAmount(args.month_totals.expense_minor, args.currency);
  const income = formatAmount(args.month_totals.income_minor, args.currency);
  const net = formatAmount(args.month_totals.income_minor - args.month_totals.expense_minor, args.currency);

  const body =
    fill(dict.monthSummary, { month: monthLabel, spent, income, net }) +
    budgetLine(dict, args.currency, args.budgetMinor, args.month_totals.expense_minor);

  return textMessage(
    body,
    quickReply([{ type: "uri", label: dict.openLedgerLabel, uri: ledgerUri(args.appOrigin, args.ledgerId) }]),
  );
}

/** "還剩 {left}" / "已超出 {over}" for the budget replies. */
function budgetRemaining(dict: LineDictionary, currency: string, budgetMinor: number, spentMinor: number): string {
  const left = budgetMinor - spentMinor;
  if (left >= 0) return fill(dict.budgetRemainingLeft, { left: formatAmount(left, currency) });
  return fill(dict.budgetRemainingOver, { over: formatAmount(Math.abs(left), currency) });
}

/**
 * The reply to viewing ("show") or just having set ("set") the monthly budget.
 * A ledger with no budget gets the "how to set one" text in either mode.
 */
export function budgetReply(
  dict: LineDictionary,
  args: {
    mode: "set" | "show";
    currency: string;
    budgetMinor: number | null;
    spentMinor: number;
    ledgerId: string;
    appOrigin: string;
  },
): LineMessage {
  const qr = budgetQuickReply(dict, args.appOrigin, args.ledgerId);
  if (args.budgetMinor === null || args.budgetMinor <= 0) return textMessage(dict.budgetNone, qr);

  const text = fill(args.mode === "set" ? dict.budgetSet : dict.budgetShow, {
    budget: formatAmount(args.budgetMinor, args.currency),
    spent: formatAmount(args.spentMinor, args.currency),
    remaining: budgetRemaining(dict, args.currency, args.budgetMinor, args.spentMinor),
  });
  return textMessage(text, qr);
}

/** The reply to 「取消預算」. */
export function budgetClearedReply(dict: LineDictionary, args: { ledgerId: string; appOrigin: string }): LineMessage {
  return textMessage(dict.budgetCleared, budgetQuickReply(dict, args.appOrigin, args.ledgerId));
}

/** The plain-text help: also the help card's altText and its fallback. */
function helpText(dict: LineDictionary, undoWindowMinutes: number): string {
  return fill(dict.help, { minutes: undoWindowMinutes });
}

/** 「說明」: the help card, or the same list as plain text if LINE refuses it. */
export function helpReply(dict: LineDictionary, undoWindowMinutes: number): LineOutgoing {
  const plain = helpText(dict, undoWindowMinutes);
  return cardOrFallback(
    "help",
    () => helpCard(dict, { minutes: undoWindowMinutes, altText: plain }),
    [textMessage(plain)],
  );
}

/** Re-exported for callers that need the raw shape without the totals. */
export type { RecordLineEntryResult };
