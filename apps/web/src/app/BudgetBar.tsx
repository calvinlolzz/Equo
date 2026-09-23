import { formatAmount } from "./formatAmount";
import type { BudgetProgress } from "./spendBudget";
import { UI_TEXT } from "./uiText";

/**
 * 每月預算 progress: the label line, the capped bar, and the pct/budget
 * caption underneath.
 *
 * Extracted verbatim from SpendPeriodSection (its only caller until the
 * personal ledger home screen needed the same bar without the rest of that
 * section's period-chip/category machinery) - see spendBudget.ts's
 * budgetProgress for how the non-null `budget` this takes is computed.
 */
export function BudgetBar({ budget, currency }: { budget: BudgetProgress; currency: string }) {
  return (
    <div className={budget.over ? "spend-budget spend-budget--over" : "spend-budget"}>
      <div className="spend-budget-line">
        <span>{UI_TEXT.spend.budgetLabel}</span>
        <span>
          {budget.over
            ? `${UI_TEXT.spend.budgetOver} ${formatAmount(Math.abs(budget.remainingMinor), currency)}`
            : `${UI_TEXT.spend.budgetLeft} ${formatAmount(budget.remainingMinor, currency)}`}
        </span>
      </div>
      <div
        className="spend-budget-bar"
        role="progressbar"
        aria-label={UI_TEXT.spend.budgetProgress}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.min(budget.pct, 100)}
      >
        {/* The BAR caps at 100% because a wider-than-its-track fill is just
            a broken layout; the number beside it does not, because 140% is
            the thing worth seeing. */}
        <span style={{ width: `${Math.min(budget.pct, 100)}%` }} />
      </div>
      <small>
        {UI_TEXT.spend.budgetUsage
          .replace("{pct}", String(budget.pct))
          .replace("{amount}", formatAmount(budget.budgetMinor, currency))}
      </small>
    </div>
  );
}
