import { describe, expect, test } from "vitest";
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

  test.each(["linkPrompt", "linkFailed"] as const)("%s is at most 160 characters in both locales", (key) => {
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
