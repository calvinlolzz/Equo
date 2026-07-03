import { describe, expect, test } from "vitest";
import { UI_TEXT } from "./uiText";

describe("UI_TEXT", () => {
  test("provides the main App copy from the shared text source", () => {
    expect(UI_TEXT.app).toMatchObject({
      createGroup: "建立群組",
      groupHome: "群組首頁",
      records: "支出記錄",
      addExpense: "新增支出",
      archivedGroups: "已封存的群組",
    });
  });
});
