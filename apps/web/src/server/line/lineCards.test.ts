import { describe, expect, test } from "vitest";
import { DEFAULT_CATALOG } from "../../app/catalog.js";
import { fill } from "../push/pushText.js";
import { CARD, type LineCategoryDisplay, categoryDisplay, tint } from "./lineCardTheme.js";
import {
  type MonthCategory,
  brandStrip,
  budgetCard,
  budgetRemainingText,
  helpCard,
  linkCard,
  linkedCard,
  monthCard,
  monthLabelText,
  recordCard,
} from "./lineCards.js";
import type { FlexBox, LineFlexMessage, LineQuickReply } from "./lineFlex.js";
import { actionsOf, assertValidFlexMessage, lineMessageProblems } from "./lineFlexValidator.js";
import { type LineDictionary, LINE_TEXT_EN as EN, LINE_TEXT_ZH_HANT as ZH_HANT } from "./lineText.js";

type Node = Record<string, unknown>;

const LOCALES = [
  ["zh-Hant", ZH_HANT],
  ["en", EN],
] as const satisfies ReadonlyArray<readonly [string, LineDictionary]>;

/** Depth-first, in document order: the order the nodes are drawn in. */
function walk(node: unknown, visit: (node: Node) => void): void {
  if (Array.isArray(node)) {
    for (const item of node) walk(item, visit);
  } else if (typeof node === "object" && node !== null) {
    visit(node as Node);
    for (const value of Object.values(node)) walk(value, visit);
  }
}

/** Every text node's string, in the order it is drawn. */
function textsOf(message: LineFlexMessage): string[] {
  const found: string[] = [];
  walk(message.contents, (node) => {
    if (node.type === "text") found.push(node.text as string);
  });
  return found;
}

function nodesWhere(message: LineFlexMessage, predicate: (node: Node) => boolean): Node[] {
  const found: Node[] = [];
  walk(message.contents, (node) => {
    if (predicate(node)) found.push(node);
  });
  return found;
}

/** The inset content box: the second child of the body, after the brand strip. */
function contentOf(message: LineFlexMessage): Node[] {
  return (message.contents.body.contents[1] as FlexBox).contents as unknown as Node[];
}

describe("brandStrip", () => {
  test("is a 4px row of three equal empty segments: mint, blue, violet", () => {
    const strip = brandStrip();
    expect(strip.layout).toBe("horizontal");
    expect(strip.height).toBe("4px");
    expect(strip.contents).toHaveLength(3);
    for (const segment of strip.contents) {
      expect(segment).toMatchObject({ type: "box", flex: 1, height: "4px", contents: [] });
    }
    expect(strip.contents.map((segment) => (segment as FlexBox).backgroundColor)).toEqual([CARD.mint, CARD.blue, CARD.violet]);
  });
});

describe("helpCard", () => {
  const build = (dict: LineDictionary, minutes: number) =>
    helpCard(dict, { minutes, altText: fill(dict.help, { minutes }) });

  describe.each(LOCALES)("%s", (_locale, dict) => {
    // Window sizes around where the plain text's 400-unit altText limit bites (see lineText.test.ts).
    test.each([1, 30, 1440])("is a valid card for an undo window of %s minutes", (minutes) => {
      assertValidFlexMessage(build(dict, minutes));
    });

    test("carries the altText it was given, whole", () => {
      expect(build(dict, 30).altText).toBe(fill(dict.help, { minutes: 30 }));
    });

    test("draws the title, lead, six rows in order, then the note", () => {
      const minutes = 45;
      expect(textsOf(build(dict, minutes))).toEqual([
        dict.helpCardTitle,
        dict.helpCardLead,
        "\u{1F4B8}",
        dict.helpExpenseTitle,
        dict.helpExpenseCmd,
        "\u{1F4B0}",
        dict.helpIncomeTitle,
        dict.helpIncomeCmd,
        "\u{1F4CA}",
        dict.helpMonthTitle,
        dict.helpMonthCmd,
        "\u{1F3AF}",
        dict.helpBudgetTitle,
        dict.helpBudgetCmd,
        "\u{23EA}",
        fill(dict.helpUndoTitle, { minutes }),
        dict.helpUndoCmd,
        "\u{1F517}",
        dict.helpUnlinkTitle,
        dict.helpUnlinkCmd,
        dict.helpCardNote,
      ]);
    });

    test("says the real undo window in the undo row", () => {
      expect(textsOf(build(dict, 45)).join("\n")).toContain("45");
      expect(textsOf(build(dict, 45)).join("\n")).not.toContain("{minutes}");
    });
  });

  test("a body with the brand strip first, then the inset content, on the card background", () => {
    const message = build(ZH_HANT, 30);
    const { body } = message.contents;

    expect(body.paddingAll).toBe("0px");
    expect(body.contents[0]).toEqual(brandStrip());
    expect(body.contents[1]).toMatchObject({ type: "box", layout: "vertical", paddingAll: "20px" });
    expect(message.contents.styles.body.backgroundColor).toBe(CARD.bg);
    expect(message.contents.hero).toBeUndefined();
    expect(message.contents.footer).toBeUndefined();
  });

  test("is one bubble with no size, so every client draws the default width", () => {
    expect(build(ZH_HANT, 30).contents.type).toBe("bubble");
    expect(build(ZH_HANT, 30).contents).not.toHaveProperty("size");
  });

  test("has six rows, each a tinted tile beside a title and a command box", () => {
    const rows = contentOf(build(ZH_HANT, 30)).filter((node) => node.type === "box");

    expect(rows).toHaveLength(6);
    for (const row of rows as unknown as FlexBox[]) {
      expect(row.layout).toBe("horizontal");
      const [tile, column] = row.contents as FlexBox[];
      expect(tile).toMatchObject({ width: "36px", height: "36px", cornerRadius: "10px", flex: 0 });
      expect(column.flex).toBe(1);
      // The command sits in a full-width raised box: a shrink-to-fit pill overflows a horizontal box.
      const commandBox = column.contents[1] as FlexBox;
      expect(commandBox.backgroundColor).toBe(CARD.raised);
      expect(commandBox.contents[0]).toMatchObject({ type: "text", color: CARD.mint, wrap: true });
    }
  });

  // [MV]: a variation selector or a ZWJ sequence draws as text or as several emoji on some clients.
  test("every row emoji is a single code point with Emoji_Presentation", () => {
    const emoji = textsOf(build(ZH_HANT, 30)).filter((value) => /^\p{Emoji}/u.test(value) && [...value].length === 1);

    expect(emoji).toHaveLength(6);
    for (const value of emoji) {
      expect(value).toMatch(/^\p{Emoji_Presentation}$/u);
      expect(value).not.toContain("️");
    }
  });

  test("the six tiles are tinted from six different accents", () => {
    const tiles = nodesWhere(build(ZH_HANT, 30), (node) => node.width === "36px").map((node) => node.backgroundColor);
    expect(new Set(tiles).size).toBe(6);
  });

  // [MV]: put any action on the card and tapping an example would send (and so record) it.
  test("nothing on the card can be tapped, and there is no quick reply", () => {
    const message = build(ZH_HANT, 30);
    expect(actionsOf(message)).toEqual([]);
    expect(nodesWhere(message, (node) => node.type === "button")).toEqual([]);
    expect(message.quickReply).toBeUndefined();
  });

  test("makes no problem the validator can find, in either locale", () => {
    for (const [, dict] of LOCALES) expect(lineMessageProblems(build(dict, 30))).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Record, month and budget cards
// ---------------------------------------------------------------------------

const QUICK_REPLY: LineQuickReply = {
  items: [{ type: "action", action: { type: "message", label: "復原", text: "復原" } }],
};
const LEDGER_URI = "https://equo-mu.vercel.app/group/ledger_1?openExternalBrowser=1";

/** The emoji the cards draw, as escapes so a test reads the same in any editor. */
const FOOD_EMOJI = "\u{1F371}";
const PLUS_EMOJI = "\u{2795}";

function catalogDisplay(key: string, locale: string): LineCategoryDisplay {
  return categoryDisplay(key, DEFAULT_CATALOG.categories, locale);
}

/** A category as a card would show it for a catalog entry an admin could have typed anything into. */
function customDisplay(key: string, label: string, color: string): LineCategoryDisplay {
  return categoryDisplay(key, [{ key, label, color }], "zh-Hant");
}

function textNodes(message: LineFlexMessage, value: string): Node[] {
  return nodesWhere(message, (node) => node.type === "text" && node.text === value);
}

/** The one text node with this string. */
function textNode(message: LineFlexMessage, value: string): Node {
  const found = textNodes(message, value);
  expect(found, `text ${JSON.stringify(value)}`).toHaveLength(1);
  return found[0];
}

type Bar = { height: unknown; fill: { width: unknown; color: unknown } | undefined };

/** Every progress bar on the card, in order: a track (hairline) with its fill, if any. */
function barsOf(message: LineFlexMessage): Bar[] {
  return nodesWhere(message, (node) => node.type === "box" && node.backgroundColor === CARD.hairline).map((track) => {
    const [fillBox] = track.contents as Node[];
    return {
      height: track.height,
      fill: fillBox ? { width: fillBox.width, color: fillBox.backgroundColor } : undefined,
    };
  });
}

const CURRENCIES = ["TWD", "JPY", "USD", "CHF"] as const;

/** budget, spent: the thresholds either side of 80% and 100%, a budget of one cent, and "no budget" in its three spellings. */
const BUDGET_STATES: ReadonlyArray<readonly [string, number | null, number]> = [
  ["no budget", null, 6000],
  ["a budget of 0", 0, 6000],
  ["a budget of one cent", 1, 6000],
  ["79.99% of budget", 10000, 7999],
  ["80% of budget", 10000, 8000],
  ["100% of budget", 10000, 10000],
  ["100.01% of budget", 10000, 10001],
  ["500% of budget", 10000, 50000],
];

const TITLES = ["早餐", "測".repeat(60), FOOD_EMOJI.repeat(30)];

describe("recordCard", () => {
  type RecordArgs = Parameters<typeof recordCard>[1];
  const recordArgs = (overrides: Partial<RecordArgs> = {}): RecordArgs => ({
    kind: "expense",
    title: "早餐",
    amountMinor: 6000,
    currency: "TWD",
    category: catalogDisplay("food", "zh-Hant"),
    budgetMinor: null,
    month: { expense_minor: 6000, income_minor: 0 },
    dateText: "9月21日",
    altText: "alt",
    quickReply: QUICK_REPLY,
    ...overrides,
  });
  const build = (overrides: Partial<RecordArgs> = {}, dict: LineDictionary = ZH_HANT) =>
    recordCard(dict, recordArgs(overrides));

  // [MV]: skip the validator-visible rules (blank guard, colours, kit defaults) and a combination here goes red.
  test("every budget state x kind x amount x currency x locale is a card LINE accepts", () => {
    for (const [, dict] of LOCALES) {
      for (const kind of ["expense", "income"] as const) {
        for (const [label, budgetMinor, spent] of BUDGET_STATES) {
          for (const amountMinor of [1, 6000, 12345, 1_000_000_000, 100_000_000_000]) {
            for (const currency of CURRENCIES) {
              const message = build(
                { kind, budgetMinor, amountMinor, currency, month: { expense_minor: spent, income_minor: spent * 3 } },
                dict,
              );
              expect(lineMessageProblems(message), `${kind} ${label} ${amountMinor} ${currency}`).toEqual([]);
            }
          }
        }
      }
    }
  });

  // [MV]: delete the blank-text guard in text() and the empty-label case fails validation.
  test("every title x category (unknown, bad colours, empty or long label) x locale is a card LINE accepts", () => {
    const categories = (locale: string): LineCategoryDisplay[] => [
      categoryDisplay("food", DEFAULT_CATALOG.categories, locale),
      categoryDisplay("not_in_the_catalog", [], locale),
      customDisplay("c1", "紅", "red"),
      customDisplay("c2", "空", ""),
      customDisplay("c3", "短", "#ABC"),
      customDisplay("c4", "", "#112233"),
      customDisplay("c5", "長".repeat(40), "#112233"),
    ];
    for (const [locale, dict] of LOCALES) {
      for (const kind of ["expense", "income"] as const) {
        for (const title of TITLES) {
          for (const category of categories(locale)) {
            const message = build({ kind, title, category, budgetMinor: 1_500_000 }, dict);
            expect(lineMessageProblems(message), `${kind} ${title.slice(0, 4)} ${category.key}`).toEqual([]);
          }
        }
      }
    }
  });

  test("carries the altText and quick reply it was given", () => {
    const message = build({ altText: "the plain text" });
    expect(message.altText).toBe("the plain text");
    expect(message.quickReply).toBe(QUICK_REPLY);
  });

  test("an expense with no budget: heading, date, tile, title, label, amount, month row - and no bar", () => {
    const message = build();

    expect(textsOf(message)).toEqual(["已記下支出", "9月21日", FOOD_EMOJI, "早餐", "餐飲", "$60", "本月支出", "$60"]);
    expect(barsOf(message)).toEqual([]);
    expect(textNode(message, "已記下支出")).toMatchObject({ color: CARD.muted, weight: "bold", size: "xs" });
    expect(textNode(message, "9月21日")).toMatchObject({ color: CARD.muted, align: "end", flex: 0 });
  });

  test("an expense with a budget adds a mint bar and how much is left", () => {
    const message = build({ budgetMinor: 1_500_000, amountMinor: 6000, month: { expense_minor: 606_000, income_minor: 0 } });

    expect(textsOf(message)).toEqual([
      "已記下支出",
      "9月21日",
      FOOD_EMOJI,
      "早餐",
      "餐飲",
      "$60",
      "本月支出",
      "$6,060",
      "預算 $15,000",
      "還剩 $8,940",
    ]);
    expect(barsOf(message)).toEqual([{ height: "6px", fill: { width: "40%", color: CARD.mint } }]);
    expect(textNode(message, "還剩 $8,940")).toMatchObject({ color: CARD.mint, weight: "bold", align: "end" });
  });

  // [MV]: `<` -> `<=` at 80%, `<=` -> `<` at 100%, `floor` -> `round`, or no 1% sliver, and a row here goes red.
  test.each([
    [0, undefined, CARD.mint],
    [1, "1%", CARD.mint],
    [7999, "79%", CARD.mint],
    [8000, "80%", CARD.amber],
    [9999, "99%", CARD.amber],
    [10000, "100%", CARD.amber],
    [10001, "100%", CARD.coral],
    [50000, "100%", CARD.coral],
  ])("with a budget of $100, %s minor units spent: bar %s in %s", (spent, width, color) => {
    const message = build({ budgetMinor: 10000, month: { expense_minor: spent, income_minor: 0 } });

    const [bar] = barsOf(message);
    expect(bar.fill).toEqual(width ? { width, color } : undefined);
    // The caption's colour follows the bar.
    const caption = textsOf(message).at(-1)!;
    expect(textNode(message, caption)).toMatchObject({ color });
  });

  test("over budget says by how much, in coral", () => {
    const message = build({ budgetMinor: 1_500_000, month: { expense_minor: 2_000_000, income_minor: 0 } });
    expect(textNode(message, "已超出 $5,000")).toMatchObject({ color: CARD.coral });
    expect(barsOf(message)[0].fill).toEqual({ width: "100%", color: CARD.coral });
  });

  test.each([null, 0])("a budget of %s is no budget: no bar, no caption", (budgetMinor) => {
    const message = build({ budgetMinor });
    expect(barsOf(message)).toEqual([]);
    expect(textsOf(message).some((value) => value.includes("預算"))).toBe(false);
  });

  test("an income card: mint heading, a signed mint amount, this month's income - and never a bar, budget or not", () => {
    const salary = catalogDisplay("salary", "zh-Hant");
    const message = build({
      kind: "income",
      title: "薪水",
      amountMinor: 5_200_000,
      category: salary,
      budgetMinor: 1_500_000,
      month: { expense_minor: 999_999, income_minor: 5_200_000 },
    });

    expect(textsOf(message)).toEqual(["已記下收入", "9月21日", "\u{1F4B0}", "薪水", salary.label, "+$52,000", "本月收入", "$52,000"]);
    expect(textNode(message, "已記下收入")).toMatchObject({ color: CARD.mint });
    expect(textNode(message, "+$52,000")).toMatchObject({ color: CARD.mint, weight: "bold" });
    expect(barsOf(message)).toEqual([]);
    // The month row is income, not the 999,999 of expense beside it.
    expect(textsOf(message).join(" ")).not.toContain("9,999.99");
  });

  test("the category tile is the category colour at 22% over the card, holding its emoji", () => {
    const message = build({ category: catalogDisplay("food", "zh-Hant") });
    const [tile] = nodesWhere(message, (node) => node.width === "44px");

    expect(tile).toMatchObject({ height: "44px", cornerRadius: "12px", flex: 0, backgroundColor: tint("#F0885A") });
    expect(textNode(message, FOOD_EMOJI)).toMatchObject({ size: "xl", align: "center" });
  });

  test("a long title wraps to at most two lines; the category label is one line", () => {
    const message = build({ title: "測".repeat(60) });
    expect(textNode(message, "測".repeat(60))).toMatchObject({ wrap: true, maxLines: 2, size: "md", weight: "bold" });
    expect(textNode(message, "餐飲")).not.toHaveProperty("wrap");
  });

  // [MV]: change amountTextSize's thresholds and the headline overflows or shrinks for nothing.
  test.each([
    [6000, "$60", "3xl"],
    [1_000_000_000, "$10,000,000", "xxl"],
    [100_000_000_000, "$1,000,000,000", "xxl"],
    [1_000_000_000_000, "$10,000,000,000", "xl"],
  ])("the headline for %s minor units shrinks to fit", (amountMinor, shown, size) => {
    // A month figure that differs from the headline, so the headline is the only node with this text.
    const message = build({ amountMinor, month: { expense_minor: 12345, income_minor: 0 } });
    expect(textNode(message, shown)).toMatchObject({ size, wrap: true, weight: "bold" });
  });

  test("a blank date or title shows a dash rather than nothing", () => {
    const message = build({ dateText: "", title: "   " });
    expect(textsOf(message)).toContain("—");
    expect(lineMessageProblems(message)).toEqual([]);
  });

  test("a category the catalog does not know gets the bookmark and the fallback grey", () => {
    const message = build({ category: categoryDisplay("mystery", [], "zh-Hant") });
    expect(textsOf(message)).toContain("mystery");
    expect(textsOf(message)).toContain("\u{1F516}");
    expect(nodesWhere(message, (node) => node.width === "44px")[0].backgroundColor).toBe(tint("#93A0B5"));
  });

  test("English dictionary: English heading, date format and budget words", () => {
    const message = build(
      {
        category: catalogDisplay("food", "en"),
        title: "Breakfast",
        dateText: "9/21",
        budgetMinor: 1_500_000,
        month: { expense_minor: 606_000, income_minor: 0 },
      },
      EN,
    );
    expect(textsOf(message)).toEqual([
      "Expense recorded",
      "9/21",
      FOOD_EMOJI,
      "Breakfast",
      "Food",
      "$60",
      "Spent this month",
      "$6,060",
      "Budget $15,000",
      "$8,940 left",
    ]);
  });

  test("never has a button or an action: 復原 is a quick reply, not something on the card", () => {
    for (const kind of ["expense", "income"] as const) {
      const message = build({ kind, budgetMinor: 1_500_000 });
      expect(actionsOf(message)).toEqual([]);
      expect(JSON.stringify(message.contents)).not.toContain("復原");
    }
  });
});

describe("monthCard", () => {
  type MonthArgs = Parameters<typeof monthCard>[1];
  const monthArgs = (overrides: Partial<MonthArgs> = {}): MonthArgs => ({
    year: 2026,
    month: 9,
    currency: "TWD",
    budgetMinor: null,
    totals: { expense_minor: 606_000, income_minor: 5_200_000 },
    categories: undefined,
    ledgerUri: LEDGER_URI,
    altText: "alt",
    quickReply: QUICK_REPLY,
    ...overrides,
  });
  const build = (overrides: Partial<MonthArgs> = {}, dict: LineDictionary = ZH_HANT) =>
    monthCard(dict, monthArgs(overrides));

  const rowsOf = (entries: Array<[string, number]>): MonthCategory[] =>
    entries.map(([key, amountMinor]) => ({ category: catalogDisplay(key, "zh-Hant"), amountMinor }));

  // The same shape as the SQL test's fixture: 126,500 spent, five categories adding to 119,500.
  const FIVE = (): Array<[string, number]> => [
    ["general", 4500],
    ["transport", 30000],
    ["shopping", 50000],
    ["health", 5000],
    ["food", 30000],
  ];

  test("every budget state x totals x currency x locale, with no breakdown or an empty one, is a card LINE accepts", () => {
    const totals = [
      { expense_minor: 6000, income_minor: 0 },
      { expense_minor: 0, income_minor: 0 },
      { expense_minor: 0, income_minor: 5_200_000 },
      { expense_minor: 6000, income_minor: 6000 },
      { expense_minor: 100_000_000_000, income_minor: 100_000_000_000 },
      { expense_minor: 100_000_000_000, income_minor: 0 },
    ];
    for (const [, dict] of LOCALES) {
      for (const [label, budgetMinor, spent] of BUDGET_STATES) {
        for (const total of [...totals, { expense_minor: spent, income_minor: 1 }]) {
          for (const currency of CURRENCIES) {
            for (const categories of [undefined, []]) {
              const message = build({ budgetMinor, totals: total, currency, categories }, dict);
              expect(lineMessageProblems(message), `${label} ${JSON.stringify(total)} ${currency}`).toEqual([]);
            }
          }
        }
      }
    }
  });

  // [MV]: skip colour normalization (categoryDisplay) and "red" reaches LINE as a fill colour.
  test("every breakdown shape (none, 1, 5, 7, unknown key, bad colours, empty label) x locale is a card LINE accepts", () => {
    const shapes = (locale: string): Array<MonthCategory[] | undefined> => [
      undefined,
      [],
      [{ category: categoryDisplay("food", DEFAULT_CATALOG.categories, locale), amountMinor: 6000 }],
      FIVE().map(([key, amountMinor]) => ({ category: categoryDisplay(key, DEFAULT_CATALOG.categories, locale), amountMinor })),
      [
        ...FIVE(),
        ["bills", 3000],
        ["education", 2000],
      ].map(([key, amountMinor]) => ({
        category: categoryDisplay(key as string, DEFAULT_CATALOG.categories, locale),
        amountMinor: amountMinor as number,
      })),
      [{ category: categoryDisplay("not_in_the_catalog", [], locale), amountMinor: 6000 }],
      [
        { category: customDisplay("c1", "紅", "red"), amountMinor: 3000 },
        { category: customDisplay("c2", "空", ""), amountMinor: 2000 },
        { category: customDisplay("c3", "短", "#ABC"), amountMinor: 1000 },
      ],
      [{ category: customDisplay("c4", "", "#112233"), amountMinor: 6000 }],
      [{ category: customDisplay("c5", "長".repeat(40), "#112233"), amountMinor: 6000 }],
    ];
    for (const [locale, dict] of LOCALES) {
      for (const categories of shapes(locale)) {
        for (const budgetMinor of [null, 1_500_000]) {
          const message = build({ budgetMinor, totals: { expense_minor: 126_500, income_minor: 0 }, categories }, dict);
          expect(lineMessageProblems(message), JSON.stringify(categories?.map((row) => row.category.key))).toEqual([]);
        }
      }
    }
  });

  test("carries the altText and quick reply it was given", () => {
    const message = build({ altText: "the plain text" });
    expect(message.altText).toBe("the plain text");
    expect(message.quickReply).toBe(QUICK_REPLY);
  });

  test("the headline block: month, spent, spent figure, then income and net tiles side by side", () => {
    const message = build();

    expect(textsOf(message)).toEqual(["本月（2026 年 9 月）", "支出", "$6,060", "收入", "$52,000", "結餘", "+$45,940"]);
    expect(textNode(message, "$6,060")).toMatchObject({ size: "3xl", weight: "bold", color: CARD.text, wrap: true });
    expect(textNode(message, "$52,000")).toMatchObject({ color: CARD.mint });
    expect(textNode(message, "+$45,940")).toMatchObject({ color: CARD.mint });
    expect(barsOf(message)).toEqual([]);
  });

  test("net is coral when negative and plain when zero; income is plain when zero", () => {
    const negative = build({ totals: { expense_minor: 10000, income_minor: 4000 } });
    expect(textNode(negative, "-$60")).toMatchObject({ color: CARD.coral });
    expect(textNode(negative, "$40")).toMatchObject({ color: CARD.mint });

    const zero = build({ totals: { expense_minor: 0, income_minor: 0 } });
    const [income, net] = nodesWhere(zero, (node) => node.type === "text" && node.text === "$0");
    expect(income).toMatchObject({ color: CARD.text });
    expect(net).toMatchObject({ color: CARD.text });
  });

  test("with a budget there is a bar and how much is left; in amber at 80%, coral over", () => {
    const ok = build({ budgetMinor: 1_500_000 });
    expect(barsOf(ok)).toEqual([{ height: "8px", fill: { width: "40%", color: CARD.mint } }]);
    expect(textNode(ok, "預算 $15,000")).toMatchObject({ color: CARD.muted });
    expect(textNode(ok, "還剩 $8,940")).toMatchObject({ color: CARD.mint });

    const warn = build({ budgetMinor: 757_500 });
    expect(barsOf(warn)[0].fill).toEqual({ width: "80%", color: CARD.amber });

    const over = build({ budgetMinor: 500_000 });
    expect(barsOf(over)[0].fill).toEqual({ width: "100%", color: CARD.coral });
    expect(textNode(over, "已超出 $1,060")).toMatchObject({ color: CARD.coral });
  });

  test("the footer is one filled button that opens the ledger, under a hairline", () => {
    const message = build();

    expect(message.contents.footer).toMatchObject({ paddingAll: "12px", layout: "vertical" });
    expect(message.contents.styles.footer).toEqual({
      backgroundColor: CARD.bg,
      separator: true,
      separatorColor: CARD.hairline,
    });
    expect(actionsOf(message)).toEqual([{ type: "uri", label: "開啟帳本", uri: LEDGER_URI }]);
    const [button] = nodesWhere(message, (node) => node.type === "button");
    expect(button).toMatchObject({ style: "primary", color: CARD.buttonBg, height: "sm" });
  });

  describe("by category", () => {
    const expense126500 = { expense_minor: 126_500, income_minor: 0 };

    // [MV]: change the sort (amount desc, then key) and the order of these rows changes.
    test("lists the largest first, equal amounts by key, and folds the rest into 「其餘分類」", () => {
      const categories = rowsOf(FIVE());
      const message = build({ totals: expense126500, categories });

      const food = catalogDisplay("food", "zh-Hant");
      const shopping = catalogDisplay("shopping", "zh-Hant");
      const transport = catalogDisplay("transport", "zh-Hant");
      const health = catalogDisplay("health", "zh-Hant");
      const general = catalogDisplay("general", "zh-Hant");

      expect(textsOf(message).slice(7)).toEqual([
        "支出分類",
        shopping.emoji, shopping.label, "$500",
        food.emoji, food.label, "$300",
        transport.emoji, transport.label, "$300",
        health.emoji, health.label, "$50",
        general.emoji, general.label, "$45",
        PLUS_EMOJI, "其餘分類", "$70",
      ]);
      expect(barsOf(message).map((bar) => bar.fill)).toEqual([
        { width: "39%", color: "#EC6FA6" },
        { width: "23%", color: "#F0885A" },
        { width: "23%", color: "#5B9BF0" },
        { width: "3%", color: "#E5646E" },
        { width: "3%", color: "#4FC59A" },
        { width: "5%", color: CARD.muted },
      ]);
      // The bars are 4px, the row is a text line over a bar.
      expect(barsOf(message).every((bar) => bar.height === "4px")).toBe(true);
    });

    test("the 「其餘分類」 row and its amount are muted", () => {
      const message = build({ totals: expense126500, categories: rowsOf(FIVE()) });
      expect(textNode(message, "其餘分類")).toMatchObject({ color: CARD.muted });
      expect(textNode(message, "$70")).toMatchObject({ color: CARD.muted });
      expect(textNode(message, "$500")).toMatchObject({ color: CARD.text });
    });

    test("no 「其餘分類」 row when the rows add up to the month", () => {
      const message = build({ totals: { expense_minor: 119_500, income_minor: 0 }, categories: rowsOf(FIVE()) });
      expect(textsOf(message)).not.toContain("其餘分類");
      expect(textsOf(message)).not.toContain(PLUS_EMOJI);
    });

    test("no 「其餘分類」 row (and no negative) when the rows add up to more than the month", () => {
      const message = build({ totals: { expense_minor: 1000, income_minor: 0 }, categories: rowsOf([["food", 5000]]) });
      expect(textsOf(message)).not.toContain("其餘分類");
      expect(barsOf(message)[0].fill).toEqual({ width: "100%", color: "#F0885A" });
    });

    test("shows at most five rows even when given more, and the rest are 「其餘分類」", () => {
      const seven = rowsOf([...FIVE(), ["bills", 3000], ["education", 2000]]);
      const message = build({ totals: expense126500, categories: seven });

      expect(textsOf(message)).toContain(catalogDisplay("health", "zh-Hant").label);
      expect(textsOf(message)).not.toContain(catalogDisplay("bills", "zh-Hant").label);
      expect(textsOf(message)).not.toContain(catalogDisplay("education", "zh-Hant").label);
      // 126,500 - 119,500 = 7,000 -> $70, with the two small ones' 5,000 inside it.
      expect(textNode(message, "其餘分類")).toBeDefined();
      expect(textsOf(message).at(-1)).toBe("$70");
    });

    test("skips an amount that is zero, negative or not a number, and does not reorder what it was given", () => {
      const given = rowsOf([["food", 0], ["transport", -5], ["shopping", Number.NaN], ["health", 5000], ["general", 3000]]);

      const message = build({ totals: { expense_minor: 8000, income_minor: 0 }, categories: given });

      expect(textsOf(message)).toEqual(expect.arrayContaining([catalogDisplay("health", "zh-Hant").label, catalogDisplay("general", "zh-Hant").label]));
      expect(textsOf(message)).not.toContain(catalogDisplay("food", "zh-Hant").label);
      expect(textsOf(message)).not.toContain(catalogDisplay("transport", "zh-Hant").label);
      expect(textsOf(message)).not.toContain(catalogDisplay("shopping", "zh-Hant").label);
      expect(given.map((row) => row.category.key)).toEqual(["food", "transport", "shopping", "health", "general"]);
    });

    // [MV]: treat undefined like [] and a database without the breakdown claims "no spending".
    test("undefined (the database sent no breakdown) leaves the section out and never claims there was no spending", () => {
      const message = build({ totals: { expense_minor: 0, income_minor: 0 }, categories: undefined });
      expect(textsOf(message)).not.toContain("支出分類");
      expect(textsOf(message)).not.toContain("這個月還沒有支出");
    });

    test("an empty breakdown of a month with no spending says so", () => {
      const message = build({ totals: { expense_minor: 0, income_minor: 5_200_000 }, categories: [] });
      expect(textNode(message, "這個月還沒有支出")).toMatchObject({ color: CARD.muted, size: "sm", wrap: true });
      expect(textsOf(message)).not.toContain("支出分類");
    });

    test("an empty breakdown of a month that did spend says nothing rather than something false", () => {
      const message = build({ totals: { expense_minor: 6000, income_minor: 0 }, categories: [] });
      expect(textsOf(message)).not.toContain("這個月還沒有支出");
      expect(textsOf(message)).not.toContain("支出分類");
    });

    test("English: heading and the leftover row in English", () => {
      const message = build(
        { totals: expense126500, categories: rowsOf(FIVE()) },
        EN,
      );
      expect(textsOf(message)).toContain("By category");
      expect(textsOf(message)).toContain("Other categories");
    });
  });

  test("monthLabelText: Chinese does not zero-pad the month, English does", () => {
    expect(monthLabelText(ZH_HANT, 2026, 9)).toBe("本月（2026 年 9 月）");
    expect(monthLabelText(EN, 2026, 9)).toBe("This month (2026-09)");
  });
});

describe("budgetCard", () => {
  type BudgetArgs = Parameters<typeof budgetCard>[1];
  const budgetArgs = (overrides: Partial<BudgetArgs> = {}): BudgetArgs => ({
    mode: "set",
    currency: "TWD",
    budgetMinor: 1_500_000,
    spentMinor: 600_000,
    altText: "alt",
    quickReply: QUICK_REPLY,
    ...overrides,
  });
  const build = (overrides: Partial<BudgetArgs> = {}, dict: LineDictionary = ZH_HANT) =>
    budgetCard(dict, budgetArgs(overrides));

  test("every mode x budget state x currency x locale is a card LINE accepts", () => {
    for (const [, dict] of LOCALES) {
      for (const mode of ["set", "show"] as const) {
        for (const [label, budgetMinor, spentMinor] of BUDGET_STATES) {
          if (budgetMinor === null || budgetMinor <= 0) continue;
          for (const currency of CURRENCIES) {
            const message = build({ mode, budgetMinor, spentMinor, currency }, dict);
            expect(lineMessageProblems(message), `${mode} ${label} ${currency}`).toEqual([]);
          }
        }
        for (const [budgetMinor, spentMinor] of [
          [2_000_000_000, 100_000_000_000],
          [100_000_000_000, 0],
          [1, 100_000_000_000],
        ]) {
          const message = build({ mode, budgetMinor, spentMinor }, dict);
          expect(lineMessageProblems(message), `${mode} ${budgetMinor}/${spentMinor}`).toEqual([]);
        }
      }
    }
  });

  test("carries the altText and quick reply it was given", () => {
    const message = build({ altText: "the plain text" });
    expect(message.altText).toBe("the plain text");
    expect(message.quickReply).toBe(QUICK_REPLY);
  });

  test("setting a budget: mint heading, the amount, 40% used, what is left, this month's spending and the hint", () => {
    const message = build();

    expect(textsOf(message)).toEqual([
      "已設定每月預算",
      "$15,000",
      "已用 40%",
      "還剩 $9,000",
      "本月支出",
      "$6,000",
      "傳「預算 20000」修改，傳「取消預算」取消",
    ]);
    expect(textNode(message, "已設定每月預算")).toMatchObject({ color: CARD.mint, weight: "bold" });
    expect(barsOf(message)).toEqual([{ height: "10px", fill: { width: "40%", color: CARD.mint } }]);
    expect(textNode(message, "傳「預算 20000」修改，傳「取消預算」取消")).toMatchObject({ color: CARD.muted, wrap: true });
  });

  test("viewing a budget has the muted heading", () => {
    const message = build({ mode: "show" });
    expect(textNode(message, "每月預算")).toMatchObject({ color: CARD.muted });
    expect(textsOf(message)).not.toContain("已設定每月預算");
  });

  // [MV]: change a threshold or drop the 1% sliver and a row goes red.
  test.each([
    [0, "已用 0%", undefined, CARD.mint],
    [1, "已用 0%", "1%", CARD.mint],
    [7999, "已用 79%", "79%", CARD.mint],
    [8000, "已用 80%", "80%", CARD.amber],
    [10000, "已用 100%", "100%", CARD.amber],
    [10001, "已用 100%", "100%", CARD.coral],
    [50000, "已用 500%", "100%", CARD.coral],
  ])("a budget of $100 with %s minor units spent reads %s, bar %s in %s", (spentMinor, used, width, color) => {
    const message = build({ budgetMinor: 10000, spentMinor });
    expect(textNode(message, used)).toMatchObject({ color: CARD.muted });
    expect(barsOf(message)).toEqual([{ height: "10px", fill: width ? { width, color } : undefined }]);
  });

  test("over budget: coral 'over' and the bar full", () => {
    const message = build({ budgetMinor: 1_500_000, spentMinor: 2_000_000 });
    expect(textNode(message, "已超出 $5,000")).toMatchObject({ color: CARD.coral });
    expect(textNode(message, "已用 133%")).toBeDefined();
  });

  test("never has a button or an action", () => {
    expect(actionsOf(build())).toEqual([]);
  });

  test("English dictionary", () => {
    const message = build({ mode: "show" }, EN);
    expect(textsOf(message)).toEqual([
      "Monthly budget",
      "$15,000",
      "40% used",
      "$9,000 left",
      "Spent this month",
      "$6,000",
      'Send "budget 20000" to change it, or "budget off" to remove it',
    ]);
  });

  test("budgetRemainingText: left at or under the budget, over beyond it", () => {
    expect(budgetRemainingText(ZH_HANT, "TWD", 1_500_000, 600_000)).toBe("還剩 $9,000");
    expect(budgetRemainingText(ZH_HANT, "TWD", 1_500_000, 1_500_000)).toBe("還剩 $0");
    expect(budgetRemainingText(ZH_HANT, "TWD", 1_500_000, 2_000_000)).toBe("已超出 $5,000");
    expect(budgetRemainingText(EN, "TWD", 1_500_000, 2_000_000)).toBe("$5,000 over");
  });
});

// ---------------------------------------------------------------------------
// Link and linked cards
// ---------------------------------------------------------------------------

describe("linkCard", () => {
  type LinkArgs = Parameters<typeof linkCard>[1];
  const URL = "https://equo-mu.vercel.app/line/link?linkToken=abc123&openExternalBrowser=1";
  const HERO = "https://equo-mu.vercel.app/assets/line/link-hero-v1.jpg";
  const linkArgs = (overrides: Partial<LinkArgs> = {}): LinkArgs => ({
    heading: ZH_HANT.linkCardTitle,
    lead: undefined,
    url: URL,
    heroUrl: HERO,
    altText: ZH_HANT.linkAltText,
    ...overrides,
  });
  const build = (overrides: Partial<LinkArgs> = {}, dict: LineDictionary = ZH_HANT) =>
    linkCard(dict, linkArgs(overrides));

  test("every heading x lead x hero x locale is a card LINE accepts", () => {
    for (const [, dict] of LOCALES) {
      for (const heading of [dict.welcomeCardTitle, dict.linkCardTitle]) {
        for (const lead of [undefined, dict.welcome, dict.welcomeBack, dict.linkFailed, "長".repeat(80)]) {
          for (const heroUrl of [HERO, null]) {
            const message = build({ heading, lead, heroUrl, altText: lead ?? dict.linkAltText }, dict);
            expect(lineMessageProblems(message), `${heading} / ${lead?.slice(0, 6)} / ${heroUrl}`).toEqual([]);
          }
        }
      }
    }
  });

  test("carries the altText it was given and has no quick reply", () => {
    const message = build({ altText: "plain greeting" });
    expect(message.altText).toBe("plain greeting");
    expect(message.quickReply).toBeUndefined();
  });

  test("without a lead: the heading, then the standing prompt", () => {
    const message = build();
    expect(textsOf(message)).toEqual([ZH_HANT.linkCardTitle, ZH_HANT.linkPrompt]);
    expect(textNode(message, ZH_HANT.linkCardTitle)).toMatchObject({ size: "lg", weight: "bold", color: CARD.text, wrap: true });
    expect(textNode(message, ZH_HANT.linkPrompt)).toMatchObject({ size: "xs", color: CARD.muted, wrap: true, margin: "md" });
  });

  test("with a lead: the heading, the lead in body colour, then the prompt", () => {
    const message = build({ heading: ZH_HANT.welcomeCardTitle, lead: ZH_HANT.welcome });
    expect(textsOf(message)).toEqual([ZH_HANT.welcomeCardTitle, ZH_HANT.welcome, ZH_HANT.linkPrompt]);
    expect(textNode(message, ZH_HANT.welcome)).toMatchObject({ size: "sm", color: CARD.text, wrap: true, margin: "md" });
  });

  // [MV]: let a non-https origin through and LINE is asked to fetch an image it never will.
  test("with a hero url: a full-width 2:1 cover banner on the card background, and no brand strip", () => {
    const message = build();

    expect(message.contents.hero).toEqual({
      type: "image",
      url: HERO,
      size: "full",
      aspectRatio: "2:1",
      aspectMode: "cover",
      backgroundColor: CARD.bg,
    });
    expect(message.contents.styles.hero).toEqual({ backgroundColor: CARD.bg });
    expect(message.contents.body.paddingAll).toBe("0px");
    expect(message.contents.body.contents).toHaveLength(1);
    expect(message.contents.body.contents[0]).toMatchObject({ type: "box", paddingAll: "20px" });
  });

  test("without one: no hero at all, and the brand strip stands in", () => {
    const message = build({ heroUrl: null });

    expect(message.contents.hero).toBeUndefined();
    expect(message.contents.styles).not.toHaveProperty("hero");
    expect(message.contents.body.contents[0]).toEqual(brandStrip());
    expect(message.contents.body.contents).toHaveLength(2);
  });

  test("the footer is one primary button to the link page, in the button green and not in mint", () => {
    const message = build();

    expect(message.contents.footer).toMatchObject({ paddingAll: "16px", paddingTop: "0px", layout: "vertical" });
    expect(message.contents.styles.footer).toEqual({ backgroundColor: CARD.bg });
    expect(actionsOf(message)).toEqual([{ type: "uri", label: ZH_HANT.linkButton, uri: URL }]);
    const [button] = nodesWhere(message, (node) => node.type === "button");
    expect(button).toMatchObject({ style: "primary", color: CARD.buttonBg, height: "md" });
    expect(CARD.buttonBg).not.toBe(CARD.mint);
  });

  test("English dictionary", () => {
    const message = build({ heading: EN.welcomeCardTitle, lead: EN.welcome, altText: EN.welcome }, EN);
    expect(textsOf(message)).toEqual([EN.welcomeCardTitle, EN.welcome, EN.linkPrompt]);
    expect(actionsOf(message)[0]).toMatchObject({ label: "Link Equo account" });
  });
});

describe("linkedCard", () => {
  const build = (dict: LineDictionary = ZH_HANT, maskedEmail = "al***@example.com") =>
    linkedCard(dict, { maskedEmail, altText: fill(dict.linked, { email: maskedEmail }) });

  test("is a card LINE accepts in both locales, with a short or a very long address", () => {
    for (const [, dict] of LOCALES) {
      for (const email of ["a***@b.co", "al***@example.com", `al***@${"long".repeat(40)}.example.com`]) {
        expect(lineMessageProblems(build(dict, email)), email).toEqual([]);
      }
    }
  });

  test("a mint check tile, the title over the masked address, a rule, and the hint", () => {
    const message = build();

    expect(textsOf(message)).toEqual(["\u{2705}", ZH_HANT.linkedCardTitle, "al***@example.com", ZH_HANT.linkedCardHint]);
    const [tile] = nodesWhere(message, (node) => node.width === "44px");
    expect(tile).toMatchObject({ height: "44px", cornerRadius: "12px", backgroundColor: tint(CARD.mint) });
    expect(textNode(message, ZH_HANT.linkedCardTitle)).toMatchObject({ size: "md", weight: "bold", color: CARD.text });
    expect(textNode(message, "al***@example.com")).toMatchObject({ size: "xs", color: CARD.muted });
    expect(textNode(message, ZH_HANT.linkedCardHint)).toMatchObject({ size: "sm", color: CARD.text, wrap: true });
  });

  test("carries the altText it was given, has no quick reply, and nothing to tap", () => {
    const message = linkedCard(ZH_HANT, { maskedEmail: "al***@example.com", altText: "plain" });
    expect(message.altText).toBe("plain");
    expect(message.quickReply).toBeUndefined();
    expect(actionsOf(message)).toEqual([]);
  });

  test("English dictionary", () => {
    expect(textsOf(build(EN))).toEqual(["\u{2705}", EN.linkedCardTitle, "al***@example.com", EN.linkedCardHint]);
  });
});
