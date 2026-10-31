import { fill } from "../push/pushText.js";
import { CARD, tint } from "./lineCardTheme.js";
import {
  type FlexBox,
  type FlexComponent,
  type LineFlexMessage,
  bubble,
  flexMessage,
  hbox,
  separator,
  text,
  vbox,
} from "./lineFlex.js";
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
 * The body every card without a hero shares: the brand strip flush to the top,
 * then the content inset by 20px. The outer box has no padding of its own so
 * the strip can run edge to edge.
 */
export function cardBody(contents: FlexComponent[]): FlexBox {
  return vbox([brandStrip(), vbox(contents, { paddingAll: "20px" })], { paddingAll: "0px" });
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
