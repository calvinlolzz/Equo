import { describe, expect, test } from "vitest";
import { GROUP_SIDE_NAV_ITEMS } from "./groupNavigation";

describe("GROUP_SIDE_NAV_ITEMS", () => {
  test("maps the Pizo-like side navigation to group home sections", () => {
    expect(GROUP_SIDE_NAV_ITEMS.map((item) => item.label)).toEqual(["群組首頁", "幣別", "支出記錄", "分析", "群組成員"]);
    expect(GROUP_SIDE_NAV_ITEMS.map((item) => item.targetId)).toEqual([
      "group-home",
      "group-currency",
      "group-records",
      "group-analysis",
      "group-members",
    ]);
  });
});
