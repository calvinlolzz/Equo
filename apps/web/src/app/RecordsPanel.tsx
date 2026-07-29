import { useMemo, useState } from "react";
import { HandCoins, History, ReceiptText, Search, SlidersHorizontal, X } from "lucide-react";
import { formatActivityTime, formatDayLabel } from "./appDates";
import type { Activity, Expense, Member } from "./appTypes";
import {
  EMPTY_EXPENSE_FILTER,
  filterExpenses,
  isExpenseFilterActive,
  summariseFilteredExpenses,
  type ExpenseFilter,
  type ExpenseKindFilter,
} from "./expenseFilter";
import { groupExpensesByDay } from "./expenseDayGroups";
import { formatAmount } from "./formatAmount";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

const KIND_OPTIONS: Array<{ value: ExpenseKindFilter; label: string }> = [
  { value: "", label: "全部" },
  { value: "expense", label: "支出" },
  { value: "income", label: "收入" },
  { value: "settlement", label: "結算" },
];

type RecordsPanelProps = {
  expenseCount: number;
  totalExpenseMinor: number;
  currency: string;
  expenses: Expense[];
  members: Member[];
  activities: Activity[];
  canLoadMoreExpenses: boolean;
  loadingMoreExpenses: boolean;
  pendingAction: string | null;
  /** Expense ids still waiting to reach the server - see offlineQueue.ts. */
  pendingWriteIds: Set<string>;
  onLoadMore: () => void;
  onExportCsv: () => void;
  onOpenExpense: (expenseId: string) => void;
};

/** The 支出記錄 bottom-sheet content (stats, search/filter, CSV export, expense rows, recent activity). */
export function RecordsPanel({
  expenseCount,
  totalExpenseMinor,
  currency,
  expenses,
  members,
  activities,
  canLoadMoreExpenses,
  loadingMoreExpenses,
  pendingAction,
  pendingWriteIds,
  onLoadMore,
  onExportCsv,
  onOpenExpense,
}: RecordsPanelProps) {
  const [filter, setFilter] = useState<ExpenseFilter>(EMPTY_EXPENSE_FILTER);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const filterActive = isExpenseFilterActive(filter);
  const visibleExpenses = useMemo(() => filterExpenses(expenses, filter), [expenses, filter]);
  const summary = useMemo(() => summariseFilteredExpenses(visibleExpenses), [visibleExpenses]);

  // Only offer categories that actually occur in the loaded window - a select
  // listing six categories for a group that only ever uses 餐飲 is noise.
  const categories = useMemo(() => {
    const seen = new Set<string>();
    expenses.forEach((expense) => {
      if (expense.category) seen.add(expense.category);
    });
    return [...seen];
  }, [expenses]);

  const patchFilter = (patch: Partial<ExpenseFilter>) => setFilter((current) => ({ ...current, ...patch }));

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

      <div className="records-filter">
        <div className="records-search">
          <Search aria-hidden="true" size={16} />
          <input
            type="search"
            value={filter.query}
            placeholder={"搜尋品項、備註或金額"}
            aria-label={"搜尋支出"}
            onChange={(event) => patchFilter({ query: event.target.value })}
          />
          {filter.query ? (
            <button type="button" className="records-search__clear" aria-label={"清除搜尋"} onClick={() => patchFilter({ query: "" })}>
              <X aria-hidden="true" size={14} />
            </button>
          ) : null}
          <button
            type="button"
            className={advancedOpen ? "records-filter__toggle is-open" : "records-filter__toggle"}
            aria-expanded={advancedOpen}
            aria-label={"更多篩選"}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            <SlidersHorizontal aria-hidden="true" size={16} />
          </button>
        </div>

        <div className="records-chip-row" role="group" aria-label={"類型篩選"}>
          {KIND_OPTIONS.map((option) => (
            <button
              key={option.value || "all"}
              type="button"
              className={filter.kind === option.value ? "records-chip is-active" : "records-chip"}
              aria-pressed={filter.kind === option.value}
              onClick={() => patchFilter({ kind: option.value })}
            >
              {option.label}
            </button>
          ))}
        </div>

        {advancedOpen ? (
          <div className="records-filter__advanced">
            <label>
              <span>{"成員"}</span>
              <select value={filter.memberId} onChange={(event) => patchFilter({ memberId: event.target.value })}>
                <option value="">{"所有成員"}</option>
                {members.map((member) => (
                  <option key={member.id} value={member.id}>
                    {member.name}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{"分類"}</span>
              <select value={filter.category} onChange={(event) => patchFilter({ category: event.target.value })}>
                <option value="">{"所有分類"}</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {(UI_TEXT.categories as Record<string, string>)[category] ?? category}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{"起始日"}</span>
              <input type="date" value={filter.from} max={filter.to || undefined} onChange={(event) => patchFilter({ from: event.target.value })} />
            </label>
            <label>
              <span>{"結束日"}</span>
              <input type="date" value={filter.to} min={filter.from || undefined} onChange={(event) => patchFilter({ to: event.target.value })} />
            </label>
          </div>
        ) : null}

        {filterActive ? (
          <div className="records-filter__summary" role="status" aria-live="polite">
            <span>
              {`符合 ${summary.count} 筆・${formatAmount(summary.totalMinor, currency)}`}
              {canLoadMoreExpenses ? <small>{"（僅搜尋已載入的紀錄）"}</small> : null}
            </span>
            <button type="button" className="text-action" onClick={() => setFilter(EMPTY_EXPENSE_FILTER)}>
              {"清除篩選"}
            </button>
          </div>
        ) : null}
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
        {visibleExpenses.length ? (
          <>
            {groupExpensesByDay(visibleExpenses).map((group) => (
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
                      <strong>
                        {expense.title}
                        {pendingWriteIds.has(expense.id) ? (
                          <em className="record-pending-badge">{text.offlinePendingBadge}</em>
                        ) : null}
                      </strong>
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
          <>
            <p className="dialog-empty">{filterActive ? "沒有符合的紀錄" : text.noRecords}</p>
            {/* A filtered-to-nothing window may still have matches further back. */}
            {filterActive && canLoadMoreExpenses ? (
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
