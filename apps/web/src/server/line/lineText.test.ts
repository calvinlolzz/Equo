import { describe, expect, test } from "vitest";
import { fill } from "../push/pushText.js";
import { parseLineCommand } from "./lineCommand.js";
import { type LineDictionary, LINE_TEXT_EN as EN, LINE_TEXT_ZH_HANT as ZH_HANT, lineText } from "./lineText.js";

const SHORT_LIMIT = 20;
const MEDIUM_LIMIT = 160;
const LONG_LIMIT = 400;

function placeholders(template: string): Set<string> {
  return new Set([...template.matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
}

describe("LINE_TEXT dictionaries", () => {
  test("zh-Hant and en have exactly the same keys", () => {
    expect(Object.keys(ZH_HANT).sort()).toEqual(Object.keys(EN).sort());
  });

  test("templated keys keep the same placeholders in both locales, except monthLabel", () => {
    for (const key of Object.keys(ZH_HANT) as Array<keyof typeof ZH_HANT>) {
      if (key === "monthLabel") continue;
      expect(placeholders(ZH_HANT[key]), `${key} (zh)`).toEqual(placeholders(EN[key]));
    }
  });

  test("monthLabel uses {year}/{month} in zh and {year}/{month2} in en (Chinese doesn't zero-pad the month)", () => {
    expect(placeholders(ZH_HANT.monthLabel)).toEqual(new Set(["year", "month"]));
    expect(placeholders(EN.monthLabel)).toEqual(new Set(["year", "month2"]));
  });

  test("recordedExpense carries title/amount/category/spent/budget", () => {
    expect(placeholders(ZH_HANT.recordedExpense)).toEqual(
      new Set(["title", "amount", "category", "spent", "budget"]),
    );
  });

  test("undoNothing and help carry {minutes}", () => {
    expect(placeholders(ZH_HANT.undoNothing).has("minutes")).toBe(true);
    expect(placeholders(ZH_HANT.help).has("minutes")).toBe(true);
  });

  test("noDecimals carries {currency}", () => {
    expect(placeholders(ZH_HANT.noDecimals).has("currency")).toBe(true);
  });

  test("budgetSet and budgetShow carry exactly budget/spent/remaining", () => {
    for (const dict of [ZH_HANT, EN]) {
      expect(placeholders(dict.budgetSet)).toEqual(new Set(["budget", "spent", "remaining"]));
      expect(placeholders(dict.budgetShow)).toEqual(new Set(["budget", "spent", "remaining"]));
    }
  });

  test("budgetRemainingLeft carries {left} and budgetRemainingOver carries {over}", () => {
    for (const dict of [ZH_HANT, EN]) {
      expect(placeholders(dict.budgetRemainingLeft)).toEqual(new Set(["left"]));
      expect(placeholders(dict.budgetRemainingOver)).toEqual(new Set(["over"]));
    }
  });

  test.each(["linkPrompt", "linkFailed", "budgetNone", "budgetInvalid", "budgetTooLarge", "budgetAmbiguous"] as const)("%s is at most 160 characters in both locales", (key) => {
    expect([...ZH_HANT[key]].length).toBeLessThanOrEqual(MEDIUM_LIMIT);
    expect([...EN[key]].length).toBeLessThanOrEqual(MEDIUM_LIMIT);
  });

  test.each(["linkButton", "undoLabel", "monthButtonLabel", "openLedgerLabel"] as const)(
    "%s is at most 20 characters in both locales (quick-reply label limit)",
    (key) => {
      expect([...ZH_HANT[key]].length).toBeLessThanOrEqual(SHORT_LIMIT);
      expect([...EN[key]].length).toBeLessThanOrEqual(SHORT_LIMIT);
    },
  );

  // [MV]: remove the help bullet and this goes red.
  test("help teaches the budget commands in both locales", () => {
    expect(ZH_HANT.help).toContain("預算 15000");
    expect(ZH_HANT.help).toContain("取消預算");
    expect(EN.help).toContain("budget 15000");
    expect(EN.help).toContain("budget off");
  });

  test("linkAltText is at most 400 characters in both locales", () => {
    expect([...ZH_HANT.linkAltText].length).toBeLessThanOrEqual(LONG_LIMIT);
    expect([...EN.linkAltText].length).toBeLessThanOrEqual(LONG_LIMIT);
  });
});

/**
 * The copy the Flex reply cards read (lineCards.ts). Listed here, not derived,
 * so adding or dropping a key is a visible change to this file.
 */
const CARD_KEYS = [
  "cardExpenseTitle",
  "cardIncomeTitle",
  "cardDate",
  "cardMonthSpent",
  "cardMonthIncome",
  "cardBudgetOf",
  "cardSpentLabel",
  "cardIncomeLabel",
  "cardNetLabel",
  "cardByCategory",
  "cardOtherCategories",
  "cardNoSpending",
  "cardBudgetSetTitle",
  "cardBudgetShowTitle",
  "cardBudgetUsed",
  "cardBudgetHint",
  "helpCardTitle",
  "helpCardLead",
  "helpExpenseTitle",
  "helpExpenseCmd",
  "helpIncomeTitle",
  "helpIncomeCmd",
  "helpMonthTitle",
  "helpMonthCmd",
  "helpBudgetTitle",
  "helpBudgetCmd",
  "helpUndoTitle",
  "helpUndoCmd",
  "helpUnlinkTitle",
  "helpUnlinkCmd",
  "helpCardNote",
  "welcomeCardTitle",
  "linkCardTitle",
  "linkedCardTitle",
  "linkedCardHint",
] as const satisfies ReadonlyArray<keyof LineDictionary>;

/** The headings of the cards: one line, beside a date or above an amount. (The help rows' titles are sentences.) */
const CARD_TITLES = [
  "cardExpenseTitle",
  "cardIncomeTitle",
  "cardBudgetSetTitle",
  "cardBudgetShowTitle",
  "helpCardTitle",
  "welcomeCardTitle",
  "linkCardTitle",
  "linkedCardTitle",
] as const satisfies ReadonlyArray<keyof LineDictionary>;

const CARD_PLACEHOLDERS: Partial<Record<keyof LineDictionary, string[]>> = {
  cardDate: ["month", "day"],
  cardBudgetOf: ["budget"],
  cardBudgetUsed: ["percent"],
  helpUndoTitle: ["minutes"],
};

describe("Flex card copy", () => {
  test("is the 35 keys the plan lists, once each", () => {
    expect(CARD_KEYS).toHaveLength(35);
    expect(new Set(CARD_KEYS).size).toBe(35);
  });

  test.each(CARD_KEYS)("%s is real copy in both locales: not empty, no stray whitespace", (key) => {
    for (const dict of [ZH_HANT, EN]) {
      expect(dict[key]).not.toBe("");
      expect(dict[key].trim()).toBe(dict[key]);
    }
  });

  // [MV]: rename a placeholder in one locale (or leave one in a key that takes none) and this names it.
  test.each(CARD_KEYS)("%s carries exactly its own placeholders in both locales", (key) => {
    const expected = new Set(CARD_PLACEHOLDERS[key] ?? []);
    expect(placeholders(ZH_HANT[key]), `${key} (zh)`).toEqual(expected);
    expect(placeholders(EN[key]), `${key} (en)`).toEqual(expected);
  });

  // [MV]: a longer string wraps onto a line the layout was not drawn for.
  test.each(CARD_KEYS)("%s is at most 80 characters in both locales", (key) => {
    expect([...ZH_HANT[key]].length).toBeLessThanOrEqual(80);
    expect([...EN[key]].length).toBeLessThanOrEqual(80);
  });

  test.each(CARD_TITLES)("%s is at most 24 characters in both locales", (key) => {
    expect([...ZH_HANT[key]].length).toBeLessThanOrEqual(24);
    expect([...EN[key]].length).toBeLessThanOrEqual(24);
  });

  // The help card's altText and its text fallback are both this string. English is already within a clause of the limit.
  // [MV]: add a clause to either help string and this goes red.
  test("the plain help text still fits altText's 400 UTF-16 units with a four-digit undo window", () => {
    expect(fill(ZH_HANT.help, { minutes: 1440 }).length).toBeLessThanOrEqual(400);
    expect(fill(EN.help, { minutes: 1440 }).length).toBeLessThanOrEqual(400);
  });
});

describe("lineText", () => {
  test("returns zh-Hant for null/undefined/unknown locale", () => {
    expect(lineText(null)).toBe(ZH_HANT);
    expect(lineText(undefined)).toBe(ZH_HANT);
    expect(lineText("fr")).toBe(ZH_HANT);
  });

  test("returns the matching dictionary for a known locale", () => {
    expect(lineText("en")).toBe(EN);
    expect(lineText("zh-Hant")).toBe(ZH_HANT);
  });
});

describe("command examples in the reply text actually parse", () => {
  const parse = (text: string) => parseLineCommand(text, { currency: "TWD", categories: [] }).type;

  // Every command a string teaches must do what the string says it does.
  const cases: Array<[string, string, string, string]> = [
    ["zh help", ZH_HANT.help, "預算 15000", "budget_set"],
    ["zh help", ZH_HANT.help, "「預算」", "budget_show"],
    ["zh help", ZH_HANT.help, "取消預算", "budget_clear"],
    ["zh budgetNone", ZH_HANT.budgetNone, "預算 15000", "budget_set"],
    ["zh budgetInvalid", ZH_HANT.budgetInvalid, "預算 15000", "budget_set"],
    ["zh budgetInvalid", ZH_HANT.budgetInvalid, "取消預算", "budget_clear"],
    ["en help", EN.help, "budget 15000", "budget_set"],
    ["en help", EN.help, '"budget"', "budget_show"],
    ["en help", EN.help, "budget off", "budget_clear"],
    ["en budgetNone", EN.budgetNone, "budget 15000", "budget_set"],
    ["en budgetInvalid", EN.budgetInvalid, "budget 15000", "budget_set"],
    ["en budgetInvalid", EN.budgetInvalid, "budget off", "budget_clear"],
    ["zh budgetAmbiguous", ZH_HANT.budgetAmbiguous, "預算 15000", "budget_set"],
    ["zh budgetAmbiguous", ZH_HANT.budgetAmbiguous, "買預算書 200", "record"],
    ["en budgetAmbiguous", EN.budgetAmbiguous, "budget 15000", "budget_set"],
    ["zh cardBudgetHint", ZH_HANT.cardBudgetHint, "預算 20000", "budget_set"],
    ["zh cardBudgetHint", ZH_HANT.cardBudgetHint, "取消預算", "budget_clear"],
    ["en cardBudgetHint", EN.cardBudgetHint, "budget 20000", "budget_set"],
    ["en cardBudgetHint", EN.cardBudgetHint, "budget off", "budget_clear"],
    ["zh linkedCardHint", ZH_HANT.linkedCardHint, "早餐 60", "record"],
    ["zh linkedCardHint", ZH_HANT.linkedCardHint, "說明", "help"],
    ["en linkedCardHint", EN.linkedCardHint, "breakfast 60", "record"],
    ["en linkedCardHint", EN.linkedCardHint, "help", "help"],
  ];

  test.each(cases)("%s teaches %s -> %s", (_label, text, example, type) => {
    expect(text).toContain(example);
    // A quoted example ("預算" / "budget") is checked without its quotes.
    expect(parse(example.replace(/[「」"]/g, ""))).toBe(type);
  });
});

describe("the example commands on the help card actually parse", () => {
  const parse = (text: string) => parseLineCommand(text, { currency: "TWD", categories: [] });

  // What each example must parse to, in the order the card lists them. Income
  // examples are checked for their kind too: "+52000 薪水" parsing as an expense
  // would record the wrong sign of money.
  const TEACHES: Array<[keyof LineDictionary, Array<Record<string, string>>]> = [
    ["helpExpenseCmd", [{ type: "record", kind: "expense" }, { type: "record", kind: "expense" }]],
    ["helpIncomeCmd", [{ type: "record", kind: "income" }, { type: "record", kind: "income" }]],
    ["helpMonthCmd", [{ type: "month" }]],
    ["helpBudgetCmd", [{ type: "budget_set" }, { type: "budget_show" }, { type: "budget_clear" }]],
    ["helpUndoCmd", [{ type: "undo" }]],
    ["helpUnlinkCmd", [{ type: "unlink" }]],
  ];

  const cases = TEACHES.flatMap(([key, expected]) =>
    ([["zh-Hant", ZH_HANT], ["en", EN]] as const).map(([locale, dict]) => [locale, key, dict[key], expected] as const),
  );

  // [MV]: change an example, drop one, or swap the " · " separator and this goes red.
  test.each(cases)("%s %s: %j", (_locale, _key, value, expected) => {
    const examples = value.split(" · ");
    expect(examples).toHaveLength(expected.length);
    examples.forEach((example, index) => {
      expect(parse(example), example).toMatchObject(expected[index]);
    });
  });

  test("every *Cmd key is covered by the table above", () => {
    const covered = TEACHES.map(([key]) => key).sort();
    const all = CARD_KEYS.filter((key) => key.endsWith("Cmd")).sort();
    expect(covered).toEqual(all);
  });
});
