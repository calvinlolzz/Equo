import type { SpendBreakdown, SpendPeriodKind } from "./apiClient";
import { BudgetBar } from "./BudgetBar";
import { CategoryDonut } from "./CategoryDonut";
import { formatAmount } from "./formatAmount";
import { budgetProgress } from "./spendBudget";
import { describeSpendComparison, spendComparison } from "./spendComparison";
import { formatPeriodChipLabel, formatPeriodTitle } from "./spendPeriods";
import { useDragScrollX } from "./useDragScrollX";
import { UI_TEXT } from "./uiText";

type Props = {
  breakdown: SpendBreakdown | null;
  periodKind: SpendPeriodKind;
  periodKey: string | null;
  /** Which figure the 個人／群組 tabs are showing. */
  scope: "personal" | "group";
  loading: boolean;
  error: string | null;
  /** Fallback while the first request is still in flight. */
  currency: string;
  /** 每月預算 in the group's currency, or null when nobody set one. */
  monthlyBudgetMinor?: number | null;
  /** A one-line caveat shown under the period total - currently only the personal ledger's "not including group shares" note. */
  note?: string;
  onSelectKind: (kind: SpendPeriodKind) => void;
  onSelectKey: (key: string) => void;
  onRetry: () => void;
};

/**
 * 時間搜索區段: the bucketing dropdown, the period chips, and that period's
 * total + per-category split.
 *
 * Both the group figure and the caller's own share arrive in one payload, so
 * the 個人／群組 tabs re-render from data already in hand - only a different
 * period costs a request. That is why `scope` is a prop here rather than
 * another piece of fetch state.
 */
export function SpendPeriodSection({
  breakdown,
  periodKind,
  periodKey,
  scope,
  loading,
  error,
  currency,
  monthlyBudgetMinor,
  note,
  onSelectKind,
  onSelectKey,
  onRetry,
}: Props) {
  const chipRowRef = useDragScrollX(periodKey ?? undefined);
  const personal = scope === "personal";
  const periods = breakdown?.periods ?? [];
  const totalMinor = breakdown ? (personal ? breakdown.personal_total_minor : breakdown.group_total_minor) : 0;
  const activeCurrency = breakdown?.currency ?? currency;
  const comparison = spendComparison(breakdown, scope);
  const budget = budgetProgress({
    budgetMinor: monthlyBudgetMinor,
    spentMinor: totalMinor,
    periodKind,
    scope,
  });

  // In 個人 mode a category the user had no share of is not "0 spent", it is
  // simply not theirs - listing it would pad the breakdown with empty rows.
  const rows = (breakdown?.by_category ?? [])
    .map((entry) => ({
      category: entry.category,
      totalMinor: personal ? entry.personal_total_minor : entry.group_total_minor,
    }))
    .filter((entry) => entry.totalMinor > 0)
    .sort((a, b) => b.totalMinor - a.totalMinor);

  return (
    <>
      <div className="spend-period-card">
        <div className="spend-period-head">
          <label className="spend-period-select">
            <span className="visually-hidden">{UI_TEXT.spend.periodLabel}</span>
            <select
              value={periodKind}
              onChange={(event) => onSelectKind(event.target.value as SpendPeriodKind)}
            >
              <option value="year">{UI_TEXT.spend.perYear}</option>
              <option value="month">{UI_TEXT.spend.perMonth}</option>
            </select>
          </label>
          {loading ? <span className="spend-period-loading">{UI_TEXT.spend.loading}</span> : null}
        </div>

        {error ? (
          <div className="spend-period-error">
            <p>{error}</p>
            <button className="composer-mini-action" type="button" onClick={onRetry}>
              {UI_TEXT.spend.retry}
            </button>
          </div>
        ) : (
          <>
            <div className="period-chip-row" role="tablist" aria-label={UI_TEXT.spend.periodLabel} ref={chipRowRef}>
              {periods.map((period) => (
                <button
                  key={period.key}
                  className={period.key === periodKey ? "period-chip active" : "period-chip"}
                  type="button"
                  role="tab"
                  aria-selected={period.key === periodKey}
                  data-active={period.key === periodKey}
                  onClick={() => onSelectKey(period.key)}
                >
                  {formatPeriodChipLabel(periodKind, period.key)}
                </button>
              ))}
            </div>

            <div className="spend-period-total">
              <span>{formatPeriodTitle(periodKind, periodKey)}</span>
              <strong>{formatAmount(totalMinor, activeCurrency)}</strong>
              {/* Only on the newest period, and only when there is a real
                  previous one to compare against — see spendComparison. */}
              {comparison ? (
                <small
                  className={
                    comparison.changePct > 0
                      ? "spend-period-change spend-period-change--up"
                      : "spend-period-change"
                  }
                >
                  {describeSpendComparison(comparison, periodKind)}
                </small>
              ) : null}
              {note ? <small className="spend-period-note">{note}</small> : null}
            </div>

            {budget ? <BudgetBar budget={budget} currency={activeCurrency} /> : null}
          </>
        )}
      </div>

      {!error && rows.length > 0 ? (
        <div className="dialog-section-list">
          <span className="dialog-list-title">{UI_TEXT.spend.categoryShare}</span>
          <CategoryDonut entries={rows} currency={activeCurrency} />
        </div>
      ) : null}

      {!error && !loading && rows.length === 0 ? (
        <p className="dialog-empty">{personal ? UI_TEXT.spend.emptyPersonal : UI_TEXT.spend.emptyGroup}</p>
      ) : null}
    </>
  );
}
