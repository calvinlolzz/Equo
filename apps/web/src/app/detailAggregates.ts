import type { BalanceSummary } from "./apiClient";
import type { Expense } from "./appTypes";
import { getMemberShareMinor } from "./expenseShareSplit";

/**
 * The server-authoritative aggregates get_group_detail (v3) carries
 * alongside the (capped) expenses window and the members' balances - see
 * supabase/migrations/20260706120000_group_detail_pagination_and_aggregates.sql
 * and groupRepository.ts's GroupDetailRecord for the wire shapes this
 * mirrors in camelCase.
 *
 * kind semantics (mirrors spendableExpenses in App.tsx - kept in sync
 * deliberately, see the module doc below for the exact rule):
 * - expenseCount counts every non-deleted entry regardless of kind.
 * - spendTotalMinor/spendByDay/memberDayShares only ever accumulate
 *   kind === "expense" entries; income and settlement entries affect
 *   balances (via applyExpenseToBalances/removeExpenseFromBalances) and
 *   expenseCount, but never the spend aggregates.
 */
export type GroupDetailAggregates = {
  expenseCount: number;
  spendTotalMinor: number;
  spendByDay: Array<{ day: string; totalMinor: number }>;
  /** All-time per-category kind==="expense" totals, server-sorted largest first. */
  spendByCategory: Array<{ category: string; totalMinor: number }>;
  memberDayShares: Array<{ day: string; memberId: string; shareMinor: number }>;
};

/** The 8-day trailing window get_group_detail computes spend_by_day/member_day_shares over. */
function dateKeyFromIso(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value.slice(0, 10);
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Whether an expense counts toward the spend aggregates (spendTotalMinor/
 * spendByDay/memberDayShares). Mirrors App.tsx's spendableExpenses filter
 * exactly: settlements/transfers move money between members without
 * spending it, and income entries are money received, not spent - both are
 * excluded. expense_count (server-side) and applyExpenseToBalances/
 * removeExpenseFromBalances are NOT gated by this - every non-deleted kind
 * counts toward expense_count, and every kind affects balances.
 */
function isSpendableExpense(expense: Expense): boolean {
  return expense.kind !== "settlement" && expense.kind !== "income";
}

/**
 * Credits each payment to its payer, mirroring groupBalances.ts's
 * creditPayments: multi-payer expenses (or an income entry's beneficiary
 * payments) credit every entry in expense.payments; otherwise the single
 * payerId is credited the full amountMinor.
 */
function creditPayments(balances: Map<string, number>, expense: Expense, sign: 1 | -1) {
  if (expense.payments && expense.payments.length > 0) {
    expense.payments.forEach((payment) => {
      balances.set(payment.payerId, (balances.get(payment.payerId) ?? 0) + sign * payment.amountMinor);
    });
    return;
  }
  balances.set(expense.payerId, (balances.get(expense.payerId) ?? 0) + sign * expense.amountMinor);
}

/** Debits every member's share of the expense, mirroring groupBalances.ts's per-member loop. */
function debitShares(balances: Map<string, number>, expense: Expense, memberIds: string[], sign: 1 | -1) {
  memberIds.forEach((memberId) => {
    const share = getMemberShareMinor(expense, memberId);
    if (share === 0) return;
    balances.set(memberId, (balances.get(memberId) ?? 0) - sign * share);
  });
}

function toBalanceMap(balances: BalanceSummary[]): Map<string, number> {
  return new Map(balances.map((entry) => [entry.memberId, entry.balance.amount_minor]));
}

function fromBalanceMap(map: Map<string, number>, balances: BalanceSummary[], currency: string): BalanceSummary[] {
  const memberIds = new Set([...balances.map((entry) => entry.memberId), ...map.keys()]);
  return [...memberIds].map((memberId) => ({
    memberId,
    balance: { amount_minor: map.get(memberId) ?? 0, currency },
  }));
}

/**
 * Applies (or removes) a single expense's balance effect to a server
 * balances array, mirroring computeMemberBalances' per-expense math exactly
 * (same creditPayments + per-member share debit) but as an incremental
 * patch instead of a from-scratch recompute - so an optimistic mutation can
 * patch the server-computed balances array without re-deriving it from the
 * full expense history (which the client no longer holds in full once the
 * expenses window is capped).
 *
 * memberIds should be every active member's id (so a member with a
 * currently-zero balance still has a row) - typically the caller's own
 * members list.
 */
export function applyExpenseToBalances(
  balances: BalanceSummary[],
  expense: Expense,
  memberIds: string[],
  currency: string,
): BalanceSummary[] {
  const map = toBalanceMap(balances);
  creditPayments(map, expense, 1);
  debitShares(map, expense, memberIds, 1);
  return fromBalanceMap(map, balances, currency);
}

export function removeExpenseFromBalances(
  balances: BalanceSummary[],
  expense: Expense,
  memberIds: string[],
  currency: string,
): BalanceSummary[] {
  const map = toBalanceMap(balances);
  creditPayments(map, expense, -1);
  debitShares(map, expense, memberIds, -1);
  return fromBalanceMap(map, balances, currency);
}

function patchSpendByDay(
  spendByDay: GroupDetailAggregates["spendByDay"],
  day: string,
  deltaMinor: number,
): GroupDetailAggregates["spendByDay"] {
  const index = spendByDay.findIndex((entry) => entry.day === day);
  if (index === -1) {
    if (deltaMinor === 0) return spendByDay;
    return [...spendByDay, { day, totalMinor: deltaMinor }];
  }
  const nextTotal = spendByDay[index].totalMinor + deltaMinor;
  const next = [...spendByDay];
  if (nextTotal === 0) {
    next.splice(index, 1);
  } else {
    next[index] = { day, totalMinor: nextTotal };
  }
  return next;
}

function patchSpendByCategory(
  spendByCategory: GroupDetailAggregates["spendByCategory"],
  category: string,
  deltaMinor: number,
): GroupDetailAggregates["spendByCategory"] {
  if (deltaMinor === 0) return spendByCategory;
  const index = spendByCategory.findIndex((entry) => entry.category === category);
  if (index === -1) {
    return [...spendByCategory, { category, totalMinor: deltaMinor }].sort((a, b) => b.totalMinor - a.totalMinor);
  }
  const nextTotal = spendByCategory[index].totalMinor + deltaMinor;
  const next = [...spendByCategory];
  if (nextTotal === 0) {
    next.splice(index, 1);
  } else {
    next[index] = { category, totalMinor: nextTotal };
  }
  return next.sort((a, b) => b.totalMinor - a.totalMinor);
}

function patchMemberDayShares(
  memberDayShares: GroupDetailAggregates["memberDayShares"],
  day: string,
  memberId: string,
  deltaMinor: number,
): GroupDetailAggregates["memberDayShares"] {
  if (deltaMinor === 0) return memberDayShares;
  const index = memberDayShares.findIndex((entry) => entry.day === day && entry.memberId === memberId);
  if (index === -1) {
    return [...memberDayShares, { day, memberId, shareMinor: deltaMinor }];
  }
  const nextShare = memberDayShares[index].shareMinor + deltaMinor;
  const next = [...memberDayShares];
  if (nextShare === 0) {
    next.splice(index, 1);
  } else {
    next[index] = { day, memberId, shareMinor: nextShare };
  }
  return next;
}

/**
 * Patches expenseCount/spendTotalMinor/spendByDay/memberDayShares for a
 * single expense being added (sign +1) or removed (sign -1).
 *
 * - expenseCount changes for every kind (add: +1, remove: -1) - the server
 *   counts all non-deleted entries regardless of kind.
 * - The spend aggregates only change for spendable kinds (see
 *   isSpendableExpense) - income/settlement never touch spendTotalMinor/
 *   spendByDay/memberDayShares.
 * - spendByDay/memberDayShares are keyed by the expense's own date
 *   (dateKeyFromIso(expense.createdAt), matching App.tsx's dateKey format)
 *   regardless of whether that date falls inside the server's trailing
 *   8-day window - a day outside the window simply starts from an absent
 *   entry (treated as 0) and this patch adds an entry for it; the UI only
 *   ever reads spendByDay/memberDayShares for days inside dateChips (the
 *   last 8 days), so an out-of-window entry is harmless dead data until the
 *   next background refresh prunes it.
 */
function patchAggregates(
  aggregates: GroupDetailAggregates,
  expense: Expense,
  memberIds: string[],
  sign: 1 | -1,
): GroupDetailAggregates {
  const expenseCount = aggregates.expenseCount + sign;

  if (!isSpendableExpense(expense)) {
    return { ...aggregates, expenseCount };
  }

  const day = dateKeyFromIso(expense.createdAt);
  const spendTotalMinor = aggregates.spendTotalMinor + sign * expense.amountMinor;
  const spendByDay = patchSpendByDay(aggregates.spendByDay, day, sign * expense.amountMinor);
  // Mirrors the server's coalesce(nullif(category, ''), 'general') fold.
  const spendByCategory = patchSpendByCategory(
    aggregates.spendByCategory,
    expense.category?.trim() ? expense.category : "general",
    sign * expense.amountMinor,
  );

  let memberDayShares = aggregates.memberDayShares;
  memberIds.forEach((memberId) => {
    const share = getMemberShareMinor(expense, memberId);
    if (share === 0) return;
    memberDayShares = patchMemberDayShares(memberDayShares, day, memberId, sign * share);
  });

  return { expenseCount, spendTotalMinor, spendByDay, spendByCategory, memberDayShares };
}

export function applyExpenseToAggregates(
  aggregates: GroupDetailAggregates,
  expense: Expense,
  memberIds: string[],
): GroupDetailAggregates {
  return patchAggregates(aggregates, expense, memberIds, 1);
}

export function removeExpenseFromAggregates(
  aggregates: GroupDetailAggregates,
  expense: Expense,
  memberIds: string[],
): GroupDetailAggregates {
  return patchAggregates(aggregates, expense, memberIds, -1);
}
