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
