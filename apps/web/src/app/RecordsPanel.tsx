import { useEffect, useMemo, useRef, useState } from "react";
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
import { groupExpensesByDay, takeDayGroupsWithin } from "./expenseDayGroups";
import { formatAmount } from "./formatAmount";
import { categoryLabel } from "./catalog";
import { UI_TEXT } from "./uiText";
import { useExpenseSearch } from "./useExpenseSearch";

type Searcher = Parameters<typeof useExpenseSearch>[0]["searchExpenses"];

const text = UI_TEXT.app;

/**
 * How many expense rows to mount at a time. The list keeps growing as the user
 * pulls older pages from the server, and every mounted row is re-reconciled on
 * every auto-sync tick and every search keystroke - on a phone that is what
 * makes a long-open records sheet feel progressively heavier. Rows past the
 * window are mounted lazily as the sentinel below them scrolls into range.
 */
const RENDER_WINDOW_STEP = 40;

/** Mount the next slice this far before it reaches the viewport. */
const RENDER_WINDOW_ROOT_MARGIN = "600px 0px";

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
  /** Server-side search over the whole history; null when offline/signed out. */
  searchExpenses: Searcher | null;
  describeError: (error: unknown) => string;
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
  searchExpenses,
  describeError,
}: RecordsPanelProps) {
  const [filter, setFilter] = useState<ExpenseFilter>(EMPTY_EXPENSE_FILTER);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [rowLimit, setRowLimit] = useState(RENDER_WINDOW_STEP);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const filterActive = isExpenseFilterActive(filter);
  const search = useExpenseSearch({ searchExpenses, filter, enabled: true, describeError });

  // With a filter on, the server answers over the whole history. Without one
  // the in-memory list stays authoritative, which is what keeps optimistic and
  // still-queued offline rows visible the instant they are written.
  //
  // The local fallback while a search is in flight is deliberate: it is the
  // same filter over a subset, so it can only under-report, never invent a
  // row - and the summary line below reads from `search` regardless, so the
  // count on screen is the true one even during that moment.
  // A failed search falls back to filtering what is loaded rather than showing
  // an empty list: a degraded answer beats "no records" when the network is
  // the thing that broke. The empty state below surfaces the error itself.
  const serverResults = filterActive && search.active && !search.pending && search.error === null;
  const visibleExpenses = useMemo(
    () => (serverResults ? search.expenses : filterExpenses(expenses, filter)),
    [serverResults, search.expenses, expenses, filter],
  );
  const localSummary = useMemo(() => summariseFilteredExpenses(visibleExpenses), [visibleExpenses]);
  // Gated on the same `serverResults` as the list: the count and the rows it
  // describes have to change over together, or the line briefly reports 0
  // matches above a list that is visibly showing some.
  const summary = serverResults ? { count: search.matchCount, totalMinor: search.matchTotalMinor } : localSummary;

  // Paging is whichever list is on screen: the search's own cursor, or the
  // group's expense window.
  const canPageMore = serverResults ? search.hasMore : canLoadMoreExpenses;
  const pagingBusy = serverResults
    ? search.loadingMore
    : pendingAction === "loadMoreExpenses" || loadingMoreExpenses;
  const pageMore = serverResults ? search.loadMore : onLoadMore;

  // Day grouping runs over the *whole* filtered list so each header's subtotal
  // is the real day total; only the mounting is windowed.
  const dayGroups = useMemo(() => groupExpensesByDay(visibleExpenses), [visibleExpenses]);
  const windowedGroups = useMemo(() => takeDayGroupsWithin(dayGroups, rowLimit), [dayGroups, rowLimit]);
  const hasUnmountedRows = windowedGroups.length < dayGroups.length;

  // Changing the filter re-shuffles the whole list, so start the window over.
  // Deliberately keyed on `filter` and not on `expenses`: auto-sync hands us a
  // fresh expenses array every 20s, and resetting there would yank a reader
  // back up the list mid-scroll.
  useEffect(() => {
    setRowLimit(RENDER_WINDOW_STEP);
  }, [filter]);

  // Re-observing on every bump is what keeps this chaining: an observer only
  // reports *changes*, so a sentinel that stays in view after a bump would
  // never fire again - but a fresh observation always delivers the current
  // state. The effect stops re-arming once every row is mounted.
  useEffect(() => {
    if (!hasUnmountedRows) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    if (typeof IntersectionObserver === "undefined") {
      // No lazy reveal available (jsdom, ancient browsers): mount the lot
      // rather than stranding rows behind a sentinel that can never fire.
      setRowLimit(Number.POSITIVE_INFINITY);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRowLimit((limit) => limit + RENDER_WINDOW_STEP);
        }
      },
      { rootMargin: RENDER_WINDOW_ROOT_MARGIN },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasUnmountedRows, rowLimit]);

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
                    {categoryLabel(category)}
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
            {windowedGroups.map((group) => (
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
            {hasUnmountedRows ? (
              <div className="records-render-sentinel" ref={sentinelRef} aria-hidden="true" />
            ) : canPageMore ? (
              // Only offer the next page once everything already loaded is on
              // screen - otherwise 載入更多 would fetch more rows while local
              // ones are still waiting behind the render window.
              <button className="text-action records-load-more" type="button" disabled={pagingBusy} onClick={pageMore}>
                {pagingBusy ? text.processing : text.loadMoreRecords}
              </button>
            ) : null}
          </>
        ) : (
          <>
            {/* "沒有符合的紀錄" is now a statement about the whole group, not
                about the loaded window - the search behind it has seen every
                expense. The only case that still needs hedging is a search
                that has not answered yet, or one that failed. */}
            <p className="dialog-empty">
              {search.error
                ? search.error
                : search.pending
                  ? text.processing
                  : filterActive
                    ? "沒有符合的紀錄"
                    : text.noRecords}
            </p>
            {search.error ? (
              <button className="text-action records-load-more" type="button" onClick={search.retry}>
                {"重試"}
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
