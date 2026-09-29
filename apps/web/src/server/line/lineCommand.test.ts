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

describe("parseLineCommand - income without a marker", () => {
  // [MV]
  test.each([
    ["薪水 50000", "薪水", 5000000, "salary"],
    ["薪資 50000", "薪資", 5000000, "salary"],
    ["salary 50000", "salary", 5000000, "salary"],
    ["月薪 42000", "月薪", 4200000, "salary"],
    ["獎金 3000", "獎金", 300000, "bonus"],
    ["bonus 3000", "bonus", 300000, "bonus"],
    ["利息 50", "利息", 5000, "investment"],
    ["dividend 120", "dividend", 12000, "investment"],
  ])('"%s" -> income %s', (text, title, amountMinor, category) => {
    expect(record(text)).toMatchObject({ kind: "income", title, amountMinor, category });
  });

  test("a mixed title is an expense: an expense keyword anywhere beats an income one", () => {
    // Documented rule: income only when the title hits the income scope AND
    // nothing in it hits an expense label or keyword. Expense wins the tie.
    expect(record("利息 50 早餐")).toMatchObject({ kind: "expense", title: "利息 早餐", category: "food" });
    expect(record("bonus lunch 100")).toMatchObject({ kind: "expense", category: "food" });
  });

  test("an explicit 支出 / expense marker switches the inference off", () => {
    expect(record("支出 薪水 100")).toMatchObject({ kind: "expense", title: "薪水" });
    expect(record("expense salary 100")).toMatchObject({ kind: "expense" });
  });

  test("ordinary expenses are unaffected", () => {
    expect(record("早餐 60").kind).toBe("expense");
    expect(record("薪水袋 60").kind).toBe("income");
  });
});

describe("parseLineCommand - the stored title stays as typed", () => {
  test("full-width letters and digits in the title are not folded", () => {
    expect(record("ＬＵＮＣＨ 60")).toMatchObject({ title: "ＬＵＮＣＨ", amountMinor: 6000, category: "food" });
  });

  test("a glued full-width amount keeps the title's own spelling", () => {
    expect(record("ｃａｆｅ６０")).toMatchObject({ title: "ｃａｆｅ", amountMinor: 6000 });
  });

  test("a trailing full stop on the amount is ignored", () => {
    expect(record("早餐 60.").amountMinor).toBe(6000);
    expect(record("早餐 60。").amountMinor).toBe(6000);
    expect(record("60． 早餐").amountMinor).toBe(6000);
    expect(record("咖啡 85.5.").amountMinor).toBe(8550);
  });

  test("a title that ends in a stop but is not an amount is left alone", () => {
    expect(record("Mr. Wong 60").title).toBe("Mr. Wong");
  });
});

describe("parseLineCommand - dates are refused", () => {
  // [MV]
  test.each(["午餐 120 9/30", "午餐 120 9-30", "午餐 120 2026/9/30", "午餐 120 2026-09-30", "午餐 120 9月30日", "9/30 午餐 120", "午餐 120 ９／３０"])(
    '"%s" -> date_not_supported',
    (text) => {
      expect(errorReason(text)).toBe("date_not_supported");
    },
  );

  test("a store name that looks like a short date is still a title (7-11, 5-12)", () => {
    expect(record("7-11 咖啡 45").title).toBe("7-11 咖啡");
    expect(record("5-12 飲料 30").title).toBe("5-12 飲料");
  });

  test("an amount is not mistaken for a date", () => {
    expect(record("咖啡 9.5").amountMinor).toBe(950);
  });
});

describe("parseLineCommand - budget commands", () => {
  test.each([
    "預算",
    "每月預算",
    "本月預算",
    "查看預算",
    "我的預算",
    "预算",
    "budget",
    "Budget",
    "monthly budget",
    "my budget",
  ])('"%s" -> budget_show', (text) => {
    expect(parse(text)).toEqual({ type: "budget_show" });
  });

  test.each([
    "預算 15000",
    "預算15000",
    "設定預算 15000",
    "每月預算 15000",
    "預算：15000",
    "預算 15,000元",
    "預算 NT$15000",
    "預算 １５０００",
    "budget 15000",
    "set budget 15000",
    "預算 15000.",
    "預算 15000。",
  ])('"%s" -> budget_set 1500000', (text) => {
    expect(parse(text)).toEqual({ type: "budget_set", amountMinor: 1500000 });
  });

  test.each(["預算改 20000", "預算改成 20000", "預算改為20000", "修改預算 20000"])(
    '"%s" -> budget_set 2000000',
    (text) => {
      expect(parse(text)).toEqual({ type: "budget_set", amountMinor: 2000000 });
    },
  );

  test('"預算 15000.5" -> budget_set 1500050', () => {
    expect(parse("預算 15000.5")).toEqual({ type: "budget_set", amountMinor: 1500050 });
  });

  test('JPY "預算 50000" -> budget_set 5000000', () => {
    expect(parse("預算 50000", "JPY")).toEqual({ type: "budget_set", amountMinor: 5000000 });
  });

  test('JPY "預算 500.5" -> no_decimals', () => {
    expect(errorReason("預算 500.5", "JPY")).toBe("no_decimals");
  });

  // [MV]: delete 取消預算 from BUDGET_CLEAR_COMMANDS and this goes red.
  test.each([
    "刪除預算",
    "清除預算",
    "取消預算",
    "移除預算",
    "删除预算",
    "budget off",
    "Budget Off",
    "clear budget",
    "remove budget",
  ])('"%s" -> budget_clear', (text) => {
    expect(parse(text)).toEqual({ type: "budget_clear" });
  });

  // [MV]: map the amount-0 case to budget_clear and this goes red. A budget
  // of 0 does not exist; clearing needs explicit words.
  test('"預算 0" -> budget_invalid, never a clear', () => {
    expect(parse("預算 0")).toEqual({ type: "error", reason: "budget_invalid" });
  });

  test.each(["預算 -500", "預算 +15000", "預算 1.234", "預算 99999999999"])('"%s" -> budget_invalid', (text) => {
    expect(errorReason(text)).toBe("budget_invalid");
  });

  // [MV]: drop the "rest must be exactly one amount token" check, or match
  // the prefix with includes() instead of startsWith(), and these go red.
  test.each([
    ["預算外 300", "預算外", 30000],
    ["預算外300", "預算外", 30000],
    ["預算書 200", "預算書", 20000],
    ["budgeting 50", "budgeting", 5000],
    ["買 預算 300", "買 預算", 30000],
  ])('"%s" is still recorded as an expense titled "%s"', (text, title, amountMinor) => {
    expect(record(text)).toMatchObject({ kind: "expense", title, amountMinor });
  });

  test('"預算 15000 餐飲" (more than one token) is a record, not a budget', () => {
    expect(record("預算 15000 餐飲")).toMatchObject({ title: "預算", amountMinor: 1500000, category: "food" });
  });

  test('"預算改" alone -> not_understood', () => {
    expect(errorReason("預算改")).toBe("not_understood");
  });

  test("the neighbouring commands are unchanged: 取消上一筆 -> undo, 取消綁定 -> unlink", () => {
    expect(parse("取消上一筆")).toEqual({ type: "undo" });
    expect(parse("取消綁定")).toEqual({ type: "unlink" });
  });
});
