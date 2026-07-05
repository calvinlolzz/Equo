import { describe, expect, test } from "vitest";
import { COMPOSER_MODES, getComposerSubmitState } from "./expenseComposer";

describe("COMPOSER_MODES", () => {
  test("keeps the Pizo-like composer modes in the expected order", () => {
    expect(COMPOSER_MODES.map((mode) => mode.label)).toEqual(["支出", "收入", "轉帳"]);
  });
});

describe("getComposerSubmitState", () => {
  test("allows expense submission only when the draft is valid", () => {
    expect(getComposerSubmitState({ mode: "expense", canSubmit: true })).toEqual({
      disabled: false,
      label: "新增支出",
      hint: "填寫金額並選擇分攤成員。",
    });
    expect(getComposerSubmitState({ mode: "expense", canSubmit: false }).disabled).toBe(true);
  });

  test("income and transfer modes are live with their own labels and hints", () => {
    expect(getComposerSubmitState({ mode: "income", canSubmit: true })).toEqual({
      disabled: false,
      label: "新增收入",
      hint: "填寫金額，選擇收款人與分配對象。",
    });
    expect(getComposerSubmitState({ mode: "transfer", canSubmit: true })).toEqual({
      disabled: false,
      label: "新增轉帳",
      hint: "填寫金額，選擇轉出與轉入成員。",
    });
    expect(getComposerSubmitState({ mode: "income", canSubmit: false }).disabled).toBe(true);
    expect(getComposerSubmitState({ mode: "transfer", canSubmit: false }).disabled).toBe(true);
  });

  test("editing keeps the 儲存變更 label for every mode", () => {
    expect(getComposerSubmitState({ mode: "expense", canSubmit: true, isEditing: true }).label).toBe("儲存變更");
    expect(getComposerSubmitState({ mode: "income", canSubmit: true, isEditing: true }).label).toBe("儲存變更");
    expect(getComposerSubmitState({ mode: "transfer", canSubmit: true, isEditing: true }).label).toBe("儲存變更");
  });
});
