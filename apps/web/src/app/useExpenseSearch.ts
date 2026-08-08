import { useCallback, useEffect, useRef, useState } from "react";
import type { Expense } from "./appTypes";
import { isExpenseFilterActive, type ExpenseFilter } from "./expenseFilter";

export type ExpenseSearchPage = {
  expenses: Expense[];
  matchCount: number;
  matchTotalMinor: number;
  hasMore: boolean;
};

type Searcher = (search: {
  q?: string;
  memberId?: string;
  category?: string;
  kind?: string;
  from?: string;
  to?: string;
  limit?: number;
  beforeDate?: string;
  beforeCreatedAt?: string;
}) => Promise<ExpenseSearchPage>;

type Options = {
  searchExpenses: Searcher | null;
  filter: ExpenseFilter;
  /** False while the records panel is closed. */
  enabled: boolean;
  describeError: (error: unknown) => string;
};

const PAGE_SIZE = 50;

/** Typing pause before a query goes to the server. */
const DEBOUNCE_MS = 300;

/**
 * The records-panel filter, answered by the server over the group's whole
 * history instead of by filterExpenses() over the ~100 loaded expenses.
 *
 * Only active while the filter is; with an empty filter the panel keeps
 * rendering its in-memory list, which is what makes optimistic writes and
 * offline rows show up instantly in the common case.
 *
 * Results are kept on screen while the next query is in flight
 * (stale-while-revalidate). Blanking the list on every keystroke and
 * refilling it 300ms later reads as flicker, and the count jumping to 0 and
 * back is worse than a briefly stale one - `loading` is exposed so the panel
 * can say which it is.
 */
export function useExpenseSearch({ searchExpenses, filter, enabled, describeError }: Options) {
  const active = enabled && isExpenseFilterActive(filter);
  const [page, setPage] = useState<ExpenseSearchPage | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);
  const [reloadToken, setReloadToken] = useState(0);

  const { query, memberId, category, kind, from, to } = filter;

  useEffect(() => {
    if (!active || !searchExpenses) return;

    const token = ++requestId.current;
    setLoading(true);
    setError(null);

    const timer = setTimeout(() => {
      searchExpenses({
        q: query.trim() || undefined,
        memberId: memberId || undefined,
        category: category || undefined,
        kind: kind || undefined,
        from: from || undefined,
        to: to || undefined,
        limit: PAGE_SIZE,
      })
        .then((result) => {
          if (token !== requestId.current) return;
          setPage(result);
          setLoading(false);
        })
        .catch((cause: unknown) => {
          if (token !== requestId.current) return;
          setError(describeError(cause));
          setLoading(false);
        });
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
    // describeError is a stable formatter; excluded so a parent re-render
    // cannot restart the debounce.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, searchExpenses, query, memberId, category, kind, from, to, reloadToken]);

  // Clearing the filter (or closing the panel) drops the results, so the next
  // search never flashes the previous one's rows.
  useEffect(() => {
    if (active) return;
    requestId.current += 1;
    setPage(null);
    setError(null);
    setLoading(false);
    setLoadingMore(false);
  }, [active]);

  const loadMore = useCallback(async () => {
    if (!active || !searchExpenses || !page?.hasMore || loadingMore) return;
    const oldest = page.expenses[page.expenses.length - 1];
    if (!oldest) return;

    const token = requestId.current;
    setLoadingMore(true);
    try {
      const next = await searchExpenses({
        q: query.trim() || undefined,
        memberId: memberId || undefined,
        category: category || undefined,
        kind: kind || undefined,
        from: from || undefined,
        to: to || undefined,
        limit: PAGE_SIZE,
        beforeDate: oldest.expenseDate ?? oldest.createdAt.slice(0, 10),
        beforeCreatedAt: oldest.createdAt,
      });
      // The filter moved on while this page was in flight - drop it rather
      // than appending rows that answer a question nobody is asking now.
      if (token !== requestId.current) return;
      const seen = new Set(page.expenses.map((expense) => expense.id));
      setPage({
        ...next,
        expenses: [...page.expenses, ...next.expenses.filter((expense) => !seen.has(expense.id))],
      });
    } catch (cause) {
      if (token === requestId.current) setError(describeError(cause));
    } finally {
      setLoadingMore(false);
    }
  }, [active, searchExpenses, page, loadingMore, query, memberId, category, kind, from, to, describeError]);

  const retry = useCallback(() => setReloadToken((value) => value + 1), []);

  return {
    /** True when the server is the source of truth for what the panel shows. */
    active,
    expenses: page?.expenses ?? [],
    matchCount: page?.matchCount ?? 0,
    matchTotalMinor: page?.matchTotalMinor ?? 0,
    hasMore: page?.hasMore ?? false,
    /** No page has arrived yet for the current filter - the list has nothing truthful to show. */
    pending: active && page === null && error === null,
    loading,
    loadingMore,
    error,
    loadMore,
    retry,
  };
}
