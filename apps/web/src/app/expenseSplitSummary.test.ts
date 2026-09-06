import { describe, expect, test } from "vitest";
import { buildSplitSummary } from "./expenseSplitSummary";
import { dictionaryFor } from "./uiText";

const zh = dictionaryFor("zh-Hant").splitSummary;
const en = dictionaryFor("en").splitSummary;

const base = {
  mode: "expense" as const,
  payerName: "小明",
  payerCount: 1,
  shareCount: 4,
  splitMode: "equal" as const,
};

describe("buildSplitSummary", () => {
  test("the common case reads as one sentence in both languages", () => {
    expect(buildSplitSummary(base, zh)).toBe("小明付 · 4 人均分");
    expect(buildSplitSummary({ ...base, payerName: "Alex" }, en)).toBe("Alex paid · split 4 ways");
  });

  test("the share count is who it is split between, not the whole group", () => {
    expect(buildSplitSummary({ ...base, shareCount: 2 }, zh)).toBe("小明付 · 2 人均分");
  });

  test("a split-payer draft counts payers instead of naming one", () => {
    expect(buildSplitSummary({ ...base, payerCount: 3 }, zh)).toBe("3 人付 · 4 人均分");
    expect(buildSplitSummary({ ...base, payerCount: 3 }, en)).toBe("3 payers · split 4 ways");
  });

  test("a custom split says so rather than claiming an even one", () => {
    expect(buildSplitSummary({ ...base, splitMode: "amount" }, zh)).toBe("小明付 · 自訂金額");
    expect(buildSplitSummary({ ...base, splitMode: "percent" }, zh)).toBe("小明付 · 自訂比例");
    expect(buildSplitSummary({ ...base, splitMode: "percent" }, en)).toBe("小明 paid · custom percentages");
  });

  test("income names the collector, because payerId means something else there", () => {
    expect(buildSplitSummary({ ...base, mode: "income" }, zh)).toBe("小明收 · 4 人均分");
    expect(buildSplitSummary({ ...base, mode: "income", payerName: "Alex" }, en)).toBe(
      "Alex collected · split 4 ways",
    );
  });

  test("nobody selected is called out, not shown as '0 人均分'", () => {
    expect(buildSplitSummary({ ...base, shareCount: 0 }, zh)).toBe("小明付 · 還沒選分帳對象");
    // Even in a custom-split draft: an empty share list is the thing to say.
    expect(buildSplitSummary({ ...base, shareCount: 0, splitMode: "amount" }, zh)).toBe(
      "小明付 · 還沒選分帳對象",
    );
  });
});
