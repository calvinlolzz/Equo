import { useEffect, useMemo, useRef, useState } from "react";
import { HandCoins, History, Pencil, ReceiptText, Search, SlidersHorizontal, Trash2, X } from "lucide-react";
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
import { useSwipeRowActions } from "./useSwipeRowActions";

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
  { value: "", label: UI_TEXT.records.filterAll },
  { value: "expense", label: UI_TEXT.records.filterExpense },
  { value: "income", label: UI_TEXT.records.filterIncome },
  { value: "settlement", label: UI_TEXT.records.filterSettlement },
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
  onOpenExpense: (expenseId: string) => void;
  /** Swipe-row shortcuts. Same handlers the detail dialog uses — the gesture is
      a shortcut to them, not a second path with its own rules. */
  onEditExpense: (expense: Expense) => void;
  onDeleteExpense: (expense: Expense) => void;
  /** Server-side search over the whole history; null when offline/signed out. */
  searchExpenses: Searcher | null;
  describeError: (error: unknown) => string;
  /**
   * Bumped by the `/` shortcut to put the cursor in the search box.
   *
   * A counter and not a boolean: pressing `/` while this sheet is ALREADY open
   * has to work too, and a flag that is already true is not an event.
   */
  focusSearchSignal?: number;
  /**
   * True for the caller's own personal ledger. There is no settlement kind
   * to filter by (a ledger has nobody to settle with) and no other member to
   * filter by either, so both drop out of the advanced filters.
   */
  personal?: boolean;
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
  onOpenExpense,
  onEditExpense,
  onDeleteExpense,
  searchExpenses,
  describeError,
  focusSearchSignal = 0,
  personal = false,
}: RecordsPanelProps) {
  const [filter, setFilter] = useState<ExpenseFilter>(EMPTY_EXPENSE_FILTER);
  const kindOptions = personal ? KIND_OPTIONS.filter((option) => option.value !== "settlement") : KIND_OPTIONS;
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const [rowLimit, setRowLimit] = useState(RENDER_WINDOW_STEP);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);

  /**
   * Put the cursor in the search box when `/` asks for it.
   *
   * Skipped on the first render (signal 0) so opening this sheet by tapping
   * 支出記錄 does not summon a phone keyboard over the list. Only the shortcut
   * bumps it, and the shortcut needs a physical keyboard to press.
   */
  useEffect(() => {
    if (focusSearchSignal <= 0) return;
    // preventScroll for the same reason useDialogChrome does it: focusing
    // inside a sheet that is still sliding up must not jump the page.
    searchInputRef.current?.focus({ preventScroll: true });
    searchInputRef.current?.select();
  }, [focusSearchSignal]);
  /** The one row currently swiped open — at most one, like every native list. */
  const [openRowId, setOpenRowId] = useState<string | null>(null);

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
    // The row that was open may not even be in the new list.
    setOpenRowId(null);
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
        <p>{UI_TEXT.records.description}</p>
      </div>
      <div className="panel-stat-grid">
        <div>
          <span>{UI_TEXT.records.count}</span>
          <strong>{expenseCount}</strong>
        </div>
        <div>
          <span>{UI_TEXT.records.totalSpend}</span>
          <strong>{formatAmount(totalExpenseMinor, currency)}</strong>
        </div>
      </div>

      <div className="records-filter">
        <div className="records-search">
          <Search aria-hidden="true" size={16} />
          <input
            ref={searchInputRef}
            type="search"
            value={filter.query}
            placeholder={UI_TEXT.records.searchPlaceholder}
            aria-label={UI_TEXT.records.searchLabel}
            title={text.searchShortcutHint}
            onChange={(event) => patchFilter({ query: event.target.value })}
          />
          {filter.query ? (
            <button type="button" className="records-search__clear" aria-label={UI_TEXT.records.clearSearch} onClick={() => patchFilter({ query: "" })}>
              <X aria-hidden="true" size={14} />
            </button>
          ) : null}
          <button
            type="button"
            className={advancedOpen ? "records-filter__toggle is-open" : "records-filter__toggle"}
            aria-expanded={advancedOpen}
            aria-label={UI_TEXT.records.moreFilters}
            onClick={() => setAdvancedOpen((open) => !open)}
          >
            <SlidersHorizontal aria-hidden="true" size={16} />
          </button>
        </div>

        <div className="records-chip-row" role="group" aria-label={UI_TEXT.records.kindFilter}>
          {kindOptions.map((option) => (
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
            {personal ? null : (
              <label>
                <span>{UI_TEXT.records.member}</span>
                <select value={filter.memberId} onChange={(event) => patchFilter({ memberId: event.target.value })}>
                  <option value="">{UI_TEXT.records.allMembers}</option>
                  {members.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.name}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              <span>{UI_TEXT.records.category}</span>
              <select value={filter.category} onChange={(event) => patchFilter({ category: event.target.value })}>
                <option value="">{UI_TEXT.records.allCategories}</option>
                {categories.map((category) => (
                  <option key={category} value={category}>
                    {categoryLabel(category)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span>{UI_TEXT.records.fromDate}</span>
              <input type="date" value={filter.from} max={filter.to || undefined} onChange={(event) => patchFilter({ from: event.target.value })} />
            </label>
            <label>
              <span>{UI_TEXT.records.toDate}</span>
              <input type="date" value={filter.to} min={filter.from || undefined} onChange={(event) => patchFilter({ to: event.target.value })} />
            </label>
          </div>
        ) : null}

        {filterActive ? (
          <div className="records-filter__summary" role="status" aria-live="polite">
            <span>
              {`${UI_TEXT.records.matchPrefix}${summary.count}${UI_TEXT.records.matchMiddle}${formatAmount(summary.totalMinor, currency)}`}
              {canLoadMoreExpenses ? <small>{UI_TEXT.records.localOnly}</small> : null}
            </span>
            <button type="button" className="text-action" onClick={() => setFilter(EMPTY_EXPENSE_FILTER)}>
              {UI_TEXT.records.clearFilters}
            </button>
          </div>
        ) : null}
      </div>

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
                  <ExpenseRow
                    key={expense.id}
                    expense={expense}
                    pending={pendingWriteIds.has(expense.id)}
                    open={openRowId === expense.id}
                    onOpenRow={() => setOpenRowId(expense.id)}
                    onCloseRow={() => setOpenRowId((current) => (current === expense.id ? null : current))}
                    onOpenExpense={() => onOpenExpense(expense.id)}
                    onEdit={() => {
                      setOpenRowId(null);
                      onEditExpense(expense);
                    }}
                    onDelete={() => {
                      setOpenRowId(null);
                      onDeleteExpense(expense);
                    }}
                  />
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
            {/* UI_TEXT.records.noMatches is now a statement about the whole group, not
                about the loaded window - the search behind it has seen every
                expense. The only case that still needs hedging is a search
                that has not answered yet, or one that failed. */}
            <p className="dialog-empty">
              {search.error
                ? search.error
                : search.pending
                  ? text.processing
                  : filterActive
                    ? UI_TEXT.records.noMatches
                    : text.noRecords}
            </p>
            {search.error ? (
              <button className="text-action records-load-more" type="button" onClick={search.retry}>
                {UI_TEXT.records.retry}
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

type ExpenseRowProps = {
  expense: Expense;
  pending: boolean;
  open: boolean;
  onOpenRow: () => void;
  onCloseRow: () => void;
  onOpenExpense: () => void;
  onEdit: () => void;
  onDelete: () => void;
};

/** How far a row slides to uncover 編輯 + 刪除. Two 72px targets. */
const ROW_REVEAL_WIDTH = 144;

/**
 * One expense row, with the actions that sit behind it on mobile.
 *
 * The row is still an ordinary button that opens the detail dialog — on
 * desktop, for keyboard users, and for anyone who never discovers the gesture.
 * The swipe only adds a shortcut to the two things people do most.
 */
function ExpenseRow({
  expense,
  pending,
  open,
  onOpenRow,
  onCloseRow,
  onOpenExpense,
  onEdit,
  onDelete,
}: ExpenseRowProps) {
  const { swipeProps } = useSwipeRowActions({
    revealWidth: ROW_REVEAL_WIDTH,
    open,
    onOpen: onOpenRow,
    onClose: onCloseRow,
  });

  return (
    <div className={open ? "record-swipe open" : "record-swipe"}>
      {/* aria-hidden while closed: the same two actions are in the detail
          dialog, so exposing a second copy to a screen reader would just be
          duplicate controls with no visible counterpart. */}
      <div className="record-swipe-actions" aria-hidden={!open}>
        <button className="record-swipe-action" type="button" tabIndex={open ? 0 : -1} onClick={onEdit}>
          <Pencil aria-hidden="true" size={16} />
          {text.editExpenseAction}
        </button>
        <button
          className="record-swipe-action danger"
          type="button"
          tabIndex={open ? 0 : -1}
          onClick={onDelete}
        >
          <Trash2 aria-hidden="true" size={16} />
          {UI_TEXT.app.deleteExpense}
        </button>
      </div>
      <button
        className="record-dialog-row"
        type="button"
        {...swipeProps}
        onClick={() => {
          // An open row swallows the tap to close itself — otherwise the first
          // tap after a swipe would open the detail dialog, which is exactly
          // what the user was trying to avoid.
          if (open) {
            onCloseRow();
            return;
          }
          onOpenExpense();
        }}
      >
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
            {pending ? <em className="record-pending-badge">{text.offlinePendingBadge}</em> : null}
          </strong>
          <small>{expense.note ? expense.note : formatActivityTime(expense.createdAt)}</small>
        </span>
        <b className={expense.kind === "income" ? "amount-income" : undefined}>
          {expense.kind === "income"
            ? `+${formatAmount(expense.amountMinor, expense.currency)}`
            : formatAmount(expense.amountMinor, expense.currency)}
        </b>
      </button>
    </div>
  );
}
