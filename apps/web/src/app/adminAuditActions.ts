/**
 * Every action that gets written to admin_audit_logs, and what it is called in
 * the console.
 *
 * One map, in one file, because there used to be two lists and neither was
 * right. The console had a label map of 22 actions; the API had its own
 * allowlist of 22 (a different 22 — it was missing the three admin.* ones the
 * console had). The database, which is the only list that actually decides what
 * gets written, had 31. So six actions were being recorded correctly and then
 * shown as a raw string like `user.view_as`, absent from the filter dropdown,
 * and — because normalizeAuditActionFilter silently turns an unrecognised
 * action into "" — a request to filter by one of them came back as the WHOLE
 * log rather than an error or an empty page. A filter that quietly answers a
 * different question is worse than one that is missing.
 *
 * The one that mattered most was 以使用者身分檢視. Its own migration says the
 * point of recording it is 「事後必須答得出來是誰、在什麼時候、看了誰」, and it
 * was the single action in the system that could not be filtered for.
 *
 * This module is deliberately a leaf: no imports, so the server can pull it in
 * without dragging the client's module graph (and its extensionless relative
 * imports) into Node's resolver. See scripts/check-api-esm-imports.py.
 *
 * ⚠️ Adding an audit action to a migration means adding it here too, or the
 * console cannot name it or filter for it. auditActionCoverage.test.ts reads
 * the migrations and fails if the two drift apart again.
 */
export const ADMIN_AUDIT_ACTION_LABELS: Record<string, string> = {
  "user.disable": "停用帳號",
  "user.enable": "恢復帳號",
  "user.merge": "合併帳號",
  "user.export": "匯出個資",
  "admin.export": "匯出 CSV",
  "user.delete": "刪除帳號",
  "user.view_as": "以使用者身分檢視",
  "group.archive": "封存群組",
  "group.unarchive": "解除封存",
  "group.delete": "刪除群組",
  "group.restore": "復原群組",
  "group.transfer_owner": "轉移群組擁有者",
  "group.view": "檢視群組帳目",
  "expense.update": "修改支出內容",
  "expense.delete": "刪除支出",
  "expense.restore": "復原支出",
  "error.status": "標記錯誤狀態",
  "notification.send": "發送通知",
  "notification.delete": "收回通知",
  "feedback.reply": "回覆意見",
  "feedback.status": "標記意見狀態",
  "catalog.category": "編輯分類",
  "catalog.currency": "編輯幣別",
  "catalog.rate_set": "設定匯率覆寫",
  "catalog.rate_clear": "清除匯率覆寫",
  "settings.auto_nudge": "變更自動催繳設定",
  "settings.receipt_scan.enable": "開啟收據辨識",
  "settings.receipt_scan.disable": "關閉收據辨識",
  "site_notice.set": "設定站台公告",
  "admin.grant": "新增管理員",
  "admin.role_change": "變更管理員角色",
  "admin.remove": "移除管理員",
};

/** The action keys, in the order the filter dropdown offers them. */
export const ADMIN_AUDIT_ACTIONS: readonly string[] = Object.keys(ADMIN_AUDIT_ACTION_LABELS);
