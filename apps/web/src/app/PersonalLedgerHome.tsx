import { HandCoins, ReceiptText } from "lucide-react";
import type { ReactNode } from "react";
import { BudgetBar } from "./BudgetBar";
import { CategoryDonut } from "./CategoryDonut";
import { GroupHomeSkeleton } from "./GroupHomeSkeleton";
import { HOME_RECORD_LIMIT, HomeRecordsSection } from "./GroupHome";
import { InstallHint } from "./InstallHint";
import { LineLedgerHint } from "./LineLedgerHint";
import { formatAmount, formatSigned } from "./formatAmount";
import { formatRecordStamp } from "./appDates";
import { currentMonthKey, summarizeLedgerMonth } from "./personalLedger";
import { budgetProgress } from "./spendBudget";
import { UI_TEXT } from "./uiText";
import type { DialogMode, Expense, Group } from "./appTypes";
import type { useInstallPrompt } from "./useInstallPrompt";

const text = UI_TEXT.app;
const ledgerText = UI_TEXT.personalLedger;
const lineText = UI_TEXT.lineLink;

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
  /** Admin read-only view-as; the LINE hint neither fetches nor shows. */
  viewingAs: boolean;
  onOpenDialog: (mode: DialogMode) => void;
  onScanReceipt: () => void;
  onOpenExpenseComposer: () => void;
  /** Takes the whole Expense - see GroupHome's own doc on this prop. */
  onOpenExpenseDetail: (expense: Expense) => void;
  onCreateGroup: () => void;
  onJoinGroup: () => void;
};

/**
 * The personal ledger's home screen: a sibling of GroupHome, not a branch of
 * it - GroupHome's body is almost entirely members/balances/settle/nudge
 * (see its own doc comment), none of which a one-member ledger has any use
 * for. Only HomeRecordsSection is worth sharing (imported from GroupHome).
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
  viewingAs,
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

  // One suggestion at a time: on a phone the install hint has the floor.
  const lineHint = (
    <LineLedgerHint
      enabled={hasLoadedDetail && !viewingAs && !(isMobileLayout && install.state !== "unavailable")}
      showQr={!isMobileLayout}
    />
  );

  return (
    <section className="group-room pizo-home enter-content" aria-label={ledgerText.homeLabel}>
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
          <>
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
          {lineHint}
          </>
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

            {lineHint}

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
        <HomeRecordsSection
          label={text.records}
          count={expenses.length ? UI_TEXT.records.entryCount.replace("{n}", String(expenseCount)) : null}
          onViewAll={() => onOpenDialog("recordsPanel")}
          onScanReceipt={onScanReceipt}
        >
          {expenses.length ? (
            <div className="expense-record-list">
              {expenses.slice(0, HOME_RECORD_LIMIT).map((expense) => {
                const isIncome = expense.kind === "income";
                return (
                  <button
                    className="expense-record-row pizo-expense-row"
                    type="button"
                    key={expense.id}
                    onClick={() => onOpenExpenseDetail(expense)}
                  >
                    <span className={isIncome ? "member-avatar photo income-avatar" : "member-avatar photo"}>
                      {isIncome ? <HandCoins aria-hidden="true" size={16} /> : <ReceiptText aria-hidden="true" size={16} />}
                    </span>
                    <span className="expense-record-main">
                      <strong>{expense.title}</strong>
                      <small>
                        {formatRecordStamp(expense.createdAt)}
                        {expense.source === "line" ? (
                          <em className="record-line-badge" title={lineText.recordBadgeTitle}>
                            {lineText.recordBadge}
                          </em>
                        ) : null}
                      </small>
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
        </HomeRecordsSection>
      )}
    </section>
  );
}
