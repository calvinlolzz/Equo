import type { ReactNode } from "react";
import { Download } from "lucide-react";
import type { EquoApiClient } from "./apiClient";
import { pageInfo } from "./adminDashboard";
import { ADMIN_PAGE_SIZE, type AdminRoute } from "./adminRoute";

/**
 * The pieces every list panel in the console shares: how a page is sized, how
 * an export walks the whole table, and the two controls that sit above and
 * below every table.
 *
 * Split out of AdminApp.tsx, which had grown to 4,733 lines - one file holding
 * nineteen panels, so every change to any of them was a change to all of them.
 */

export const PAGE_SIZE = ADMIN_PAGE_SIZE;

/** The server caps a list page at 100; exports walk pages at that size. */
export const EXPORT_PAGE_SIZE = 100;

/**
 * Hard stop on an export. Nothing here is meant to be a bulk data pipe, and a
 * runaway loop against a table that grew unexpectedly is the failure mode
 * worth preventing - the file says when it was truncated.
 */
export const EXPORT_MAX_ROWS = 5_000;

export type ExportPages<T> = {
  rows: T[];
  /** How many rows matched, which is not how many came back once the cap bites. */
  total: number;
  truncated: boolean;
};

/**
 * Walk a paginated admin list until everything (up to EXPORT_MAX_ROWS) is
 * collected. Exports have to cover the whole table, not the 20 rows on screen -
 * an export that silently matches the current page is worse than none, because
 * it looks complete.
 *
 * Which is exactly what the cap used to do: `total` was read on every page and
 * thrown away, so an export of a table with more rows than the cap came back as
 * a file that opened cleanly, had a header, had 5,000 rows, and was missing the
 * rest with nothing anywhere saying so. Reporting it is the caller's job now,
 * and every caller does it in two places - the filename and the last row.
 */
export async function fetchAllPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<{ total: number; rows: T[] }>,
): Promise<ExportPages<T>> {
  const collected: T[] = [];
  let total = 0;

  for (let offset = 0; offset < EXPORT_MAX_ROWS; offset += EXPORT_PAGE_SIZE) {
    const page = await fetchPage(offset, EXPORT_PAGE_SIZE);
    total = page.total;
    collected.push(...page.rows);
    if (page.rows.length === 0 || collected.length >= page.total) break;
  }

  const rows = collected.slice(0, EXPORT_MAX_ROWS);
  return { rows, total, truncated: total > rows.length };
}

/** What the panel says out loud after an export that could not fit. */
export function truncationNotice(exported: ExportPages<unknown>): string {
  if (!exported.truncated) return "";
  return `已匯出前 ${exported.rows.length.toLocaleString("zh-TW")} 列，符合條件的共 ${exported.total.toLocaleString("zh-TW")} 列。檔名與檔案最後一列都有註記。`;
}

export function todayKey(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The 匯出 CSV button every list panel shows above its table. */
export function ExportButton({ busy, onExport }: { busy: boolean; onExport: () => void }) {
  return (
    <button type="button" className="admin-export" disabled={busy} onClick={onExport}>
      <Download aria-hidden="true" size={14} />
      {busy ? "匯出中…" : "匯出 CSV"}
    </button>
  );
}

/**
 * What every list panel needs to read and change the address bar. The panels
 * are controlled by the URL rather than by their own state, so a reload, a
 * Back press and a pasted link all land on the same screen.
 */
/**
 * The caller's console role, threaded into the panels that offer writes.
 *
 * The server is still the enforcement point - every handler re-checks the rank
 * - but a button that only ever answers 403 is worse than no button, so the
 * panels hide what this account cannot do.
 */
export function canWrite(role: string | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function isConsoleOwner(role: string | undefined): boolean {
  return role === "owner";
}

export type PanelProps = {
  client: EquoApiClient;
  route: AdminRoute;
  onNavigate: (patch: Partial<AdminRoute>) => void;
  /** app_admins.role for the signed-in console user. */
  role?: string;
  /**
   * "Something I just did changed a backlog count." Re-reads the health
   * payload the sidebar badges and the overview inbox are drawn from, so
   * clearing the last piece of feedback empties its badge on the spot rather
   * than at the next full page load.
   */
  onCountsChanged?: () => void;
};

export type ListState<T> = {
  page: T | null;
  loading: boolean;
  error: string;
};

export function Pagination({
  info,
  total,
  onPrev,
  onNext,
}: {
  info: ReturnType<typeof pageInfo>;
  total: number;
  onPrev: () => void;
  onNext: () => void;
}) {
  return (
    <div className="admin-pagination">
      <span>
        {info.rangeStart}-{info.rangeEnd} / 共 {total.toLocaleString("zh-TW")} 筆
      </span>
      <div className="admin-pagination__actions">
        <button type="button" disabled={!info.hasPrev} onClick={onPrev}>
          上一頁
        </button>
        <span>
          {info.page} / {info.pageCount}
        </span>
        <button type="button" disabled={!info.hasNext} onClick={onNext}>
          下一頁
        </button>
      </div>
    </div>
  );
}
