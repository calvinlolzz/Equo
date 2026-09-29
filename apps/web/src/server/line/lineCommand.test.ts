import { describe, expect, test } from "vitest";
import { DEFAULT_CATALOG, defaultCategoryKey } from "../../app/catalog.js";
import { LINE_CATEGORY_KEYWORDS } from "./lineCategoryKeywords.js";
import {
  LINE_DEFAULT_CATEGORY,
  LINE_FALLBACK_CATEGORIES,
  type LineCommand,
  parseLineCommand,
} from "./lineCommand.js";

const CATEGORIES = DEFAULT_CATALOG.categories;

function parse(text: string, currency = "TWD"): LineCommand {
  return parseLineCommand(text, { currency, categories: CATEGORIES });
}

function record(text: string, currency = "TWD") {
  const result = parse(text, currency);
  expect(result.type).toBe("record");
  return result as Extract<LineCommand, { type: "record" }>;
}

function errorReason(text: string, currency = "TWD") {
  const result = parse(text, currency);
  expect(result.type).toBe("error");
  return (result as Extract<LineCommand, { type: "error" }>).reason;
}

describe("parseLineCommand - exact commands", () => {
  const cases: Array<[string[], LineCommand["type"]]> = [
    [["本月", "month"], "month"],
    [["復原", "undo"], "undo"],
    [["說明", "help", "？"], "help"],
    [["解除綁定", "unlink"], "unlink"],
    [["綁定", "link"], "link"],
  ];

  for (const [texts, type] of cases) {
    for (const text of texts) {
      test(`"${text}" -> ${type}`, () => {
        expect(parse(text)).toEqual({ type });
      });
    }
  }
});

describe("parseLineCommand - record grammar (§3 table)", () => {
  test.each([
    "早餐 60",
    "60 早餐",
    "早餐60",
    "早餐 ６０",
    "早餐 60元",
    "早餐 60塊",
    "早餐 NT$60",
  ])('"%s" -> expense 早餐 6000 (food)', (text) => {
    const r = record(text);
    expect(r).toMatchObject({ kind: "expense", title: "早餐", amountMinor: 6000, category: "food" });
  });

  test('"午餐 120 餐飲" -> expense 午餐 12000 food (category token stripped from title)', () => {
    const r = record("午餐 120 餐飲");
    expect(r).toMatchObject({ kind: "expense", title: "午餐", amountMinor: 12000, category: "food" });
  });

  test('"lunch 120 Food" -> expense lunch 12000 food', () => {
    const r = record("lunch 120 Food");
    expect(r).toMatchObject({ kind: "expense", title: "lunch", amountMinor: 12000, category: "food" });
  });

  test('"計程車 1,250" -> expense 計程車 125000 transport (thousands separator)', () => {
    const r = record("計程車 1,250");
    expect(r).toMatchObject({ kind: "expense", title: "計程車", amountMinor: 125000, category: "transport" });
  });

  test('"7-11 咖啡 45" -> expense "7-11 咖啡" 4500 food (dash is not an amount)', () => {
    const r = record("7-11 咖啡 45");
    expect(r).toMatchObject({ kind: "expense", title: "7-11 咖啡", amountMinor: 4500, category: "food" });
  });

  test('"交通 50" -> expense 交通 5000 transport (single token is both title and category)', () => {
    const r = record("交通 50");
    expect(r).toMatchObject({ kind: "expense", title: "交通", amountMinor: 5000, category: "transport" });
  });

  test('"咖啡 85.5" -> 8550 minor', () => {
    expect(record("咖啡 85.5").amountMinor).toBe(8550);
  });

  test('"咖啡 85.555" -> invalid_amount (more than 2 decimal places)', () => {
    expect(errorReason("咖啡 85.555")).toBe("invalid_amount");
  });

  test('"咖啡 1,2,3" -> invalid_amount (bad grouping)', () => {
    expect(errorReason("咖啡 1,2,3")).toBe("invalid_amount");
  });

  test.each(["+52000 薪水", "＋52000 薪水", "收入 52000 薪水"])('"%s" -> income 薪水 5200000 salary', (text) => {
    const r = record(text);
    expect(r).toMatchObject({ kind: "income", title: "薪水", amountMinor: 5200000, category: "salary" });
  });

  test('"60" alone -> missing_title', () => {
    expect(errorReason("60")).toBe("missing_title");
  });

  test('"收入 3000" -> missing_title', () => {
    expect(errorReason("收入 3000")).toBe("missing_title");
  });

  test('"午餐 120 飲料 50" -> multiple_amounts', () => {
    expect(errorReason("午餐 120 飲料 50")).toBe("multiple_amounts");
  });

  test('"早餐 0" -> invalid_amount', () => {
    expect(errorReason("早餐 0")).toBe("invalid_amount");
  });

  test('"早餐 -60" -> invalid_amount', () => {
    expect(errorReason("早餐 -60")).toBe("invalid_amount");
  });

  test('"早餐" alone -> not_understood', () => {
    expect(errorReason("早餐")).toBe("not_understood");
  });

  test('"早餐 10000001" -> too_large', () => {
    expect(errorReason("早餐 10000001")).toBe("too_large");
  });

  test('JPY "ラーメン 980" -> 98000 minor, no error', () => {
    const r = record("ラーメン 980", "JPY");
    expect(r.amountMinor).toBe(98000);
    expect(r.kind).toBe("expense");
  });

  test('JPY "ラーメン 980.5" -> no_decimals', () => {
    expect(errorReason("ラーメン 980.5", "JPY")).toBe("no_decimals");
  });

  test("a 61-character title -> title_too_long", () => {
    const longTitle = "字".repeat(61);
    expect(errorReason(`${longTitle} 60`)).toBe("title_too_long");
  });

  test("a 60-character title is fine", () => {
    const title = "字".repeat(60);
    const r = record(`${title} 60`);
    expect(r.title).toBe(title);
  });
});

describe("parseLineCommand - default category", () => {
  test("LINE_DEFAULT_CATEGORY matches app/catalog.ts's defaultCategoryKey for the personal ledger", () => {
    expect(LINE_DEFAULT_CATEGORY.expense).toBe(defaultCategoryKey({ personal: true, mode: "expense" }));
    expect(LINE_DEFAULT_CATEGORY.income).toBe(defaultCategoryKey({ personal: true, mode: "income" }));
  });
});

describe("LINE_FALLBACK_CATEGORIES", () => {
  test("keys and scopes equal app/catalog.ts's DEFAULT_CATALOG.categories", () => {
    const fallback = [...LINE_FALLBACK_CATEGORIES]
      .map((c) => ({ key: c.key, scope: c.scope }))
      .sort((a, b) => a.key.localeCompare(b.key));
    const canonical = CATEGORIES.map((c) => ({ key: c.key, scope: c.scope })).sort((a, b) =>
      a.key.localeCompare(b.key),
    );
    expect(fallback).toEqual(canonical);
  });
});

describe("LINE_CATEGORY_KEYWORDS", () => {
  test("every keyword key exists in app/catalog.ts's DEFAULT_CATALOG", () => {
    const catalogKeys = new Set(CATEGORIES.map((c) => c.key));
    for (const entry of LINE_CATEGORY_KEYWORDS) {
      expect(catalogKeys.has(entry.key), `keyword key "${entry.key}" should exist in DEFAULT_CATALOG`).toBe(true);
    }
  });
});
