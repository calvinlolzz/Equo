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

/** One shared group's fold into the caller's month, as the server returns it (see personal_month_group_shares). */
export type GroupShareMonth = {
  groupId: string;
  name: string;
  currency: string;
  archived: boolean;
  shareMinor: number;
  expenseCount: number;
  byCategory: Array<{ category: string; totalMinor: number }>;
};

/** GET /me/group-shares's payload, mapped to camelCase - see cloudAdapters.toPersonalShares. */
export type PersonalShares = {
  month: string;
  groups: GroupShareMonth[];
};

/**
 * The ledger home's combined view: the client-computed "own" figures
 * (summarizeLedgerMonth) folded with the server's group-shares read for the
 * same month - see the plan's D1-D4 for what counts and why.
 */
export type LedgerMonthView = LedgerMonthSummary & {
  /** The own-only expense total - summary.expenseMinor, kept under its own name so the split line can show both halves. */
  ownExpenseMinor: number;
  /** Sum of countedGroups' shares - 0 whenever sharesKnown is false. */
  groupShareMinor: number;
  /** Same-currency groups with a positive share, folded into the totals above. */
  countedGroups: GroupShareMonth[];
  /** Groups with a positive share in another currency - listed, never summed (D2). */
  uncountedGroups: GroupShareMonth[];
  /** False when `shares` is missing or is for a different month - the UI must not claim "no group spend" when it simply hasn't loaded. */
  sharesKnown: boolean;
};

/**
 * Combine a ledger's own-computed month (summarizeLedgerMonth) with the
 * server's group-shares read for the same month.
 *
 * `shares` is treated as unusable - not just absent - whenever its `month`
 * does not match `monthKey`: a stale result for last month must never be
 * folded into this month's headline just because a fresher fetch hasn't
 * landed yet (see cloudStore's personalSharesAttemptedMonth, which is what
 * distinguishes "still loading" from "loaded and empty" for the caller).
 */
export function combineLedgerMonth(
  own: LedgerMonthSummary,
  shares: PersonalShares | null,
  monthKey: string,
  currency: string,
): LedgerMonthView {
  if (!shares || shares.month !== monthKey) {
    return {
      ...own,
      ownExpenseMinor: own.expenseMinor,
      groupShareMinor: 0,
      countedGroups: [],
      uncountedGroups: [],
      sharesKnown: false,
    };
  }

  const withPositiveShare = shares.groups.filter((group) => group.shareMinor > 0);
  const countedGroups = withPositiveShare.filter((group) => group.currency === currency);
  const uncountedGroups = withPositiveShare.filter((group) => group.currency !== currency);
  const groupShareMinor = countedGroups.reduce((sum, group) => sum + group.shareMinor, 0);
  const expenseMinor = own.expenseMinor + groupShareMinor;

  const byCategoryTotals = new Map(own.byCategory.map((entry) => [entry.category, entry.totalMinor]));
  for (const group of countedGroups) {
    for (const entry of group.byCategory) {
      byCategoryTotals.set(entry.category, (byCategoryTotals.get(entry.category) ?? 0) + entry.totalMinor);
    }
  }
  const byCategory = [...byCategoryTotals.entries()]
    .map(([category, totalMinor]) => ({ category, totalMinor }))
    .sort((a, b) => b.totalMinor - a.totalMinor);

  return {
    expenseMinor,
    incomeMinor: own.incomeMinor,
    netMinor: own.incomeMinor - expenseMinor,
    byCategory,
    ownExpenseMinor: own.expenseMinor,
    groupShareMinor,
    countedGroups,
    uncountedGroups,
    sharesKnown: true,
  };
}

/**
 * This month's totals for the personal ledger home screen - the "own" half
 * of the picture (see combineLedgerMonth for the other half, group shares).
 * Computed entirely on the client from whatever window of expenses is
 * loaded - see the plan's note on why (no new endpoint, works offline,
 * updates the instant a write lands) and ledgerMonthCoverage below for the
 * accuracy caveat that comes with it.
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
    // Matches the server's bucketing exactly - coalesce(nullif(category, ''),
    // 'general') in personal_month_group_shares/get_spend_breakdown falls
    // back on an empty string only, never on whitespace. A `.trim()` here
    // would put a " " category in "general" on the client while the server
    // keeps it as its own (whitespace) bucket, splitting one category into
    // two totals depending on which side computed them.
    const category = expense.category ? expense.category : "general";
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
