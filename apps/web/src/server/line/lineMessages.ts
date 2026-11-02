import { formatAmount } from "../../app/formatAmount.js";
import { fill } from "../push/pushText.js";
import { type LineCategoryDisplay, linkHeroUrl } from "./lineCardTheme.js";
import {
  type MonthCategory,
  budgetCard,
  budgetRemainingText,
  helpCard,
  linkCard,
  linkedCard,
  monthCard,
  monthLabelText,
  moodCard,
  recordCard,
} from "./lineCards.js";
import { redactForLog } from "./lineCrypto.js";
import type {
  LineAction,
  LineFlexMessage,
  LineMessage,
  LineQuickReply,
  LineTemplateMessage,
  LineTextMessage,
} from "./lineFlex.js";
import type { LineLinks } from "./lineLinks.js";
import { type LineStreakStats, type MoodPick, moodAltText, moodPlainText } from "./lineMood.js";
import type { LineMoodCopy } from "./lineMoodText.js";
import { encodeLinePostback } from "./linePostback.js";
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
export type LineCardName = "record" | "mood" | "month" | "budget" | "help" | "link" | "linked";

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

/**
 * Puts `quickReply` on the LAST message of a reply, and only there: LINE
 * removes a quick reply when the account sends another message after it, so one
 * on any earlier message would never be seen. A card gets it twice - on its
 * Flex message and on the last message of its plain fallback - so the same
 * shortcuts are there whichever way the reply goes out. The one place a reply
 * decides where the shortcuts go: adding a message to the end of a reply moves
 * them with it.
 */
export function withQuickReply(items: readonly LineOutgoing[], quickReply: LineQuickReply): LineOutgoing[] {
  const last = items.at(-1);
  if (!last) return [];
  const head = items.slice(0, -1);

  if (!isLineCard(last)) return [...head, { ...last, quickReply }];

  const fallback = last.fallback.length === 0 ? [] : [...last.fallback.slice(0, -1), { ...last.fallback[last.fallback.length - 1], quickReply }];
  return [...head, { ...last, message: last.message ? { ...last.message, quickReply } : null, fallback }];
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

/**
 * The quick reply under a record: 復原 · 本月 · 明細 · 分析. 復原 and 本月 keep
 * the first two places they always had.
 */
export function recordQuickReply(dict: LineDictionary, links: LineLinks): LineQuickReply {
  return quickReply([
    { type: "message", label: dict.undoLabel, text: dict.undoText },
    { type: "message", label: dict.monthButtonLabel, text: dict.monthText },
    { type: "uri", label: dict.recordsLabel, uri: links.records },
    { type: "uri", label: dict.analysisLabel, uri: links.analysis },
  ]);
}

/**
 * The quick reply most replies to a linked user carry: 本月 · 明細 · 分析 · 說明.
 * `omit` leaves out the item for the very reply that answers it (the month card
 * has no 本月, the help card no 說明). With no `links` - a linked user whose
 * personal ledger does not exist yet - the two links are left out. Undefined
 * only when nothing is left.
 */
export function standardQuickReply(
  dict: LineDictionary,
  links: LineLinks | null,
  omit: ReadonlyArray<"month" | "help"> = [],
): LineQuickReply | undefined {
  const actions: LineAction[] = [];
  if (!omit.includes("month")) actions.push({ type: "message", label: dict.monthButtonLabel, text: dict.monthText });
  if (links) {
    actions.push({ type: "uri", label: dict.recordsLabel, uri: links.records });
    actions.push({ type: "uri", label: dict.analysisLabel, uri: links.analysis });
  }
  if (!omit.includes("help")) actions.push({ type: "message", label: dict.helpLabel, text: dict.helpText });
  return actions.length === 0 ? undefined : quickReply(actions);
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

/** "2026-09-21" -> "9月21日" / "9/21" in the dictionary's own format; empty when the key is not a date (the card then shows a dash). */
function recordDateText(dict: LineDictionary, dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return "";
  return fill(dict.cardDate, { month: Number(match[2]), day: Number(match[3]) });
}

/** The plain text of a recorded entry: also the record card's altText and its fallback. */
function recordedText(
  dict: LineDictionary,
  args: {
    kind: "expense" | "income";
    title: string;
    amountMinor: number;
    categoryLabel: string;
    currency: string;
    budgetMinor: number | null;
    month: LineMonthTotals;
  },
): string {
  const amount = formatAmount(args.amountMinor, args.currency);
  return args.kind === "expense"
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
}

/**
 * The reply for a successful record (expense or income): two messages. The
 * record card, with 編輯 and 刪除 in its footer, then the mood card (a line for
 * the moment, an encouragement and - when `stats` is there - the streak). The
 * undo/month/records/analysis quick reply goes under the LAST message, the mood
 * card, because LINE removes a quick reply when the account sends another
 * message after it. `dateKey` is the Taiwan-time date the entry was recorded
 * under (the same value sent as p_expense_date); `entryKey` is the event key it
 * was recorded under, which both footer buttons name.
 *
 * If LINE refuses the cards, the same two messages go out as text - the record
 * as today's one-liner, the mood as its lines - and the shortcuts under the
 * second. Neither text has buttons, so nothing in the fallback can send a postback.
 * A mood card that cannot be built degrades to that text by itself, and the
 * record card is untouched by it.
 */
export function recordedReply(
  dict: LineDictionary,
  mood: LineMoodCopy,
  args: {
    kind: "expense" | "income";
    title: string;
    amountMinor: number;
    category: LineCategoryDisplay;
    currency: string;
    budgetMinor: number | null;
    month: LineMonthTotals;
    dateKey: string;
    entryKey: string;
    links: LineLinks;
    pick: MoodPick;
    stats: LineStreakStats | null;
  },
): LineOutgoing[] {
  const altText = recordedText(dict, { ...args, categoryLabel: args.category.label });

  const record = cardOrFallback(
    "record",
    () =>
      recordCard(dict, {
        kind: args.kind,
        title: args.title,
        amountMinor: args.amountMinor,
        currency: args.currency,
        category: args.category,
        budgetMinor: args.budgetMinor,
        month: args.month,
        dateText: recordDateText(dict, args.dateKey),
        altText,
        editUri: args.links.entry(args.entryKey),
        deleteData: encodeLinePostback({ action: "delete_ask", entryKey: args.entryKey }),
      }),
    [textMessage(altText)],
  );

  const moodMessage = cardOrFallback(
    "mood",
    () => moodCard(mood, { pick: args.pick, stats: args.stats, altText: moodAltText(args.pick) }),
    [textMessage(moodPlainText(args.pick))],
  );

  return withQuickReply([record, moodMessage], recordQuickReply(dict, args.links));
}

/**
 * The "本月" summary reply. `categories` is the month's top expense categories
 * (already labelled), or undefined when the database did not return a
 * breakdown - the card then has no by-category section rather than a wrong one.
 */
export function monthReply(
  dict: LineDictionary,
  args: {
    year: number;
    month: number;
    currency: string;
    budgetMinor: number | null;
    month_totals: LineMonthTotals;
    categories?: readonly MonthCategory[];
    links: LineLinks;
  },
): LineOutgoing {
  const spent = formatAmount(args.month_totals.expense_minor, args.currency);
  const income = formatAmount(args.month_totals.income_minor, args.currency);
  const net = formatAmount(args.month_totals.income_minor - args.month_totals.expense_minor, args.currency);

  const altText =
    fill(dict.monthSummary, { month: monthLabelText(dict, args.year, args.month), spent, income, net }) +
    budgetLine(dict, args.currency, args.budgetMinor, args.month_totals.expense_minor);

  const link = args.links.ledger;
  const qr = standardQuickReply(dict, args.links, ["month"]);

  return cardOrFallback(
    "month",
    () =>
      monthCard(dict, {
        year: args.year,
        month: args.month,
        currency: args.currency,
        budgetMinor: args.budgetMinor,
        totals: args.month_totals,
        categories: args.categories,
        ledgerUri: link,
        altText,
        quickReply: qr,
      }),
    [textMessage(altText, qr)],
  );
}

/**
 * The reply to viewing ("show") or just having set ("set") the monthly budget:
 * a card. A ledger with no budget gets the "how to set one" text in either
 * mode, as a plain message - there is nothing to draw.
 */
export function budgetReply(
  dict: LineDictionary,
  args: {
    mode: "set" | "show";
    currency: string;
    budgetMinor: number | null;
    spentMinor: number;
    links: LineLinks;
  },
): LineOutgoing {
  const qr = standardQuickReply(dict, args.links);
  const { budgetMinor } = args;
  if (budgetMinor === null || budgetMinor <= 0) return textMessage(dict.budgetNone, qr);

  const altText = fill(args.mode === "set" ? dict.budgetSet : dict.budgetShow, {
    budget: formatAmount(budgetMinor, args.currency),
    spent: formatAmount(args.spentMinor, args.currency),
    remaining: budgetRemainingText(dict, args.currency, budgetMinor, args.spentMinor),
  });

  return cardOrFallback(
    "budget",
    () =>
      budgetCard(dict, {
        mode: args.mode,
        currency: args.currency,
        budgetMinor,
        spentMinor: args.spentMinor,
        altText,
        quickReply: qr,
      }),
    [textMessage(altText, qr)],
  );
}

/** The reply to 「取消預算」. */
export function budgetClearedReply(dict: LineDictionary, args: { links: LineLinks }): LineMessage {
  return textMessage(dict.budgetCleared, standardQuickReply(dict, args.links));
}

function entryAmountText(entry: { amountMinor: number; currency: string }): string {
  return formatAmount(entry.amountMinor, entry.currency);
}

/**
 * The question after a tap on 刪除: what is about to go, and the two ways to
 * answer. Plain text on purpose - a card is not worth building for a question
 * - and the answers are quick replies, which vanish with the next message.
 * `title` and the amount are the entry as it is NOW; `edited` says it has been
 * changed in the app since the card was made.
 */
export function deleteConfirmReply(
  dict: LineDictionary,
  args: { title: string; amountMinor: number; currency: string; edited: boolean; entryKey: string },
): LineTextMessage {
  const body = fill(args.edited ? dict.deleteConfirmEdited : dict.deleteConfirm, {
    title: args.title,
    amount: entryAmountText(args),
  });

  return textMessage(
    body,
    quickReply([
      {
        type: "postback",
        label: dict.deleteConfirmLabel,
        data: encodeLinePostback({ action: "delete_confirm", entryKey: args.entryKey }),
        displayText: dict.deleteConfirmLabel,
      },
      {
        type: "postback",
        label: dict.deleteCancelLabel,
        data: encodeLinePostback({ action: "delete_cancel" }),
        displayText: dict.deleteCancelLabel,
      },
    ]),
  );
}

/** How an ask or a confirm ended, other than "here is the question". */
export type DeleteOutcome =
  | { kind: "deleted"; title: string; amountMinor: number; currency: string }
  | { kind: "cancelled" | "already_gone" | "not_found" | "expired" };

/** The answer to 確定刪除 / 取消 / a dead button, with the standard quick reply under it. */
export function deleteResultReply(dict: LineDictionary, links: LineLinks | null, outcome: DeleteOutcome): LineTextMessage {
  const text =
    outcome.kind === "deleted"
      ? fill(dict.deleted, { title: outcome.title, amount: entryAmountText(outcome) })
      : outcome.kind === "cancelled"
        ? dict.deleteCancelled
        : outcome.kind === "already_gone"
          ? dict.deleteAlreadyGone
          : outcome.kind === "not_found"
            ? dict.deleteNotFound
            : dict.postbackExpired;

  return textMessage(text, standardQuickReply(dict, links));
}

/** The plain-text help: also the help card's altText and its fallback. */
function helpText(dict: LineDictionary, undoWindowMinutes: number): string {
  return fill(dict.help, { minutes: undoWindowMinutes });
}

/**
 * 「說明」: the help card, or the same list as plain text if LINE refuses it.
 * `quickReply` goes under the card and under the text alike; leave it out when
 * another message follows (the link card, for somebody not linked yet) - a
 * quick reply belongs on the last message of a reply.
 */
export function helpReply(dict: LineDictionary, undoWindowMinutes: number, quickReply?: LineQuickReply): LineOutgoing {
  const plain = helpText(dict, undoWindowMinutes);
  return cardOrFallback(
    "help",
    () => helpCard(dict, { minutes: undoWindowMinutes, altText: plain, quickReply }),
    [textMessage(plain, quickReply)],
  );
}

/**
 * The welcome / link card with its button to the link page. If LINE refuses
 * the card (or it cannot be built), what goes out instead is exactly what the
 * bot sent before cards: the `lead` as a text message when there is one, then
 * the buttons template - the link button must survive any fallback, which is
 * why this is not a bare text(altText).
 *
 * `heading` defaults to the "link your account" title; `lead` is a sentence of
 * context (the greeting, "that link expired"). The banner is skipped for an
 * origin that is not https, which LINE cannot fetch an image from.
 */
export function linkReply(
  dict: LineDictionary,
  args: { url: string; appOrigin: string; heading?: string; lead?: string },
): LineOutgoing {
  const altText = args.lead ?? dict.linkAltText;
  const button = linkButtonsMessage(dict, args.url);
  const fallback: LineMessage[] = args.lead ? [textMessage(args.lead), button] : [button];

  return cardOrFallback(
    "link",
    () =>
      linkCard(dict, {
        heading: args.heading ?? dict.linkCardTitle,
        lead: args.lead,
        url: args.url,
        heroUrl: linkHeroUrl(args.appOrigin),
        altText,
      }),
    fallback,
  );
}

/**
 * The confirmation after linking: a card with the masked address, or today's
 * one-line text. The webhook event that links does not say which ledger the
 * account has, so the quick reply under it has no links - just 本月 and 說明.
 */
export function linkedReply(dict: LineDictionary, args: { maskedEmail: string }): LineOutgoing {
  const altText = fill(dict.linked, { email: args.maskedEmail });
  const qr = standardQuickReply(dict, null);
  return cardOrFallback(
    "linked",
    () => linkedCard(dict, { maskedEmail: args.maskedEmail, altText, quickReply: qr }),
    [textMessage(altText, qr)],
  );
}

/** Re-exported for callers that need the raw shape without the totals. */
export type { RecordLineEntryResult };
