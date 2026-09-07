import type { AdminExpenseRow, AdminGroupRow, AdminUserRow } from "./apiClient";
import { expenseCategoryLabel, expenseKindLabel, formatDateTime } from "./adminDashboard";

/**
 * CSV exports for the admin console's three list views.
 *
 * Same conventions as the group-level export (expenseCsv.ts): a UTF-8 BOM and
 * CRLF endings so Excel on Windows opens Chinese correctly, amounts as plain
 * decimals so the column stays numeric, and rows in the order the caller
 * passes them.
 */

function csvField(value: string): string {
  if (/[",\r\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function toCsv(header: string[], rows: string[][]): string {
  const lines = [header, ...rows].map((row) => row.map(csvField).join(","));
  return `﻿${lines.join("\r\n")}\r\n`;
}

function amountText(amountMinor: number | null): string {
  if (amountMinor === null) return "";
  return String(amountMinor / 100);
}

export function buildAdminUsersCsv(users: AdminUserRow[]): string {
  return toCsv(
    ["使用者 ID", "Email", "名稱", "註冊時間", "最後上線", "狀態", "群組數", "記帳筆數"],
    users.map((user) => [
      user.id,
      user.email,
      user.display_name,
      formatDateTime(user.created_at),
      formatDateTime(user.last_seen_at),
      user.disabled_at ? "已停用" : "正常",
      String(user.group_count),
      String(user.expense_count),
    ]),
  );
}

export function buildAdminGroupsCsv(groups: AdminGroupRow[]): string {
  return toCsv(
    ["群組 ID", "名稱", "擁有者", "幣別", "建立時間", "狀態", "成員數", "支出筆數", "總支出", "最後記帳"],
    groups.map((group) => [
      group.id,
      group.name,
      group.owner_display_name ?? "",
      group.currency,
      formatDateTime(group.created_at),
      group.deleted_at ? "已刪除" : group.archived_at ? "已封存" : "正常",
      String(group.member_count),
      String(group.expense_count),
      amountText(group.spend_total_minor),
      formatDateTime(group.last_expense_at),
    ]),
  );
}

export function buildAdminExpensesCsv(expenses: AdminExpenseRow[]): string {
  return toCsv(
    ["支出 ID", "日期", "標題", "類型", "分類", "金額", "幣別", "付款人", "分攤對象", "建立者", "備註", "狀態"],
    expenses.map((expense) => [
      expense.id,
      expense.expense_date,
      expense.title,
      expenseKindLabel(expense.kind),
      expense.kind === "expense" ? expenseCategoryLabel(expense.category) : "",
      amountText(expense.amount_minor),
      expense.currency,
      expense.payers.map((payer) => payer.display_name ?? "").filter(Boolean).join("、"),
      expense.kind === "transfer"
        ? (expense.transfer_to_name ?? "")
        : expense.shares.map((share) => share.display_name ?? "").filter(Boolean).join("、"),
      expense.created_by_name ?? "",
      expense.note ?? "",
      expense.deleted_at ? "已刪除" : "正常",
    ]),
  );
}

/**
 * `equo-使用者-2026-07-29.csv` - the console's export filename convention.
 *
 * A capped export says so in its name. The name is the only part of a file that
 * survives being downloaded, renamed in a folder, and mailed to somebody who
 * was not there when it was exported — a note buried under 5,000 rows is not
 * going to reach that person.
 */
export function adminCsvFileName(kind: string, today: string, truncated = false): string {
  return `equo-${kind}-${today}${truncated ? "-已截斷" : ""}.csv`;
}

/**
 * The row an export that hit the cap carries at the end of itself.
 *
 * Without it a capped export is indistinguishable from a complete one — it
 * opens, it has a header, it has thousands of rows, and it is missing however
 * many did not fit. Somebody reconciling numbers against it has no way to find
 * out. (The console's own comment claimed this row existed long before it did.)
 */
export function appendCsvTruncationNotice(csv: string, exported: number, total: number): string {
  if (total <= exported) return csv;
  const note = `已截斷：這個檔案只包含前 ${exported.toLocaleString("zh-TW")} 列，符合條件的共 ${total.toLocaleString("zh-TW")} 列。`;
  return `${csv}${csvField(note)}
`;
}

/**
 * Hand a CSV string to the browser as a download. Kept here rather than in the
 * component so the panels do not each repeat the Blob/anchor/revoke dance.
 */
export function downloadCsv(fileName: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}
