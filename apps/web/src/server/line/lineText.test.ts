import { describe, expect, test } from "vitest";
import { parseLineCommand } from "./lineCommand.js";
import { LINE_TEXT_EN as EN, LINE_TEXT_ZH_HANT as ZH_HANT, lineText } from "./lineText.js";

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

  test.each(["linkPrompt", "linkFailed", "budgetNone", "budgetInvalid"] as const)("%s is at most 160 characters in both locales", (key) => {
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

describe("budget examples in the reply text actually parse", () => {
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
  ];

  test.each(cases)("%s teaches %s -> %s", (_label, text, example, type) => {
    expect(text).toContain(example);
    // A quoted example ("預算" / "budget") is checked without its quotes.
    expect(parse(example.replace(/[「」"]/g, ""))).toBe(type);
  });
});
