import { HandCoins, History, ReceiptText } from "lucide-react";
import { formatActivityTime, formatDayLabel } from "./appDates";
import type { Activity, Expense } from "./appTypes";
import { groupExpensesByDay } from "./expenseDayGroups";
import { formatAmount } from "./formatAmount";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

type RecordsPanelProps = {
  expenseCount: number;
  totalExpenseMinor: number;
  currency: string;
  expenses: Expense[];
  activities: Activity[];
  canLoadMoreExpenses: boolean;
  loadingMoreExpenses: boolean;
  pendingAction: string | null;
  onLoadMore: () => void;
  onExportCsv: () => void;
  onOpenExpense: (expenseId: string) => void;
};

/** The 支出記錄 bottom-sheet content (stats, CSV export, expense rows, recent activity). */
export function RecordsPanel({
  expenseCount,
  totalExpenseMinor,
  currency,
  expenses,
  activities,
  canLoadMoreExpenses,
  loadingMoreExpenses,
  pendingAction,
  onLoadMore,
  onExportCsv,
  onOpenExpense,
}: RecordsPanelProps) {
  return (
    <>
      <div className="dialog-header">
        <h3>{text.records}</h3>
        <p>{"查看群組的支出與近期活動。"}</p>
      </div>
      <div className="panel-stat-grid">
        <div>
          <span>{"筆數"}</span>
          <strong>{expenseCount}</strong>
        </div>
        <div>
          <span>{"總支出"}</span>
          <strong>{formatAmount(totalExpenseMinor, currency)}</strong>
        </div>
      </div>
      <button
        className="text-action records-export"
        type="button"
        disabled={pendingAction === "exportCsv"}
        onClick={onExportCsv}
      >
        {pendingAction === "exportCsv" ? text.processing : text.exportCsv}
      </button>
      <div className="dialog-section-list">
        <span className="dialog-list-title">{text.expense}</span>
        {expenses.length ? (
          <>
            {groupExpensesByDay(expenses).map((group) => (
              <div className="record-day-group" key={group.key}>
                <div className="record-day-header">
                  <span>{formatDayLabel(group.expenses[0].createdAt)}</span>
                  <b>{formatAmount(group.subtotalMinor, currency)}</b>
                </div>
                {group.expenses.map((expense) => (
                  <button className="record-dialog-row" type="button" key={expense.id} onClick={() => onOpenExpense(expense.id)}>
                    {expense.imageUrl ? (
                      <span className="record-dialog-thumb">
                        <img src={expense.imageUrl} alt="" loading="lazy" decoding="async" />
                      </span>
                    ) : (
                      <span className="record-dialog-icon">
                        {expense.kind === "settlement" ? (
                          <History aria-hidden="true" size={18} />
                        ) : expense.kind === "income" ? (
                          <HandCoins aria-hidden="true" size={18} />
                        ) : (
                          <ReceiptText aria-hidden="true" size={18} />
                        )}
                      </span>
                    )}
                    <span>
                      <strong>{expense.title}</strong>
                      <small>{expense.note ? expense.note : formatActivityTime(expense.createdAt)}</small>
                    </span>
                    <b className={expense.kind === "income" ? "amount-income" : undefined}>
                      {expense.kind === "income"
                        ? `+${formatAmount(expense.amountMinor, expense.currency)}`
                        : formatAmount(expense.amountMinor, expense.currency)}
                    </b>
                  </button>
                ))}
              </div>
            ))}
            {canLoadMoreExpenses ? (
              <button
                className="text-action records-load-more"
                type="button"
                disabled={pendingAction === "loadMoreExpenses" || loadingMoreExpenses}
                onClick={onLoadMore}
              >
                {pendingAction === "loadMoreExpenses" || loadingMoreExpenses ? text.processing : text.loadMoreRecords}
              </button>
            ) : null}
          </>
        ) : (
          <p className="dialog-empty">{text.noRecords}</p>
        )}
      </div>
      <div className="dialog-section-list">
        <span className="dialog-list-title">{text.recentActivity}</span>
        {activities.length ? (
          activities.map((activity) => (
            <div className="record-dialog-row" key={activity.id}>
              <span className="record-dialog-icon">
                <History aria-hidden="true" size={18} />
              </span>
              <span>
                <strong>{activity.text}</strong>
                <small>{formatActivityTime(activity.createdAt)}</small>
              </span>
              <b />
            </div>
          ))
        ) : (
          <p className="dialog-empty">{text.noActivity}</p>
        )}
      </div>
    </>
  );
}
