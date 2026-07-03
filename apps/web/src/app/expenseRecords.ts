import type { ExpenseSummary } from "./apiClient";
import { UI_TEXT } from "./uiText";

const CATEGORY_LABELS: Record<string, string> = {
  food: UI_TEXT.categories.food,
  transport: UI_TEXT.categories.transport,
  lodging: UI_TEXT.categories.lodging,
  shopping: UI_TEXT.categories.shopping,
  general: UI_TEXT.categories.general,
};

function formatExpenseDate(date: string | undefined) {
  if (!date) return "--";
  const parts = date.split("-");
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  return month && day ? `${month}/${day}` : "--";
}

function formatExpenseTime(date: string | undefined) {
  if (!date) return "";
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return "";
  const period = parsed.getHours() >= 12 ? UI_TEXT.timePeriod.afternoon : UI_TEXT.timePeriod.morning;
  const hour = parsed.getHours() % 12 || 12;
  const minute = String(parsed.getMinutes()).padStart(2, "0");
  const second = String(parsed.getSeconds()).padStart(2, "0");
  return `${period}${hour}:${minute}:${second}`;
}

export function getExpenseRecordRows(expenses: ExpenseSummary[]) {
  return expenses.map((expense) => ({
    id: expense.id,
    title: expense.title,
    categoryLabel: CATEGORY_LABELS[expense.category ?? "general"] ?? UI_TEXT.categories.general,
    dateLabel: formatExpenseDate(expense.expense_date),
    timeLabel: formatExpenseTime(expense.created_at),
    amountMinor: expense.amount_minor,
    metaLabel: `${expense.kind} ${UI_TEXT.expenseRecords.version} v${expense.version}`,
    detailLabel: `${formatExpenseDate(expense.expense_date)} ${expense.title} ${expense.currency}`,
  }));
}
