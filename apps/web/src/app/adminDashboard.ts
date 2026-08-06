import type {
  AdminGroupInvite,
  AdminExpenseRow,
  AdminHealthSummary,
  AdminOverviewSummary,
  AdminStorageSummary,
  AdminTrendPoint,
} from "./apiClient";
import { categoryLabel, categoryOptions } from "./catalog";
import { formatAmount } from "./formatAmount";
import { UI_TEXT } from "./uiText";

export type OverviewTile = {
  key: string;
  label: string;
  value: number;
  hint?: string;
};

export function overviewTiles(overview: AdminOverviewSummary): OverviewTile[] {
  return [
    { key: "users", label: "使用者", value: overview.user_count, hint: `近 7 日活躍 ${overview.active_users_7d}` },
    { key: "new_users", label: "新使用者（7 日）", value: overview.new_users_7d },
    { key: "groups", label: "群組", value: overview.group_count, hint: `近 7 日有記帳 ${overview.active_groups_7d}` },
    { key: "expenses", label: "支出筆數", value: overview.expense_count, hint: `近 7 日新增 ${overview.expenses_7d}` },
  ];
}

/**
 * Human-readable byte size for the storage tiles. Binary units (1024) to match
 * what Supabase's own dashboard reports, so the numbers reconcile. Caps at GB;
 * the bucket is nowhere near TB and a made-up unit would just read as a bug.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  // Whole numbers show no decimal (512 KB); fractional show one (1.4 MB).
  const rounded = value >= 10 || Number.isInteger(value) ? Math.round(value) : Math.round(value * 10) / 10;
  return `${rounded} ${units[exponent]}`;
}

export type StorageTile = {
  key: string;
  label: string;
  value: string;
  hint?: string;
  /** Orphans are only worth flagging (danger styling) when there are any. */
  danger?: boolean;
};

export function storageTiles(storage: AdminStorageSummary): StorageTile[] {
  return [
    { key: "objects", label: "圖片物件數", value: storage.object_count.toLocaleString("zh-TW") },
    { key: "size", label: "儲存總容量", value: formatBytes(storage.total_bytes) },
    {
      key: "orphans",
      label: "孤兒物件",
      value: storage.orphan_count.toLocaleString("zh-TW"),
      hint: storage.orphan_count > 0 ? `占用 ${formatBytes(storage.orphan_bytes)}` : "沒有未引用的圖片",
      danger: storage.orphan_count > 0,
    },
  ];
}

/** The trend metrics the overview chart can plot, in the order the chips show them. */
export const TREND_METRICS = [
  { key: "new_users", label: "新使用者" },
  { key: "active_users", label: "活躍使用者" },
  { key: "expenses", label: "記帳筆數" },
  { key: "new_groups", label: "新群組" },
] as const;

export type TrendMetric = (typeof TREND_METRICS)[number]["key"];

export type TrendChart = {
  values: number[];
  labels: string[];
  max: number;
  total: number;
  /**
   * Percent change of the most recent half of the window against the half
   * before it, rounded, or null when the earlier half is all zeros (there is
   * no meaningful "up 400%" from a base of nothing).
   */
  changePct: number | null;
  /** `x,y` pairs for an SVG polyline in a 100x100 viewBox, oldest first. */
  polyline: string;
};

/**
 * Turn a trend series into everything the chart needs to draw.
 *
 * The y-scale is pinned to 0 rather than to the minimum: a series wobbling
 * between 18 and 20 drawn min-to-max looks like a crisis, and the whole point
 * of the chart is to show real movement. A flat series sits on the mid-line
 * instead of collapsing onto the axis, so "nothing is happening" still reads
 * as a line.
 */
export function trendChart(points: AdminTrendPoint[], metric: TrendMetric): TrendChart {
  const values = points.map((point) => point[metric]);
  const labels = points.map((point) => point.day);
  const max = values.reduce((highest, value) => Math.max(highest, value), 0);
  const total = values.reduce((sum, value) => sum + value, 0);

  const half = Math.floor(values.length / 2);
  const earlier = values.slice(0, half).reduce((sum, value) => sum + value, 0);
  const recent = values.slice(half).reduce((sum, value) => sum + value, 0);
  const changePct = half === 0 || earlier === 0 ? null : Math.round(((recent - earlier) / earlier) * 100);

  const step = values.length > 1 ? 100 / (values.length - 1) : 0;
  const polyline = values
    .map((value, index) => {
      const x = values.length > 1 ? index * step : 50;
      const y = max === 0 ? 50 : 100 - (value / max) * 100;
      return `${round2(x)},${round2(y)}`;
    })
    .join(" ");

  return { values, labels, max, total, changePct, polyline };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export type HealthTile = {
  key: string;
  label: string;
  value: string;
  hint: string;
  /** "ok" | "warn" | "bad" - drives the dot colour, nothing else. */
  tone: "ok" | "warn" | "bad";
};

/** A backup older than this has probably stopped running, not just run late. */
const BACKUP_STALE_HOURS = 36;

/**
 * The ops card. Each tile answers one question that currently requires opening
 * a different dashboard: did last night's backup run, is the rate limiter
 * turning anyone away, is the app throwing errors, is feedback piling up.
 */
/**
 * Two different failures wear the same face in the app - either way recognition
 * just stops auto-filling and nobody reports it - so the tile has to say which
 * one it is: a missing key is fixed in Vercel, a switched-off feature here.
 */
function receiptScanTile(scan: NonNullable<AdminHealthSummary["receipt_scan"]>): HealthTile {
  if (!scan.configured) {
    return {
      key: "receipt_scan",
      label: "收據辨識",
      value: "未設定",
      hint: "缺 ANTHROPIC_API_KEY，只會附照片",
      tone: "warn",
    };
  }

  if (!scan.enabled) {
    return {
      key: "receipt_scan",
      label: "收據辨識",
      value: "已關閉",
      hint: "在「設定」分頁開啟",
      tone: "warn",
    };
  }

  return { key: "receipt_scan", label: "收據辨識", value: "已啟用", hint: scan.model, tone: "ok" };
}

export function healthTiles(health: AdminHealthSummary, nowMs: number): HealthTile[] {
  const backupAgeHours = health.backup ? (nowMs - Date.parse(health.backup.last_success_at)) / 3_600_000 : null;
  const backupBytes = Number(health.backup?.detail?.bytes ?? 0);

  return [
    {
      key: "backup",
      label: "最近備份",
      value: health.backup ? describeLastSeen(health.backup.last_success_at, nowMs) : "從未",
      hint: backupBytes > 0 ? formatBytes(backupBytes) : "每日 02:30 排程",
      // No heartbeat at all is not "unknown" - it means nothing has ever
      // confirmed a backup exists, which is the worst of the three states.
      tone: backupAgeHours === null ? "bad" : backupAgeHours > BACKUP_STALE_HOURS ? "warn" : "ok",
    },
    {
      key: "errors",
      label: "前端錯誤（24 小時）",
      value: health.errors.last_24h.toLocaleString("zh-TW"),
      hint: `7 日 ${health.errors.last_7d.toLocaleString("zh-TW")}`,
      tone: health.errors.last_24h === 0 ? "ok" : health.errors.last_24h < 10 ? "warn" : "bad",
    },
    {
      key: "rate_limit",
      label: "被限流（24 小時）",
      value: health.rate_limit.blocked_24h.toLocaleString("zh-TW"),
      hint: `目前計數中 ${health.rate_limit.active_buckets}`,
      tone: health.rate_limit.blocked_24h === 0 ? "ok" : "warn",
    },
    {
      key: "feedback",
      label: "未處理回饋",
      value: health.feedback.open.toLocaleString("zh-TW"),
      hint: health.feedback.open > 0 ? "在「回饋」分頁處理" : "都看完了",
      tone: health.feedback.open === 0 ? "ok" : "warn",
    },
    // Only tile that reports configuration rather than traffic. It earns the
    // space because an unset ANTHROPIC_API_KEY fails silently by design - the
    // app degrades to "photo only" and nobody files a bug - so this is the one
    // place the difference is visible.
    ...(health.receipt_scan ? [receiptScanTile(health.receipt_scan)] : []),
  ];
}

export type InboxItem = {
  key: string;
  label: string;
  /** How many of them, or null for a condition with no count (a stale backup). */
  count: number | null;
  /** Where to go to deal with it; null when there is nowhere in the console to go. */
  route: { tab: "feedback" | "errors"; status: string } | null;
  tone: "warn" | "bad";
};

/**
 * "What needs a person today", derived from the same health payload the tiles
 * use.
 *
 * The tiles answer "is everything fine" and are always all four present; this
 * answers "what do I do now" and is empty on a good day - which is the point.
 * Nothing here is new data: it is the difference between a dashboard you read
 * and a list you work through.
 */
export function inboxItems(health: AdminHealthSummary, nowMs: number): InboxItem[] {
  const items: InboxItem[] = [];

  if (health.feedback.open > 0) {
    items.push({
      key: "feedback",
      label: "未處理回饋",
      count: health.feedback.open,
      route: { tab: "feedback", status: "new" },
      tone: "warn",
    });
  }

  const openErrorGroups = health.errors.open_groups ?? 0;
  if (openErrorGroups > 0) {
    items.push({
      key: "errors",
      label: "未處理錯誤",
      count: openErrorGroups,
      // Distinct errors, not occurrences: ten of one bug is one thing to fix.
      route: { tab: "errors", status: "open" },
      tone: openErrorGroups >= 5 ? "bad" : "warn",
    });
  }

  const backupAgeHours = health.backup ? (nowMs - Date.parse(health.backup.last_success_at)) / 3_600_000 : null;
  if (backupAgeHours === null || backupAgeHours > BACKUP_STALE_HOURS) {
    items.push({
      key: "backup",
      label: backupAgeHours === null ? "從未成功備份" : "備份已逾時",
      count: null,
      // Fixed in GitHub Actions, not in here - so no link to a tab that cannot
      // do anything about it.
      route: null,
      tone: "bad",
    });
  }

  return items;
}

export type PageInfo = {
  page: number;
  pageCount: number;
  hasPrev: boolean;
  hasNext: boolean;
  /** 1-based display range, e.g. 21-40；total 0 時兩者皆 0。 */
  rangeStart: number;
  rangeEnd: number;
};

export function pageInfo(total: number, limit: number, offset: number, itemsOnPage: number): PageInfo {
  const safeTotal = Math.max(total, 0);
  const safeLimit = Math.max(limit, 1);
  const safeOffset = Math.max(offset, 0);
  const pageCount = Math.max(Math.ceil(safeTotal / safeLimit), 1);
  const page = Math.min(Math.floor(safeOffset / safeLimit) + 1, pageCount);
  const rangeStart = safeTotal === 0 ? 0 : safeOffset + 1;
  const rangeEnd = safeTotal === 0 ? 0 : Math.min(safeOffset + itemsOnPage, safeTotal);

  return {
    page,
    pageCount,
    hasPrev: safeOffset > 0,
    hasNext: safeOffset + safeLimit < safeTotal,
    rangeStart,
    rangeEnd,
  };
}

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * Compact zh-TW "how long ago" label for list rows. Falls back to the
 * absolute date beyond 30 days because "245 天前" reads worse than a date.
 * Invalid timestamps render as "—" instead of NaN text.
 */
export function describeLastSeen(iso: string, nowMs: number): string {
  const thenMs = Date.parse(iso);

  if (Number.isNaN(thenMs)) {
    return "—";
  }

  const diff = nowMs - thenMs;

  if (diff < MINUTE_MS) return "剛剛";
  if (diff < HOUR_MS) return `${Math.floor(diff / MINUTE_MS)} 分鐘前`;
  if (diff < DAY_MS) return `${Math.floor(diff / HOUR_MS)} 小時前`;
  if (diff < 30 * DAY_MS) return `${Math.floor(diff / DAY_MS)} 天前`;

  return formatDate(iso);
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  "user.disable": "停用帳號",
  "user.enable": "恢復帳號",
  "user.merge": "合併帳號",
  "user.export": "匯出個資",
  "user.delete": "刪除帳號",
  "group.archive": "封存群組",
  "group.unarchive": "解除封存",
  "group.delete": "刪除群組",
  "group.restore": "復原群組",
  "group.transfer_owner": "轉移群組擁有者",
  "group.view": "檢視群組帳目",
  "expense.update": "修改支出內容",
  "expense.delete": "刪除支出",
  "expense.restore": "復原支出",
  "notification.send": "發送通知",
  "notification.delete": "收回通知",
  "feedback.reply": "回覆意見",
  "catalog.category": "編輯分類",
  "catalog.currency": "編輯幣別",
  "catalog.rate_set": "設定匯率覆寫",
  "catalog.rate_clear": "清除匯率覆寫",
  "admin.grant": "新增管理員",
  "admin.role_change": "變更管理員角色",
  "admin.remove": "移除管理員",
  "error.status": "標記錯誤狀態",
};

const ERROR_GROUP_STATUS_LABELS: Record<string, string> = {
  open: "未處理",
  resolved: "已處理",
};

/** zh-TW label for an app_error_group_status.status; unknown values pass through raw. */
export function errorGroupStatusLabel(status: string): string {
  return ERROR_GROUP_STATUS_LABELS[status] ?? status;
}

/** Where a report came from. Only the two the check constraint allows exist. */
export function errorSourceLabel(source: string): string {
  return source === "admin" ? "後台" : "前台";
}

const ADMIN_ROLE_LABELS: Record<string, string> = {
  owner: "擁有者",
  admin: "管理員",
  support: "客服",
};

/** zh-TW label for an app_admins.role; unknown roles pass through raw. */
export function adminRoleLabel(role: string): string {
  return ADMIN_ROLE_LABELS[role] ?? role;
}

/** zh-TW label for an admin_audit_logs action; unknown actions pass through raw. */
export function auditActionLabel(action: string): string {
  return AUDIT_ACTION_LABELS[action] ?? action;
}

/** {value,label} pairs for the audit action filter dropdown, same source of truth. */
export function auditActionOptions(): Array<{ value: string; label: string }> {
  return Object.entries(AUDIT_ACTION_LABELS).map(([value, label]) => ({ value, label }));
}

/** Human-readable target from an audit row's metadata (group name or user email). */
export function auditTargetText(metadata: Record<string, unknown>): string {
  const name = metadata.name ?? metadata.email;
  return typeof name === "string" && name ? name : "—";
}

export type InviteStatus = "revoked" | "expired" | "used_up" | "live";

/**
 * An invite's effective state, checked in priority order: an explicit revoke
 * wins, then expiry, then exhausted uses; anything left is still joinable.
 * `nowMs` is passed in (not read from the clock) so the rule is deterministic
 * in tests. use_count >= max_uses counts as used up - accept_invite increments
 * on join, so an equal count means the last seat was taken.
 */
export function inviteStatus(invite: AdminGroupInvite, nowMs: number): InviteStatus {
  if (invite.revoked_at) return "revoked";
  const expiresMs = invite.expires_at ? Date.parse(invite.expires_at) : Number.NaN;
  if (!Number.isNaN(expiresMs) && expiresMs <= nowMs) return "expired";
  if (invite.use_count >= invite.max_uses) return "used_up";
  return "live";
}

const INVITE_STATUS_LABELS: Record<InviteStatus, string> = {
  live: "有效",
  revoked: "已撤銷",
  expired: "已過期",
  used_up: "已用完",
};

export function inviteStatusLabel(status: InviteStatus): string {
  return INVITE_STATUS_LABELS[status];
}

/**
 * zh-TW label for expenses.kind; unknown kinds pass through raw. The app's
 * composer already names these three kinds, so reuse its dictionary rather
 * than keeping a second copy that can drift.
 */
export function expenseKindLabel(kind: string): string {
  return (UI_TEXT.composerModes as Record<string, string>)[kind] ?? kind;
}

/** Reads the same catalog the app does, so a category added in the console shows up here too. */
export function expenseCategoryLabel(category: string): string {
  return categoryLabel(category);
}

/** The category keys the console offers when correcting an expense. */
export function expenseCategoryKeys(): string[] {
  return categoryOptions().map((entry) => entry.key);
}

const SHARE_TYPE_LABELS: Record<string, string> = {
  equal: "均分",
  fixed: "固定金額",
  percent: "百分比",
};

export function shareTypeLabel(shareType: string): string {
  return SHARE_TYPE_LABELS[shareType] ?? shareType;
}

/**
 * The photo to show for an expense. image_url is what the current composer
 * writes; receipt_image_url is the older FloatPay-era column that some rows
 * still carry, so fall back to it rather than showing "no photo" for them.
 */
export function expenseImageUrl(expense: Pick<AdminExpenseRow, "image_url" | "receipt_image_url">): string | null {
  return expense.image_url || expense.receipt_image_url || null;
}

/**
 * expenses.amount_minor is nullable: FloatPay-era rows carry only the legacy
 * numeric `amount`. Rendering those as $0 would state a wrong number, so they
 * render as "—" instead - an admin looking at a billing dispute needs to see
 * "no amount recorded", not a confident zero.
 */
export function formatExpenseAmount(amountMinor: number | null, currency: string): string {
  if (amountMinor === null) return "—";
  return formatAmount(amountMinor, currency);
}

/**
 * One-line "who paid" summary for a list row. Multi-payer expenses are common
 * enough that naming only the first payer would be misleading, so they collapse
 * to a count instead.
 */
export function payerSummary(payers: AdminExpenseRow["payers"]): string {
  if (payers.length === 0) return "—";
  if (payers.length === 1) return payers[0].display_name || "—";
  return `${payers.length} 人分攤付款`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";

  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";

  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}
