import { describe, expect, test } from "vitest";
import { resolveActiveTab } from "./resolveActiveTab";

describe("resolveActiveTab", () => {
  test("the panel tabs select themselves", () => {
    expect(resolveActiveTab("recordsPanel")).toBe("records");
    expect(resolveActiveTab("analysisPanel")).toBe("analysis");
  });

  test("the settings drawer is the fifth tab", () => {
    expect(resolveActiveTab(null, true)).toBe("settings");
  });

  test("the member list keeps 設定 selected, because that is where it is reached from", () => {
    // The drawer closes on the way there, so without this the bar would snap
    // back to 首頁 the moment you arrived.
    expect(resolveActiveTab("memberList")).toBe("settings");
  });

  test("nothing open means home", () => {
    expect(resolveActiveTab(null)).toBe("home");
    expect(resolveActiveTab(null, false)).toBe("home");
  });

  test.each(["profile", "createGroup", "expenseDetail", "inviteMembers", "archive"] as const)(
    "a non-tab dialog (%s) leaves home selected — it opens over the home screen",
    (dialog) => {
      expect(resolveActiveTab(dialog)).toBe("home");
    },
  );
});
