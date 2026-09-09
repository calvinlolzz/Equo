import { ADMIN_AUDIT_ACTION_LABELS } from "./adminAuditActions";
import type {
  AdminGroupInvite,
  AdminExpenseRow,
  AdminHealthSummary,
  AdminOverviewSummary,
  AdminScanUsage,
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

/**
 * Spend, from millionths of a USD to something a person reads.
 *
 * The scale spans four orders of magnitude — one Haiku scan is US$0.0005 and a
 * busy month is a few dollars — so a fixed number of decimals is wrong at one
 * end or the other. Sub-cent totals get four decimals rather than rounding to
 * "$0.00", which would read as "this is free" when it is not.
 */
export function formatUsdMicros(micros: number): string {
  if (!Number.isFinite(micros) || micros <= 0) return "$0";
  const usd = micros / 1_000_000;
  if (usd < 0.01) return `$${usd.toFixed(4)}`;
  if (usd < 1) return `$${usd.toFixed(3)}`;
  return `$${usd.toFixed(2)}`;
}

/** Latency in the unit it is read in: milliseconds under a second, seconds above. */
export function formatLatency(ms: number | null): string {
  if (ms === null || !Number.isFinite(ms)) return "—";
  return ms < 1000 ? `${Math.round(ms)} ms` : `${(ms / 1000).toFixed(1)} s`;
}

/**
 * Share of scans that failed outright, as a percentage.
 *
 * Only 'failed' counts. An 'unrecognised' scan is the model working correctly
 * and reporting an unreadable photo — folding it in here would make a blurry
 * camera look like an outage.
 */
export function scanFailureRate(summary: AdminScanUsage["summary"]): number {
  return summary.scans === 0 ? 0 : Math.round((summary.failed / summary.scans) * 1000) / 10;
}

export type ScanUsageTile = {
  key: string;
  label: string;
  value: string;
  hint?: string;
  danger?: boolean;
};

/**
 * The scan panel's headline row.
 *
 * The failure tile turns red past 10%: below that a receipt endpoint is having
 * a normal day (photos are taken in restaurants, in the dark, at an angle);
 * above it something upstream is wrong and somebody should look.
 */
export function scanUsageTiles(usage: AdminScanUsage): ScanUsageTile[] {
  const { summary } = usage;
  const failureRate = scanFailureRate(summary);

  return [
    {
      key: "scans",
      label: "掃描次數",
      value: summary.scans.toLocaleString("zh-TW"),
      hint: `${summary.users} 位使用者`,
    },
    {
      key: "recognised",
      label: "成功辨識",
      value: summary.scans === 0 ? "—" : `${Math.round((summary.recognised / summary.scans) * 100)}%`,
      hint: `讀不出來 ${summary.unrecognised} 次`,
    },
    {
      key: "failed",
      label: "失敗率",
      value: summary.scans === 0 ? "—" : `${failureRate}%`,
      hint: `${summary.failed} 次呼叫失敗`,
      danger: failureRate > 10,
    },
    {
      key: "latency",
      label: "辨識耗時（中位數）",
      value: formatLatency(summary.p50_ms),
      hint: `p95 ${formatLatency(summary.p95_ms)}`,
    },
    {
      key: "cost",
      label: "估算花費",
      value: formatUsdMicros(summary.cost_micros),
      hint: `近 ${usage.days} 天`,
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
 * The nightly jobs the console EXPECTS to hear from, beyond the backup (which
 * gets its own richer tile).
 *
 * The expectation is the whole point. ops_heartbeats only has rows for jobs
 * that have run at least once, so a job that never ran — because a failed dump
 * aborted the workflow before reaching it, or because GitHub disabled the
 * schedule after 60 days of repo inactivity — is simply ABSENT from the data.
 * Listing what should be there turns that absence into a red tile instead of
 * nothing at all.
 *
 * Same 36-hour window as the backup: all of these fire at 02:30 daily, so a day
 * and a half means it stopped, not that it ran late.
 */
type ScheduledJob = {
  kind: string;
  label: string;
  /** One line of what it did last night, from the heartbeat's detail. */
  describe: (detail: Record<string, unknown>) => string;
  /** Ran, but not cleanly — worth a warn even when the timestamp is fresh. */
  degraded?: (detail: Record<string, unknown>) => boolean;
};

function count(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Sums every `deleted`/`logs_deleted` in the retention job's nested per-table results. */
function totalDeleted(detail: Record<string, unknown>): number {
  return Object.values(detail ?? {}).reduce<number>((total, entry) => {
    if (!entry || typeof entry !== "object") return total;
    const row = entry as Record<string, unknown>;
    return total + count(row.deleted) + count(row.logs_deleted) + count(row.status_rows_deleted);
  }, 0);
}

export const SCHEDULED_JOBS: readonly ScheduledJob[] = [
  {
    kind: "recurring_expenses",
    label: "循環支出",
    describe: (detail) => {
      const failed = count(detail?.failed);
      const created = count(detail?.created);
      // A failed rule is deactivated with its error stored, so it stops
      // producing expenses quietly. Say so here or nobody finds out.
      return failed > 0 ? `新增 ${created} 筆・${failed} 條規則失敗` : `上次新增 ${created} 筆`;
    },
    degraded: (detail) => count(detail?.failed) > 0,
  },
  {
    kind: "retention",
    label: "資料保留",
    describe: (detail) => {
      const deleted = totalDeleted(detail);
      return deleted > 0 ? `上次清理 ${deleted.toLocaleString("zh-TW")} 列` : "沒有到期的資料";
    },
  },
];

/**
 * An ABSENT `jobs` field and an EMPTY one mean opposite things, and conflating
 * them turns this whole feature into a false alarm.
 *
 *   undefined -> the API predates this field. It knows nothing about job
 *                heartbeats, so the console must say nothing about them.
 *   []        -> the API does report them and there are none. That is the real
 *                "never ran", and the thing worth shouting about.
 *
 * Same convention as `errors.open_groups`.
 */
/**
 * Push, whose failure mode is silence.
 *
 * Two tiles because they answer two different questions, and the second one is
 * the reason this exists at all:
 *
 *   送達    is push working? A failure rate over a fifth is a broken VAPID key
 *           or a push service having a bad day, not bad luck. Pruned endpoints
 *           are NOT failures — a reinstalled app is supposed to be dropped —
 *           so they sit in the hint rather than the rate.
 *   可通知的管理員  can the error alerting reach a human? An operator with no
 *           subscription makes alerting look healthy while it shouts into a
 *           void, which is strictly worse than having no alerting at all.
 *
 * Absent `push` means an API older than this field: render nothing rather than
 * invent a zero, the same rule as scheduledJobTiles.
 */
/**
 * What the current billing plan allows. Here rather than in SQL because it is a
 * property of the SUBSCRIPTION, not of the database — Postgres reports what is
 * used, this says what is permitted. Changing plan is one edit.
 *
 * Supabase Free, confirmed against the plan's own quota table.
 */
export const FREE_PLAN_LIMITS = {
  /** Exceeding this switches the database to READ-ONLY, not to a bigger bill. */
  databaseBytes: 500 * 1024 * 1024,
  storageBytes: 1024 * 1024 * 1024,
};

/**
 * Thresholds.
 *
 * Higher than they would be for a cost overrun, because these are cliffs with
 * a slow approach: usage grows with the ledger, so 70% is months of warning and
 * 85% is still time to delete or upgrade before writes start failing.
 */
const QUOTA_WARN_PCT = 70;
const QUOTA_BAD_PCT = 85;

function quotaTile(key: string, label: string, used: number, limit: number, hint: string): HealthTile {
  const pct = limit === 0 ? 0 : Math.round((used / limit) * 1000) / 10;

  return {
    key,
    label,
    value: `${pct}%`,
    hint: `${formatBytes(used)} / ${formatBytes(limit)}・${hint}`,
    tone: pct >= QUOTA_BAD_PCT ? "bad" : pct >= QUOTA_WARN_PCT ? "warn" : "ok",
  };
}

/**
 * How close the free plan's two hard limits are.
 *
 * The database one is the serious tile: at 500 MB Supabase switches the project
 * to read-only and the app stops accepting expenses. It is not a bill, it is an
 * outage with a bill's warning signs.
 */
export function quotaTiles(health: AdminHealthSummary): HealthTile[] {
  const quota = health.quota;

  if (!quota) return [];

  return [
    quotaTile(
      "quota_database",
      "資料庫用量",
      quota.database_bytes,
      FREE_PLAN_LIMITS.databaseBytes,
      // Said on the tile because the consequence is not obvious from a
      // percentage, and because deleting rows does not shrink it immediately.
      "超過會轉唯讀",
    ),
    quotaTile("quota_storage", "儲存空間用量", quota.storage_bytes, FREE_PLAN_LIMITS.storageBytes, "圖片"),
  ];
}

export function pushTiles(health: AdminHealthSummary): HealthTile[] {
  const push = health.push;

  if (!push) return [];

  const attempted = push.sent_7d + push.failed_7d;
  const failureRate = attempted === 0 ? 0 : Math.round((push.failed_7d / attempted) * 1000) / 10;
  const unreachable = push.admins - push.subscribed_admins;

  return [
    {
      key: "push_delivery",
      label: "推播送達（7 日）",
      value: attempted === 0 ? "—" : `${failureRate}%`,
      hint:
        attempted === 0
          ? `訂閱 ${push.subscriptions} 個裝置，近 7 日沒有推播`
          : `送出 ${push.sent_7d}・失敗 ${push.failed_7d}・清掉失效 ${push.pruned_7d}`,
      tone: attempted === 0 ? "ok" : failureRate > 20 ? "bad" : failureRate > 0 ? "warn" : "ok",
    },
    {
      key: "push_admins",
      label: "可通知的管理員",
      value: `${push.subscribed_admins}/${push.admins}`,
      hint:
        push.subscribed_admins === 0
          ? "沒有人收得到錯誤告警"
          : unreachable > 0
            ? `${unreachable} 位沒開推播`
            : "錯誤告警送得到",
      // Zero is the bad one: alerting that can reach nobody looks exactly like
      // a quiet week.
      tone: push.subscribed_admins === 0 ? "bad" : unreachable > 0 ? "warn" : "ok",
    },
  ];
}

/**
 * 循環支出 rules the nightly job switched off, ready to render.
 *
 * No tile: the job heartbeat already carries "N 條規則失敗", and a second
 * counter saying the same thing would be noise. What was missing is WHICH — so
 * this is the list, and on a good day it is empty and nothing renders.
 *
 * A rule the user paused themselves has no last_error and never appears here.
 */
export type BrokenRecurringRule = {
  id: string;
  title: string;
  groupId: string;
  groupName: string;
  error: string;
  lastRunAt: string | null;
};

export function brokenRecurringRules(health: AdminHealthSummary): BrokenRecurringRule[] {
  return (health.recurring?.broken_rules ?? []).map((rule) => ({
    id: rule.id,
    title: rule.title,
    groupId: rule.group_id,
    // A rule whose group was hard-deleted still deserves a readable row.
    groupName: rule.group_name?.trim() || "(群組已刪除)",
    error: rule.last_error?.trim() || "（沒有記錄原因）",
    lastRunAt: rule.last_run_at,
  }));
}

export function scheduledJobTiles(health: AdminHealthSummary, nowMs: number): HealthTile[] {
  const jobs = health.jobs;

  if (!jobs) return [];

  return SCHEDULED_JOBS.map((job) => {
    const beat = jobs.find((entry) => entry.kind === job.kind);
    const ageHours = beat ? (nowMs - Date.parse(beat.last_success_at)) / 3_600_000 : null;
    const degraded = beat ? Boolean(job.degraded?.(beat.detail)) : false;

    return {
      key: `job:${job.kind}`,
      label: job.label,
      value: beat ? describeLastSeen(beat.last_success_at, nowMs) : "從未",
      // "Never" is not "unknown": it means this job has not run once, which is
      // the state that used to be invisible.
      hint: beat ? job.describe(beat.detail) : "每日 02:30 排程，但從未回報",
      tone: ageHours === null ? "bad" : ageHours > BACKUP_STALE_HOURS ? "warn" : degraded ? "warn" : "ok",
    };
  });
}

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
    ...scheduledJobTiles(health, nowMs),
    ...pushTiles(health),
    ...quotaTiles(health),
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

  // Same undefined-vs-empty distinction as scheduledJobTiles: an API that does
  // not report heartbeats must not produce "never ran" alarms.
  for (const job of health.jobs ? SCHEDULED_JOBS : []) {
    const beat = health.jobs!.find((entry) => entry.kind === job.kind);
    const ageHours = beat ? (nowMs - Date.parse(beat.last_success_at)) / 3_600_000 : null;

    if (ageHours === null || ageHours > BACKUP_STALE_HOURS) {
      items.push({
        key: `job:${job.kind}`,
        label: ageHours === null ? `${job.label}從未執行` : `${job.label}排程已逾時`,
        count: null,
        // Fixed in GitHub Actions, like the backup - no tab to link to.
        route: null,
        tone: "bad",
      });
    } else if (job.degraded?.(beat!.detail)) {
      items.push({
        key: `job:${job.kind}:degraded`,
        label: `${job.label}有失敗的項目`,
        count: null,
        route: null,
        tone: "warn",
      });
    }
  }

  if (health.quota) {
    const pct = (health.quota.database_bytes / FREE_PLAN_LIMITS.databaseBytes) * 100;

    if (pct >= QUOTA_WARN_PCT) {
      items.push({
        key: "quota:database",
        label: pct >= QUOTA_BAD_PCT ? "資料庫快滿了，超過會轉唯讀" : "資料庫用量偏高",
        count: null,
        // Fixed by deleting data or upgrading the plan; neither is in here.
        route: null,
        tone: pct >= QUOTA_BAD_PCT ? "bad" : "warn",
      });
    }
  }

  const broken = health.recurring?.broken ?? 0;
  if (broken > 0) {
    items.push({
      key: "recurring:broken",
      label: "循環支出規則已停用",
      count: broken,
      // No tab to send them to - the list sits under the health card, because
      // acting on it means contacting the group, not clicking something here.
      route: null,
      tone: "warn",
    });
  }

  if (health.push && health.push.admins > 0 && health.push.subscribed_admins === 0) {
    items.push({
      key: "push:no_admin",
      label: "沒有管理員收得到錯誤告警",
      count: null,
      // Fixed by an admin enabling notifications on their own device.
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
  return ADMIN_AUDIT_ACTION_LABELS[action] ?? action;
}

/** {value,label} pairs for the audit action filter dropdown, same source of truth. */
export function auditActionOptions(): Array<{ value: string; label: string }> {
  return Object.entries(ADMIN_AUDIT_ACTION_LABELS).map(([value, label]) => ({ value, label }));
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

/**
 * Just the clock, for "how old is what I am looking at".
 *
 * Takes epoch millis rather than an ISO string: the caller is stamping its own
 * fetch, not rendering a value that came off a row, and there is no reason to
 * round-trip through a string to do that. Local time, like everything else in
 * the console — the operator and the browser are in the same place.
 */
export function formatClock(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";

  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}
