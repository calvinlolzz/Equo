import { dateKey } from "./appDates";
import type { Expense } from "./appTypes";

export type ExpenseDayGroup = {
  /** Local YYYY-MM-DD key for the day. */
  key: string;
  expenses: Expense[];
  /** Sum of the day's outflow (income excluded), for the day-header subtotal. */
  subtotalMinor: number;
};

/**
 * Bucket a already-sorted expense list into day groups (mirrors the demo's
 * records view: a date header + per-day subtotal above that day's rows).
 * Input order is preserved — the server returns newest-first, so groups come
 * out newest-day-first and rows stay in their original order within a day.
 * Income rows are shown in their day but not summed into the spend subtotal.
 */
export function groupExpensesByDay(expenses: Expense[]): ExpenseDayGroup[] {
  const groups = new Map<string, ExpenseDayGroup>();
  const order: string[] = [];
  for (const expense of expenses) {
    const key = dateKey(expense.createdAt);
    let group = groups.get(key);
    if (!group) {
      group = { key, expenses: [], subtotalMinor: 0 };
      groups.set(key, group);
      order.push(key);
    }
    group.expenses.push(expense);
    if (expense.kind !== "income") {
      group.subtotalMinor += expense.amountMinor;
    }
  }
  return order.map((key) => groups.get(key)!);
}

/**
 * Cap how much of a records list is mounted at once.
 *
 * The panel keeps every loaded expense in memory (search/filter run over the
 * whole window), but a group with hundreds of loaded expenses would otherwise
 * put hundreds of rows in the DOM — re-reconciled on every auto-sync tick and
 * on every keystroke in the search box. The caller grows `rowLimit` as the
 * user scrolls, so the mounted count tracks what has actually been looked at.
 *
 * Days are taken whole: the day header prints that day's subtotal, so cutting
 * a day in half would show a subtotal that doesn't add up to the rows beneath
 * it. That means the result can overshoot `rowLimit` by the tail day's length.
 * A limit of 0 or less mounts nothing; anything above takes at least one day.
 */
export function takeDayGroupsWithin(groups: ExpenseDayGroup[], rowLimit: number): ExpenseDayGroup[] {
  if (rowLimit <= 0) return [];
  const taken: ExpenseDayGroup[] = [];
  let rows = 0;
  for (const group of groups) {
    taken.push(group);
    rows += group.expenses.length;
    if (rows >= rowLimit) break;
  }
  return taken;
}
