import { describe, expect, test } from "vitest";
import { resolveActiveTab } from "./resolveActiveTab";

describe("resolveActiveTab", () => {
  test("the three panel tabs select themselves", () => {
    expect(resolveActiveTab("recordsPanel")).toBe("records");
    expect(resolveActiveTab("analysisPanel")).toBe("analysis");
    expect(resolveActiveTab("memberList")).toBe("members");
  });

  test("nothing open means home", () => {
    expect(resolveActiveTab(null)).toBe("home");
  });

  test.each(["profile", "createGroup", "expenseDetail", "inviteMembers", "archive"] as const)(
    "a non-tab dialog (%s) leaves home selected — it opens over the home screen",
    (dialog) => {
      expect(resolveActiveTab(dialog)).toBe("home");
    },
  );
});
