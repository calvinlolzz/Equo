import { HandCoins, ReceiptText, Scan } from "lucide-react";
import type { ReactNode } from "react";
import { BudgetBar } from "./BudgetBar";
import { CategoryDonut } from "./CategoryDonut";
import { GroupHomeSkeleton } from "./GroupHomeSkeleton";
import { HomeDisclosure } from "./GroupHome";
import { InstallHint } from "./InstallHint";
import { formatAmount, formatSigned } from "./formatAmount";
import { formatRecordStamp } from "./appDates";
import { currentMonthKey, summarizeLedgerMonth } from "./personalLedger";
import { budgetProgress } from "./spendBudget";
import { UI_TEXT } from "./uiText";
import type { DialogMode, Expense, Group } from "./appTypes";
import type { useInstallPrompt } from "./useInstallPrompt";

const text = UI_TEXT.app;
const ledgerText = UI_TEXT.personalLedger;

export type PersonalLedgerHomeProps = {
  isMobileLayout: boolean;
  /** The active group (the caller's own ledger). Callers must only render this once resolved. */
  group: Group;
  /** The translated label ("我的帳本") - see personalLedger.ts's groupDisplayName. Never group.name, which is the raw stored value. */
  displayName: string;
  install: ReturnType<typeof useInstallPrompt>;
  /** = cloudActiveLoading && !cloudActiveDetail, mirrors GroupHome's own prop. */
  showSkeleton: boolean;
  /** = Boolean(cloudActiveDetail) - gates the empty state, same reasoning as GroupHome's own prop. */
  hasLoadedDetail: boolean;
  /** The desktop ▾ menu, or undefined on mobile (see GroupHome's own doc on this). */
  headerMenu?: ReactNode;
  expenses: Expense[];
  /** The ledger's true expense count (aggregates.expenseCount) - expenses may be a capped window. */
  expenseCount: number;
  /** 每月預算 in the ledger's currency, or null/undefined when nobody set one. */
  monthlyBudgetMinor?: number | null;
  /** Whether the loaded `expenses` window is enough to trust this month's totals - see ledgerMonthCoverage. */
  coverage: "complete" | "partial";
  onOpenDialog: (mode: DialogMode) => void;
  onScanReceipt: () => void;
  onOpenExpenseComposer: () => void;
  onOpenExpenseDetail: (expenseId: string) => void;
  onCreateGroup: () => void;
  onJoinGroup: () => void;
};

/**
 * The personal ledger's home screen: a sibling of GroupHome, not a branch of
 * it - GroupHome's body is almost entirely members/balances/settle/nudge
 * (see its own doc comment), none of which a one-member ledger has any use
 * for. Only HomeDisclosure is worth sharing (imported from GroupHome).
 */
export function PersonalLedgerHome({
  isMobileLayout,
  group,
  displayName,
  install,
  showSkeleton,
  hasLoadedDetail,
  headerMenu,
  expenses,
  expenseCount,
  monthlyBudgetMinor,
  coverage,
  onOpenDialog,
  onScanReceipt,
  onOpenExpenseComposer,
  onOpenExpenseDetail,
  onCreateGroup,
  onJoinGroup,
}: PersonalLedgerHomeProps) {
  const monthKey = currentMonthKey();
  const summary = summarizeLedgerMonth(expenses, monthKey, group.currency);
  const budget = budgetProgress({
    budgetMinor: monthlyBudgetMinor,
    spentMinor: summary.expenseMinor,
    periodKind: "month",
    scope: "group",
  });

  const empty = hasLoadedDetail && expenses.length === 0;

  return (
    <section className="group-room pizo-home enter-content" aria-label={text.groupHome}>
      {isMobileLayout ? <h1 className="visually-hidden">{displayName}</h1> : null}
      {isMobileLayout ? (
        <InstallHint state={install.state} onInstall={install.promptInstall} onDismiss={install.dismiss} />
      ) : null}
      {showSkeleton ? <GroupHomeSkeleton /> : null}
      <article className="group-home-card glass-panel" id="group-home">
        <div className="home-title-row">
          <div>
            {isMobileLayout ? null : headerMenu ?? <h2>{displayName}</h2>}
          </div>
        </div>

        {empty ? (
          <div className="home-empty-actions">
            <p className="ledger-empty-title">{ledgerText.emptyTitle}</p>
            <p className="empty-copy">{ledgerText.emptyBody}</p>
            <button className="primary-action" type="button" onClick={onOpenExpenseComposer}>
              {text.addExpense}
            </button>
            {/* The ledger being the new landing screen means create/join is no
                longer reachable through StartFlow for a brand-new user - kept
                discoverable here instead. */}
            <button className="secondary-action" type="button" onClick={onCreateGroup}>
              {text.createGroup}
            </button>
            <button className="secondary-action" type="button" onClick={onJoinGroup}>
              {text.joinGroup}
            </button>
          </div>
        ) : (
          <>
            <div className="ledger-month-card">
              <span className="home-balance-lead">{ledgerText.monthExpense}</span>
              <strong className="home-balance-amount">{formatAmount(summary.expenseMinor, group.currency)}</strong>
              <div className="ledger-month-stats">
                <span>
                  {ledgerText.monthIncome}
                  <strong className="amount-income">{formatAmount(summary.incomeMinor, group.currency)}</strong>
                </span>
                <span>
                  {ledgerText.monthNet}
                  <strong>{formatSigned(summary.netMinor, group.currency)}</strong>
                </span>
              </div>
              {coverage === "partial" ? <small className="ledger-month-loading">{ledgerText.monthLoading}</small> : null}
            </div>

            {budget ? <BudgetBar budget={budget} currency={group.currency} /> : null}

            {summary.expenseMinor > 0 ? (
              <div className="dialog-section-list">
                <span className="dialog-list-title">{ledgerText.categoryTitle}</span>
                <CategoryDonut entries={summary.byCategory} currency={group.currency} />
              </div>
            ) : null}
          </>
        )}
      </article>

      {empty ? null : (
        <HomeDisclosure
          key={`records-${group.id}`}
          id="group-records"
          label={text.records}
          summary={
            expenses.length
              ? `${UI_TEXT.records.count} ${expenseCount} · ${expenses[0].kind === "income" ? "+" : ""}${formatAmount(expenses[0].amountMinor, expenses[0].currency)}`
              : text.noRecords
          }
          headExtra={
            <>
              <button className="text-action" type="button" onClick={() => onOpenDialog("recordsPanel")}>
                {text.viewAll}
              </button>
              <button className="icon-action" type="button" aria-label={text.scanReceipt} onClick={onScanReceipt}>
                <Scan aria-hidden="true" size={18} />
              </button>
            </>
          }
        >
          {expenses.length ? (
            <div className="expense-record-list">
              {expenses.slice(0, 5).map((expense) => {
                const isIncome = expense.kind === "income";
                return (
                  <button
                    className="expense-record-row pizo-expense-row"
                    type="button"
                    key={expense.id}
                    onClick={() => onOpenExpenseDetail(expense.id)}
                  >
                    <span className={isIncome ? "member-avatar photo income-avatar" : "member-avatar photo"}>
                      {isIncome ? <HandCoins aria-hidden="true" size={16} /> : <ReceiptText aria-hidden="true" size={16} />}
                    </span>
                    <span className="expense-record-main">
                      <strong>{expense.title}</strong>
                      <small>{formatRecordStamp(expense.createdAt)}</small>
                    </span>
                    <span className={isIncome ? "expense-record-amount amount-income" : "expense-record-amount"}>
                      {expense.currency === group.currency ? null : <small>{expense.currency}</small>}
                      {isIncome ? `+${formatAmount(expense.amountMinor, expense.currency)}` : formatAmount(expense.amountMinor, expense.currency)}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="empty-copy">{text.noRecords}</p>
          )}
        </HomeDisclosure>
      )}
    </section>
  );
}
