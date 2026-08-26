import type { SpendPeriodKind } from "./apiClient";

export type BudgetProgress = {
  budgetMinor: number;
  spentMinor: number;
  /** Share of the budget used. Not capped — going over is the thing worth seeing. */
  pct: number;
  /** Positive while there is budget left, negative once it is exceeded. */
  remainingMinor: number;
  over: boolean;
};

/**
 * Progress against 每月預算.
 *
 * Null in three cases, each deliberate:
 *
 *   * no budget set — the overwhelmingly common one, and the panel should show
 *     nothing rather than an empty gauge inviting a number nobody wants to give
 *   * the bucketing is not 月 — a MONTHLY budget against a year's spend is a
 *     meaningless ratio, and rendering it anyway would just be arithmetic
 *   * 個人 scope — the budget belongs to the group, so measuring one member's
 *     share against it would say a household of four is at 25% when it is at
 *     100%
 *
 * The percentage is not clamped: 140% is exactly what somebody needs to see.
 */
export function budgetProgress({
  budgetMinor,
  spentMinor,
  periodKind,
  scope,
}: {
  budgetMinor: number | null | undefined;
  spentMinor: number;
  periodKind: SpendPeriodKind;
  scope: "personal" | "group";
}): BudgetProgress | null {
  if (!budgetMinor || budgetMinor <= 0) return null;
  if (periodKind !== "month") return null;
  if (scope !== "group") return null;

  return {
    budgetMinor,
    spentMinor,
    pct: Math.round((spentMinor / budgetMinor) * 100),
    remainingMinor: budgetMinor - spentMinor,
    over: spentMinor > budgetMinor,
  };
}
