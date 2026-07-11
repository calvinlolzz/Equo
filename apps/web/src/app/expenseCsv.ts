import type { ExpenseSummary } from "./apiClient";

/** Resolves a group_members.id to a display name ("" when unknown). */
export type MemberNameResolver = (memberId: string | null | undefined) => string;

const HEADER = ["日期", "標題", "類型", "分類", "金額", "幣別", "付款人", "分攤對象", "備註"];

const KIND_LABELS: Record<string, string> = {
  expense: "支出",
  income: "收入",
  transfer: "清償",
};

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function amountText(amountMinor: number): string {
  // amount_minor is in cents; emit a plain decimal so spreadsheets treat the
  // column as numeric (no currency prefix, no thousands separators). String()
  // prints the shortest round-trip form, so cents never leave float noise.
  return String(amountMinor / 100);
}

function expenseDateText(expense: ExpenseSummary): string {
  if (expense.expense_date) return expense.expense_date;
  if (expense.created_at) return expense.created_at.slice(0, 10);
  return "";
}

/**
 * Builds the full-group export as a CSV string. Starts with a UTF-8 BOM so
 * Excel on Windows detects the encoding and renders Chinese correctly, and
 * uses CRLF row endings for the same reason. Rows are emitted in the order
 * given (callers pass newest-first pages straight from the API).
 */
export function buildExpenseCsv(expenses: ExpenseSummary[], memberName: MemberNameResolver): string {
  const rows = expenses.map((expense) => {
    const payers = (expense.expense_payments ?? [])
      .map((payment) => memberName(payment.payer_member_id))
      .filter(Boolean)
      .join("、");
    const shares =
      expense.kind === "transfer"
        ? memberName(expense.transfer_to_member_id)
        : (expense.expense_shares ?? [])
            .map((share) => memberName(share.member_id))
            .filter(Boolean)
            .join("、");

    return [
      expenseDateText(expense),
      expense.title,
      KIND_LABELS[expense.kind] ?? expense.kind,
      expense.kind === "expense" ? (expense.category ?? "") : "",
      amountText(expense.amount_minor),
      expense.currency,
      payers,
      shares,
      expense.note ?? "",
    ];
  });

  const lines = [HEADER, ...rows].map((row) => row.map(csvField).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

/** Sanitizes a group name into a safe download filename. */
export function csvFileName(groupName: string, today: string): string {
  const safe = groupName.replace(/[\\/:*?"<>|\s]+/g, "_").replace(/^_+|_+$/g, "") || "equo";
  return `${safe}-帳目-${today}.csv`;
}
