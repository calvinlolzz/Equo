import type { AdminOverviewSummary } from "./apiClient";

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

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";

  const date = new Date(ms);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}/${pad(date.getMonth() + 1)}/${pad(date.getDate())}`;
}
