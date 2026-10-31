import { formatAmount, formatSigned } from "../../app/formatAmount.js";
import { fill } from "../push/pushText.js";
import {
  CARD,
  LINK_HERO_ASPECT,
  type LineCategoryDisplay,
  amountTextSize,
  barPercent,
  budgetTone,
  tint,
  toneColor,
  usedPercent,
} from "./lineCardTheme.js";
import {
  type FlexBox,
  type FlexComponent,
  type LineFlexMessage,
  type LineQuickReply,
  bubble,
  flexMessage,
  hbox,
  heroImage,
  progressBar,
  separator,
  text,
  uriButton,
  vbox,
} from "./lineFlex.js";
import type { LineMonthTotals } from "./lineRepository.js";
import type { LineDictionary } from "./lineText.js";

/**
 * One pure builder per reply card. Each takes display-ready input - the
 * dictionary, plus figures and labels the caller already resolved - and the
 * `altText` that stands in for the card in notifications and the chat list.
 * None of them reads the database, the clock or the environment, and none of
 * them decides what to say when it fails: lineMessages.ts wraps every call in
 * cardOrFallback, which falls back to the plain text the card replaced.
 *
 * The look (palette, tones, thresholds) is lineCardTheme.ts; the shapes LINE
 * accepts are lineFlex.ts. The numbers here - sizes, margins, paddings - are
 * the card layouts of the plan, and lineCards.test.ts pins what they put on
 * screen.
 */

/**
 * The thin mint-blue-violet rule along the top of a card without a hero image:
 * the one piece of brand colour on the card, as the aurora is on the cover.
 * Three equal segments, each an empty box with a `flex` so it keeps its width.
 */
export function brandStrip(): FlexBox {
  return hbox(
    [
      vbox([], { flex: 1, backgroundColor: CARD.mint }),
      vbox([], { flex: 1, backgroundColor: CARD.blue }),
      vbox([], { flex: 1, backgroundColor: CARD.violet }),
    ],
    { height: "4px" },
  );
}

/**
 * The body every card shares: the brand strip flush to the top, then the
 * content inset by 20px. The outer box has no padding of its own so the strip
 * can run edge to edge. A card with a hero image has no strip (the picture is
 * the brand), so it passes `strip: false` and gets the inset content alone.
 */
export function cardBody(contents: FlexComponent[], options: { strip?: boolean } = {}): FlexBox {
  const inset = vbox(contents, { paddingAll: "20px" });
  return vbox(options.strip === false ? [inset] : [brandStrip(), inset], { paddingAll: "0px" });
}

type HelpRow = {
  /** One code point, Emoji_Presentation=Yes, Unicode 9 or older - see LINE_CATEGORY_EMOJI for why. */
  emoji: string;
  accent: string;
  title: (dict: LineDictionary, minutes: number) => string;
  commands: (dict: LineDictionary) => string;
};

/** The six commands the help card teaches, in the order it lists them. */
const HELP_ROWS: readonly HelpRow[] = [
  { emoji: "\u{1F4B8}", accent: CARD.blue, title: (dict) => dict.helpExpenseTitle, commands: (dict) => dict.helpExpenseCmd },
  { emoji: "\u{1F4B0}", accent: CARD.mint, title: (dict) => dict.helpIncomeTitle, commands: (dict) => dict.helpIncomeCmd },
  { emoji: "\u{1F4CA}", accent: CARD.violet, title: (dict) => dict.helpMonthTitle, commands: (dict) => dict.helpMonthCmd },
  { emoji: "\u{1F3AF}", accent: CARD.amber, title: (dict) => dict.helpBudgetTitle, commands: (dict) => dict.helpBudgetCmd },
  {
    emoji: "\u{23EA}",
    accent: CARD.coral,
    title: (dict, minutes) => fill(dict.helpUndoTitle, { minutes }),
    commands: (dict) => dict.helpUndoCmd,
  },
  { emoji: "\u{1F517}", accent: CARD.muted, title: (dict) => dict.helpUnlinkTitle, commands: (dict) => dict.helpUnlinkCmd },
];

/**
 * A tinted emoji tile, then a title with the commands under it. The command
 * box is full-width on purpose: a shrink-to-fit pill overflows inside a
 * horizontal box. It is plain text, never a button - tapping an example must
 * not send (and so record) anything.
 */
function helpRow(dict: LineDictionary, minutes: number, row: HelpRow): FlexBox {
  return hbox(
    [
      vbox([text(row.emoji, { size: "md", color: CARD.text, align: "center" })], {
        width: "36px",
        height: "36px",
        cornerRadius: "10px",
        backgroundColor: tint(row.accent),
        flex: 0,
        justifyContent: "center",
        alignItems: "center",
      }),
      vbox(
        [
          text(row.title(dict, minutes), { size: "sm", weight: "bold", color: CARD.text, wrap: true }),
          vbox([text(row.commands(dict), { size: "xs", color: CARD.mint, wrap: true })], {
            margin: "xs",
            backgroundColor: CARD.raised,
            cornerRadius: "6px",
            paddingStart: "8px",
            paddingEnd: "8px",
            paddingTop: "4px",
            paddingBottom: "4px",
          }),
        ],
        { flex: 1 },
      ),
    ],
    { margin: "lg", spacing: "md", alignItems: "center" },
  );
}

/**
 * 「說明」: every command on one card, one row each. A single bubble, not a
 * carousel - a carousel hides rows behind horizontal scrolling - and no
 * buttons or quick replies: there is nothing here to tap.
 */
export function helpCard(dict: LineDictionary, args: { minutes: number; altText: string }): LineFlexMessage {
  const content: FlexComponent[] = [
    text(dict.helpCardTitle, { size: "lg", weight: "bold", color: CARD.text, wrap: true }),
    text(dict.helpCardLead, { size: "xs", color: CARD.muted, margin: "xs", wrap: true }),
    separator(CARD.hairline, "lg"),
    ...HELP_ROWS.map((row) => helpRow(dict, args.minutes, row)),
    text(dict.helpCardNote, { size: "xs", color: CARD.muted, margin: "xl", wrap: true }),
  ];

  return flexMessage(args.altText, bubble({ body: cardBody(content), background: CARD.bg }));
}

/** "本月（2026 年 9 月）" - the month heading shared by the plain text and the month card. */
export function monthLabelText(dict: LineDictionary, year: number, month: number): string {
  return fill(dict.monthLabel, { year, month, month2: String(month).padStart(2, "0") });
}

/** "還剩 $9,000" / "已超出 $5,000" - what is left of the budget, shared by every budget line in text and cards. */
export function budgetRemainingText(dict: LineDictionary, currency: string, budgetMinor: number, spentMinor: number): string {
  const left = budgetMinor - spentMinor;
  if (left >= 0) return fill(dict.budgetRemainingLeft, { left: formatAmount(left, currency) });
  return fill(dict.budgetRemainingOver, { over: formatAmount(Math.abs(left), currency) });
}

/** A ledger has a budget only when it is a positive number; 0, null and a missing one all mean "none". */
function hasBudget(budgetMinor: number | null): budgetMinor is number {
  return typeof budgetMinor === "number" && budgetMinor > 0;
}

/** "label ........ value": the label takes the slack, the value keeps its own width and sits at the end. */
function labelValueRow(label: string, value: string, valueColor: string): FlexBox {
  return hbox(
    [
      text(label, { size: "xs", color: CARD.muted, flex: 1 }),
      text(value, { size: "sm", weight: "bold", color: valueColor, flex: 0, align: "end" }),
    ],
    { margin: "lg", alignItems: "center" },
  );
}

/**
 * The line under a budget bar: something on the left ("預算 $15,000", "已用 40%")
 * and how much is left, or over, on the right in the colour of the bar.
 */
function budgetCaption(
  dict: LineDictionary,
  args: { left: string; currency: string; budgetMinor: number; spentMinor: number },
): FlexBox {
  const tone = toneColor(budgetTone(args.spentMinor, args.budgetMinor));
  return hbox(
    [
      text(args.left, { size: "xs", color: CARD.muted, flex: 1 }),
      text(budgetRemainingText(dict, args.currency, args.budgetMinor, args.spentMinor), {
        size: "xs",
        weight: "bold",
        color: tone,
        flex: 0,
        align: "end",
      }),
    ],
    { margin: "sm" },
  );
}

/** The bar and caption a record or month card shows when the ledger has a budget. */
function budgetProgress(
  dict: LineDictionary,
  args: { currency: string; budgetMinor: number; spentMinor: number; barHeight: number },
): FlexComponent[] {
  const fillColor = toneColor(budgetTone(args.spentMinor, args.budgetMinor));
  return [
    progressBar(barPercent(args.spentMinor, args.budgetMinor), {
      fill: fillColor,
      track: CARD.hairline,
      height: args.barHeight,
      margin: "md",
    }),
    budgetCaption(dict, {
      left: fill(dict.cardBudgetOf, { budget: formatAmount(args.budgetMinor, args.currency) }),
      currency: args.currency,
      budgetMinor: args.budgetMinor,
      spentMinor: args.spentMinor,
    }),
  ];
}

/** A rounded square holding one emoji, tinted from `color`. */
function emojiTile(emoji: string, color: string, size: number): FlexBox {
  return vbox([text(emoji, { size: "xl", color: CARD.text, align: "center" })], {
    width: `${size}px`,
    height: `${size}px`,
    cornerRadius: "12px",
    backgroundColor: tint(color),
    flex: 0,
    justifyContent: "center",
    alignItems: "center",
  });
}

/**
 * The reply to a recorded expense or income: what was written down, then where
 * this month stands - and, for an expense in a ledger with a budget, how much
 * of the budget that is. The date is the one the entry was recorded under
 * (Taiwan time), already formatted; the 復原 button is a quick reply under the
 * card, never a button in it.
 */
export function recordCard(
  dict: LineDictionary,
  args: {
    kind: "expense" | "income";
    title: string;
    amountMinor: number;
    currency: string;
    category: LineCategoryDisplay;
    budgetMinor: number | null;
    month: LineMonthTotals;
    dateText: string;
    altText: string;
    quickReply: LineQuickReply;
  },
): LineFlexMessage {
  const income = args.kind === "income";
  const amountText = income ? formatSigned(args.amountMinor, args.currency) : formatAmount(args.amountMinor, args.currency);
  const monthLabel = income ? dict.cardMonthIncome : dict.cardMonthSpent;
  const monthValue = formatAmount(income ? args.month.income_minor : args.month.expense_minor, args.currency);

  const content: FlexComponent[] = [
    hbox([
      text(income ? dict.cardIncomeTitle : dict.cardExpenseTitle, {
        size: "xs",
        weight: "bold",
        color: income ? CARD.mint : CARD.muted,
        flex: 1,
      }),
      text(args.dateText, { size: "xs", color: CARD.muted, flex: 0, align: "end" }),
    ]),
    hbox(
      [
        emojiTile(args.category.emoji, args.category.color, 44),
        vbox(
          [
            text(args.title, { size: "md", weight: "bold", color: CARD.text, wrap: true, maxLines: 2 }),
            text(args.category.label, { size: "xs", color: CARD.muted, margin: "xs" }),
          ],
          { flex: 1 },
        ),
      ],
      { margin: "lg", spacing: "md", alignItems: "center" },
    ),
    text(amountText, {
      size: amountTextSize(amountText),
      weight: "bold",
      color: income ? CARD.mint : CARD.text,
      margin: "lg",
      wrap: true,
    }),
    separator(CARD.hairline, "lg"),
    labelValueRow(monthLabel, monthValue, income ? CARD.mint : CARD.text),
  ];

  if (!income && hasBudget(args.budgetMinor)) {
    content.push(
      ...budgetProgress(dict, {
        currency: args.currency,
        budgetMinor: args.budgetMinor,
        spentMinor: args.month.expense_minor,
        barHeight: 6,
      }),
    );
  }

  return flexMessage(args.altText, bubble({ body: cardBody(content), background: CARD.bg }), args.quickReply);
}

/** One category's expense total for the month, with the label, colour and emoji already resolved. */
export type MonthCategory = { category: LineCategoryDisplay; amountMinor: number };

/** The most category rows the month card shows; the rest are folded into one 「其餘分類」 row. */
const MONTH_CATEGORY_ROWS = 5;

/** A small raised tile: a muted label over a bold value. Two sit side by side on the month card. */
function statTile(label: string, value: string, color: string): FlexBox {
  return vbox(
    [
      text(label, { size: "xs", color: CARD.muted }),
      text(value, { size: "sm", weight: "bold", color, margin: "xs", wrap: true }),
    ],
    { flex: 1, backgroundColor: CARD.raised, cornerRadius: "10px", paddingAll: "12px" },
  );
}

/** A category line with its share of the month's spending as a thin bar. */
function breakdownRow(args: {
  emoji: string;
  label: string;
  amount: string;
  labelColor: string;
  amountColor: string;
  percent: number;
  barColor: string;
}): FlexBox {
  return vbox(
    [
      hbox(
        [
          text(args.emoji, { size: "sm", color: CARD.text, flex: 0 }),
          text(args.label, { size: "sm", color: args.labelColor, flex: 1 }),
          text(args.amount, { size: "sm", weight: "bold", color: args.amountColor, flex: 0, align: "end" }),
        ],
        { spacing: "sm", alignItems: "center" },
      ),
      progressBar(args.percent, { fill: args.barColor, track: CARD.hairline, height: 4, margin: "sm" }),
    ],
    { margin: "md" },
  );
}

function byAmountThenKey(a: MonthCategory, b: MonthCategory): number {
  if (a.amountMinor !== b.amountMinor) return b.amountMinor - a.amountMinor;
  if (a.category.key === b.category.key) return 0;
  return a.category.key < b.category.key ? -1 : 1;
}

/**
 * The by-category part of the month card, or nothing at all.
 *
 * `categories === undefined` means the database did not say (it predates the
 * breakdown), which is not the same as "no spending" and must not read as it:
 * the section is left out. An empty list for a month with no spending says so;
 * an empty list for a month that does have spending is data in transit, and
 * says nothing rather than something false.
 *
 * Rows are the positive finite amounts, largest first (ties by key, so the
 * order never shuffles), at most five. Whatever the month spent beyond them is
 * one more row, 「其餘分類」, so the rows always add up to the headline figure.
 */
function categorySection(
  dict: LineDictionary,
  args: { currency: string; expenseMinor: number; categories: readonly MonthCategory[] | undefined },
): FlexComponent[] {
  if (args.categories === undefined) return [];

  const rows = args.categories
    .filter((row) => Number.isFinite(row.amountMinor) && row.amountMinor > 0)
    .sort(byAmountThenKey)
    .slice(0, MONTH_CATEGORY_ROWS);

  if (rows.length === 0) {
    if (args.expenseMinor !== 0) return [];
    return [separator(CARD.hairline, "lg"), text(dict.cardNoSpending, { size: "sm", color: CARD.muted, margin: "lg", wrap: true })];
  }

  const others = Math.max(0, args.expenseMinor - rows.reduce((sum, row) => sum + row.amountMinor, 0));
  const section: FlexComponent[] = [
    separator(CARD.hairline, "lg"),
    text(dict.cardByCategory, { size: "xs", weight: "bold", color: CARD.muted, margin: "lg" }),
    ...rows.map((row) =>
      breakdownRow({
        emoji: row.category.emoji,
        label: row.category.label,
        amount: formatAmount(row.amountMinor, args.currency),
        labelColor: CARD.text,
        amountColor: CARD.text,
        percent: barPercent(row.amountMinor, args.expenseMinor),
        barColor: row.category.color,
      }),
    ),
  ];

  if (others > 0) {
    section.push(
      breakdownRow({
        emoji: "\u{2795}",
        label: dict.cardOtherCategories,
        amount: formatAmount(others, args.currency),
        labelColor: CARD.muted,
        amountColor: CARD.muted,
        percent: barPercent(others, args.expenseMinor),
        barColor: CARD.muted,
      }),
    );
  }

  return section;
}

/**
 * 「本月」: the month's spending as the headline, its budget if there is one,
 * income and net beside each other, and where the money went. The footer's
 * button opens the ledger (the same link the quick reply carries).
 */
export function monthCard(
  dict: LineDictionary,
  args: {
    year: number;
    month: number;
    currency: string;
    budgetMinor: number | null;
    totals: LineMonthTotals;
    categories: readonly MonthCategory[] | undefined;
    ledgerUri: string;
    altText: string;
    quickReply: LineQuickReply;
  },
): LineFlexMessage {
  const { expense_minor: expense, income_minor: income } = args.totals;
  const net = income - expense;
  const spentText = formatAmount(expense, args.currency);

  const content: FlexComponent[] = [
    text(monthLabelText(dict, args.year, args.month), { size: "xs", weight: "bold", color: CARD.muted }),
    text(dict.cardSpentLabel, { size: "xs", color: CARD.muted, margin: "lg" }),
    text(spentText, { size: amountTextSize(spentText), weight: "bold", color: CARD.text, margin: "xs", wrap: true }),
  ];

  if (hasBudget(args.budgetMinor)) {
    content.push(
      ...budgetProgress(dict, { currency: args.currency, budgetMinor: args.budgetMinor, spentMinor: expense, barHeight: 8 }),
    );
  }

  content.push(
    hbox(
      [
        statTile(dict.cardIncomeLabel, formatAmount(income, args.currency), income > 0 ? CARD.mint : CARD.text),
        statTile(dict.cardNetLabel, formatSigned(net, args.currency), net > 0 ? CARD.mint : net < 0 ? CARD.coral : CARD.text),
      ],
      { margin: "lg", spacing: "md" },
    ),
    ...categorySection(dict, { currency: args.currency, expenseMinor: expense, categories: args.categories }),
  );

  const footer = vbox(
    [uriButton(dict.openLedgerLabel, args.ledgerUri, { color: CARD.buttonBg, style: "primary", height: "sm" })],
    { paddingAll: "12px" },
  );

  return flexMessage(
    args.altText,
    bubble({ body: cardBody(content), footer, background: CARD.bg, footerSeparator: CARD.hairline }),
    args.quickReply,
  );
}

/**
 * 「預算」 and 「預算 N」: the budget as the headline, how much of it this month
 * has used, and how to change or remove it. Only for a ledger that has one -
 * with none, the reply stays the plain "how to set one" text.
 */
export function budgetCard(
  dict: LineDictionary,
  args: {
    mode: "set" | "show";
    currency: string;
    budgetMinor: number;
    spentMinor: number;
    altText: string;
    quickReply: LineQuickReply;
  },
): LineFlexMessage {
  const budgetText = formatAmount(args.budgetMinor, args.currency);
  const tone = toneColor(budgetTone(args.spentMinor, args.budgetMinor));

  const content: FlexComponent[] = [
    text(args.mode === "set" ? dict.cardBudgetSetTitle : dict.cardBudgetShowTitle, {
      size: "xs",
      weight: "bold",
      color: args.mode === "set" ? CARD.mint : CARD.muted,
    }),
    text(budgetText, { size: amountTextSize(budgetText), weight: "bold", color: CARD.text, margin: "sm", wrap: true }),
    progressBar(barPercent(args.spentMinor, args.budgetMinor), { fill: tone, track: CARD.hairline, height: 10, margin: "lg" }),
    budgetCaption(dict, {
      left: fill(dict.cardBudgetUsed, { percent: usedPercent(args.spentMinor, args.budgetMinor) }),
      currency: args.currency,
      budgetMinor: args.budgetMinor,
      spentMinor: args.spentMinor,
    }),
    labelValueRow(dict.cardMonthSpent, formatAmount(args.spentMinor, args.currency), CARD.text),
    separator(CARD.hairline, "lg"),
    text(dict.cardBudgetHint, { size: "xs", color: CARD.muted, margin: "lg", wrap: true }),
  ];

  return flexMessage(args.altText, bubble({ body: cardBody(content), background: CARD.bg }), args.quickReply);
}

/**
 * The welcome and link card: the one way in for somebody who has not linked an
 * Equo account, so the button is the point. `heading` is the title ("welcome"
 * on a follow, "link your account" otherwise), `lead` an optional sentence of
 * context above the standing prompt (the greeting, or "that link expired").
 *
 * `heroUrl` is the banner picture or null - null for a non-https origin, which
 * LINE cannot fetch from - and a card with a banner has no brand strip.
 * `url` is the link page exactly as lineMessages.linkPageUrl made it, with
 * openExternalBrowser=1 so the button leaves LINE's in-app browser. The button
 * fill is not mint: LINE draws its label white, which mint cannot carry.
 */
export function linkCard(
  dict: LineDictionary,
  args: { heading: string; lead: string | undefined; url: string; heroUrl: string | null; altText: string },
): LineFlexMessage {
  const content: FlexComponent[] = [text(args.heading, { size: "lg", weight: "bold", color: CARD.text, wrap: true })];
  if (args.lead) content.push(text(args.lead, { size: "sm", color: CARD.text, margin: "md", wrap: true }));
  content.push(text(dict.linkPrompt, { size: "xs", color: CARD.muted, margin: "md", wrap: true }));

  const footer = vbox([uriButton(dict.linkButton, args.url, { color: CARD.buttonBg, style: "primary", height: "md" })], {
    paddingAll: "16px",
    paddingTop: "0px",
  });

  return flexMessage(
    args.altText,
    bubble({
      hero: args.heroUrl ? heroImage(args.heroUrl, LINK_HERO_ASPECT, CARD.bg) : undefined,
      body: cardBody(content, { strip: args.heroUrl === null }),
      footer,
      background: CARD.bg,
    }),
  );
}

/**
 * The confirmation after linking. `maskedEmail` is already masked
 * (lineMessages.maskEmail): this card is shown in a chat that may be read over
 * a shoulder, and the full address never needs to appear in it.
 */
export function linkedCard(dict: LineDictionary, args: { maskedEmail: string; altText: string }): LineFlexMessage {
  const content: FlexComponent[] = [
    hbox(
      [
        emojiTile("\u{2705}", CARD.mint, 44),
        vbox(
          [
            text(dict.linkedCardTitle, { size: "md", weight: "bold", color: CARD.text, wrap: true }),
            text(args.maskedEmail, { size: "xs", color: CARD.muted, margin: "xs", wrap: true }),
          ],
          { flex: 1 },
        ),
      ],
      { spacing: "md", alignItems: "center" },
    ),
    separator(CARD.hairline, "lg"),
    text(dict.linkedCardHint, { size: "sm", color: CARD.text, margin: "lg", wrap: true }),
  ];

  return flexMessage(args.altText, bubble({ body: cardBody(content), background: CARD.bg }));
}
