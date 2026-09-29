import { formatAmount } from "../../app/formatAmount.js";
import type { LineMessage } from "./lineClient.js";
import { fill } from "../push/pushText.js";
import type { LineDictionary } from "./lineText.js";
import type { LineMonthTotals, RecordLineEntryResult } from "./lineRepository.js";

/**
 * Builders for the messages this bot sends. Kept apart from lineWebhook.ts so
 * the "what does the reply look like" concern is separate from "what
 * triggers a reply" - see the LINE reference for the message object shapes:
 * https://developers.line.biz/en/reference/messaging-api/#message-objects
 */

export function textMessage(text: string, quickReply?: LineMessage["quickReply"]): LineMessage {
  return quickReply ? { type: "text", text, quickReply } : { type: "text", text };
}

type QuickReplyAction =
  | { type: "message"; label: string; text: string }
  | { type: "uri"; label: string; uri: string };

function quickReply(actions: readonly QuickReplyAction[]) {
  return { items: actions.map((action) => ({ type: "action", action })) };
}

export function linkPageUrl(appOrigin: string, linkToken: string): string {
  return `${appOrigin}/line/link?linkToken=${encodeURIComponent(linkToken)}&openExternalBrowser=1`;
}

/** A buttons template carrying one uri action to the /line/link page. */
export function linkButtonsMessage(dict: LineDictionary, url: string, text?: string): LineMessage {
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

function recordQuickReply(dict: LineDictionary, appOrigin: string, ledgerId: string) {
  return quickReply([
    { type: "message", label: dict.undoLabel, text: dict.undoText },
    { type: "message", label: dict.monthButtonLabel, text: dict.monthText },
    { type: "uri", label: dict.openLedgerLabel, uri: `${appOrigin}/group/${ledgerId}?openExternalBrowser=1` },
  ]);
}

/** The suffix appended to "本月支出 {spent}" when the ledger has a budget set. Empty string when it doesn't. */
function budgetSuffix(dict: LineDictionary, currency: string, budgetMinor: number, spentMinor: number): string {
  if (!budgetMinor || budgetMinor <= 0) return "";
  const left = budgetMinor - spentMinor;
  if (left >= 0) return fill(dict.budgetLeftSuffix, { left: formatAmount(left, currency) });
  return fill(dict.budgetOverSuffix, { over: formatAmount(Math.abs(left), currency) });
}

function budgetLine(dict: LineDictionary, currency: string, budgetMinor: number, spentMinor: number): string {
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
    budgetMinor: number;
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
  args: { year: number; month: number; currency: string; budgetMinor: number; month_totals: LineMonthTotals; ledgerId: string; appOrigin: string },
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
    quickReply([{ type: "uri", label: dict.openLedgerLabel, uri: `${args.appOrigin}/group/${args.ledgerId}?openExternalBrowser=1` }]),
  );
}

export function helpReply(dict: LineDictionary, undoWindowMinutes: number): LineMessage {
  return textMessage(fill(dict.help, { minutes: undoWindowMinutes }));
}

/** Re-exported for callers that need the raw shape without the totals. */
export type { RecordLineEntryResult };
