import { describe, expect, test } from "vitest";
import { getRecommendedWorkspaceStep } from "./workspaceFlow";

describe("getRecommendedWorkspaceStep", () => {
  test("guides a group toward invite, expense, then settlement", () => {
    expect(getRecommendedWorkspaceStep({ memberCount: 1, expenseCount: 0 })).toBe("invite");
    expect(getRecommendedWorkspaceStep({ memberCount: 2, expenseCount: 0 })).toBe("expense");
    expect(getRecommendedWorkspaceStep({ memberCount: 2, expenseCount: 1 })).toBe("settle");
  });
});
