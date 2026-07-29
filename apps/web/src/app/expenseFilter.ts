import type { Expense } from "./appTypes";

export type ExpenseKindFilter = "" | "expense" | "income" | "settlement";

export type ExpenseFilter = {
  /** Free text, matched against title, note, and the amount as typed. */
  query: string;
  /** Member id who paid for or shares the expense; "" = 所有成員. */
  memberId: string;
  /** Category key (see UI_TEXT.categories); "" = 所有分類. */
  category: string;
  kind: ExpenseKindFilter;
  /** Inclusive YYYY-MM-DD bounds; "" = unbounded on that side. */
  from: string;
  to: string;
};

export const EMPTY_EXPENSE_FILTER: ExpenseFilter = {
  query: "",
  memberId: "",
  category: "",
  kind: "",
  from: "",
  to: "",
};

export function isExpenseFilterActive(filter: ExpenseFilter): boolean {
  return (
    filter.query.trim() !== "" ||
    filter.memberId !== "" ||
    filter.category !== "" ||
    filter.kind !== "" ||
    filter.from !== "" ||
    filter.to !== ""
  );
}

/**
 * The plain YYYY-MM-DD an expense belongs to. Prefers the server's
 * expense_date (the user-chosen day) and only falls back to slicing
 * createdAt for locally-built rows that have not round-tripped yet -
 * the same precedence loadMoreExpenses uses for its page cursor.
 */
export function expenseDayKey(expense: Expense): string {
  return expense.expenseDate ?? expense.createdAt.slice(0, 10);
}

function everyone(expense: Expense): string[] {
  const payers = expense.payments?.map((payment) => payment.payerId) ?? [expense.payerId];
  return [...payers, ...expense.shareMemberIds, ...(expense.transferToMemberId ? [expense.transferToMemberId] : [])];
}

/**
 * Whether the amount matches a numeric query. Compares against the major-unit
 * amount the user sees ($1,200 -> "1200"), not the stored minor units, so
 * typing the number off the screen finds the row. Separators are stripped from
 * the query so "1,200" works too.
 */
function amountMatches(expense: Expense, query: string): boolean {
  const digits = query.replace(/[,\s]/g, "");
  if (digits === "" || !/^\d+(\.\d+)?$/.test(digits)) return false;
  const major = expense.amountMinor / 100;
  // toString() drops the trailing ".00" that formatAmount adds back, which is
  // what makes a "1200" query match a $1,200 expense stored as 120000 minor.
  return major.toString().startsWith(digits) || String(expense.amountMinor).startsWith(digits);
}

function textMatches(expense: Expense, query: string): boolean {
  const needle = query.toLowerCase();
  if (expense.title.toLowerCase().includes(needle)) return true;
  if (expense.note && expense.note.toLowerCase().includes(needle)) return true;
  return false;
}

/**
 * Narrow the loaded expense window to what the records panel should show.
 *
 * Note the scope: this filters the expenses the client already has, which for
 * a long-lived group is a page at a time. The panel says so and keeps its
 * 載入更多 button available while a filter is active - silently reporting
 * "3 筆" when the group has forty matching entries further back would be worse
 * than making the boundary visible.
 */
export function filterExpenses(expenses: Expense[], filter: ExpenseFilter): Expense[] {
  if (!isExpenseFilterActive(filter)) return expenses;
  const query = filter.query.trim();

  return expenses.filter((expense) => {
    if (query !== "" && !textMatches(expense, query) && !amountMatches(expense, query)) return false;
    if (filter.kind !== "" && (expense.kind ?? "expense") !== filter.kind) return false;
    if (filter.category !== "" && expense.category !== filter.category) return false;
    if (filter.memberId !== "" && !everyone(expense).includes(filter.memberId)) return false;

    const day = expenseDayKey(expense);
    if (filter.from !== "" && day < filter.from) return false;
    if (filter.to !== "" && day > filter.to) return false;
    return true;
  });
}

/** Match count and summed amount for the filter bar's result line. */
export function summariseFilteredExpenses(expenses: Expense[]): { count: number; totalMinor: number } {
  return {
    count: expenses.length,
    // Settlements move money between members rather than out of the group, so
    // they never belong in a spend total - the same rule the group aggregates
    // and the analysis panel apply.
    totalMinor: expenses
      .filter((expense) => (expense.kind ?? "expense") === "expense")
      .reduce((sum, expense) => sum + expense.amountMinor, 0),
  };
}
