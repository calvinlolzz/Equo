import type { Expense } from "./appTypes";
import { UI_TEXT } from "./uiText";

/**
 * Whether a group is the caller's own personal ledger rather than an
 * ordinary shared group. `kind` is absent on any payload predating the
 * personal-ledger migration (an old cached list, a write response that never
 * carried it) - those are ordinary shared groups, so absent reads as false,
 * never as "unknown, so personal".
 */
export function isPersonalGroup(g?: { kind?: string } | null): boolean {
  return g?.kind === "personal";
}

/**
 * The name to show for a group. A personal ledger's stored name
 * (「我的帳本」, chosen so old clients and the admin console show something
 * sensible) is never what this app displays - the UI always shows the
 * translated label instead, so renaming is meaningless and silently ignored
 * server-side (see handleUpdateGroup).
 */
export function groupDisplayName(g: { kind?: string; name: string }): string {
  return isPersonalGroup(g) ? UI_TEXT.personalLedger.name : g.name;
}

/**
 * The rail's own order: the personal ledger first (there is at most one),
 * everything else in whatever order the server sent it. Not a sort by any
 * other key - `groups` already arrives ordered (most-recently-updated
 * first), and this only has to pull one row to the front without disturbing
 * the rest.
 */
export function orderGroupsForRail<T extends { kind?: string }>(groups: T[]): T[] {
  const personal = groups.filter((group) => isPersonalGroup(group));
  const rest = groups.filter((group) => !isPersonalGroup(group));
  return [...personal, ...rest];
}

/** `YYYY-MM` for a date, in local time - never UTC, which would misdate the last/first day of a month for anyone west/east of it. */
export function currentMonthKey(now: Date = new Date()): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/**
 * The month an expense belongs to, for the ledger's this-month summary.
 * Prefers the server's plain expense_date (a date, not a timestamp) over
 * createdAt, which drifts by a day near midnight in some timezones once
 * converted through a full ISO timestamp. Optimistic rows built locally
 * before the write round-trips have no expenseDate yet, so they fall back to
 * the local month of createdAt.
 */
export function ledgerMonthKey(expense: { expenseDate?: string; createdAt: string }): string {
  if (expense.expenseDate) return expense.expenseDate.slice(0, 7);
  return currentMonthKey(new Date(expense.createdAt));
}

export type LedgerMonthSummary = {
  expenseMinor: number;
  incomeMinor: number;
  /** income - expense. Can be negative. */
  netMinor: number;
  /** Expense-only, largest first. */
  byCategory: Array<{ category: string; totalMinor: number }>;
};

/**
 * This month's totals for the personal ledger home screen, computed
 * entirely on the client from whatever window of expenses is loaded - see
 * the plan's note on why (no new endpoint, works offline, updates the
 * instant a write lands) and ledgerMonthCoverage below for the accuracy
 * caveat that comes with it.
 *
 * Settlements are excluded outright (a ledger has no one else to settle
 * with, but a stray transfer-kind row should still not count as spend or
 * income), and a row in a different currency than the ledger's own is
 * skipped rather than summed in - there is no meaningful single total across
 * currencies (see groupBalanceSummary.ts's same reasoning for the rail).
 */
export function summarizeLedgerMonth(expenses: Expense[], monthKey: string, currency: string): LedgerMonthSummary {
  let expenseMinor = 0;
  let incomeMinor = 0;
  const byCategoryTotals = new Map<string, number>();

  for (const expense of expenses) {
    if (expense.currency !== currency) continue;
    if (ledgerMonthKey(expense) !== monthKey) continue;
    if (expense.kind === "settlement") continue;

    if (expense.kind === "income") {
      incomeMinor += expense.amountMinor;
      continue;
    }

    // "expense" or missing kind (older data defaults to expense).
    expenseMinor += expense.amountMinor;
    const category = expense.category?.trim() ? expense.category : "general";
    byCategoryTotals.set(category, (byCategoryTotals.get(category) ?? 0) + expense.amountMinor);
  }

  const byCategory = [...byCategoryTotals.entries()]
    .map(([category, totalMinor]) => ({ category, totalMinor }))
    .sort((a, b) => b.totalMinor - a.totalMinor);

  return { expenseMinor, incomeMinor, netMinor: incomeMinor - expenseMinor, byCategory };
}

/**
 * Whether the loaded expenses window is enough to trust this month's summary,
 * or whether more history needs paging in first (see App.tsx's auto-paging
 * effect, capped at 5 pages).
 *
 * "complete" either because everything has loaded (the window already holds
 * every expense the group has), or because the oldest loaded row already
 * belongs to an earlier month than the one being summarized - in which case
 * there is nothing further back that could still belong to this month.
 */
export function ledgerMonthCoverage(
  expenses: Expense[],
  expenseCount: number,
  monthKey: string,
): "complete" | "partial" {
  if (expenses.length >= expenseCount) return "complete";
  const oldest = expenses[expenses.length - 1];
  if (oldest && ledgerMonthKey(oldest) < monthKey) return "complete";
  return "partial";
}
