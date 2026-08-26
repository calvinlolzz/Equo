import { describe, expect, test } from "vitest";
import { budgetProgress } from "./spendBudget";

const base = { budgetMinor: 1_000_000, spentMinor: 400_000, periodKind: "month" as const, scope: "group" as const };

describe("budgetProgress", () => {
  test("reports the share used and what is left", () => {
    expect(budgetProgress(base)).toMatchObject({ pct: 40, remainingMinor: 600_000, over: false });
  });

  test("does not clamp at 100, because going over is the point", () => {
    expect(budgetProgress({ ...base, spentMinor: 1_400_000 })).toMatchObject({
      pct: 140,
      remainingMinor: -400_000,
      over: true,
    });
  });

  test("exactly on budget is not over", () => {
    expect(budgetProgress({ ...base, spentMinor: 1_000_000 })).toMatchObject({ pct: 100, over: false });
  });

  test("no budget set shows nothing rather than an empty gauge", () => {
    expect(budgetProgress({ ...base, budgetMinor: null })).toBeNull();
    expect(budgetProgress({ ...base, budgetMinor: undefined })).toBeNull();
    expect(budgetProgress({ ...base, budgetMinor: 0 })).toBeNull();
  });

  test("a monthly budget is not measured against a year", () => {
    expect(budgetProgress({ ...base, periodKind: "year" })).toBeNull();
  });

  test("the budget belongs to the group, not to one member", () => {
    // A household of four would otherwise read as 25% used when the group is
    // at 100%.
    expect(budgetProgress({ ...base, scope: "personal" })).toBeNull();
  });
});
