import { describe, expect, test } from "vitest";
import { COMPOSER_MODES, getComposerSubmitState } from "./expenseComposer";

describe("COMPOSER_MODES", () => {
  test("keeps the Pizo-like composer modes in the expected order", () => {
    expect(COMPOSER_MODES.map((mode) => mode.label)).toEqual(["支出", "收入", "轉帳"]);
  });
});

describe("getComposerSubmitState", () => {
  test("allows expense submission only when the draft is valid", () => {
    expect(getComposerSubmitState({ mode: "expense", canSubmitExpense: true })).toEqual({
      disabled: false,
      label: "新增支出",
      hint: "填寫金額並選擇分攤成員。",
    });
    expect(getComposerSubmitState({ mode: "expense", canSubmitExpense: false }).disabled).toBe(true);
  });

  test("keeps income and transfer modes as non-submitting MVP previews", () => {
    expect(getComposerSubmitState({ mode: "income", canSubmitExpense: true })).toEqual({
      disabled: true,
      label: "收入模式尚未開放",
      hint: "MVP 先聚焦支出分攤，收入與轉帳會在後續版本補上。",
    });
    expect(getComposerSubmitState({ mode: "transfer", canSubmitExpense: true })).toEqual({
      disabled: true,
      label: "轉帳模式尚未開放",
      hint: "MVP 先聚焦支出分攤，收入與轉帳會在後續版本補上。",
    });
  });
});
