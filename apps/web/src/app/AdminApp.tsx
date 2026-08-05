import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Bug, Download, LayoutDashboard, MessageSquareText, ScrollText, Search, ShieldCheck, SlidersHorizontal, UsersRound, WalletCards } from "lucide-react";
import "./AdminApp.css";
import {
  createApiClient,
  type AdminAccountRow,
  type AdminAuditLogPage,
  type AdminErrorGroupPage,
  type AdminErrorGroupRow,
  type AdminErrorPage,
  type AdminExpenseMetaPatch,
  type AdminExpensePage,
  type AdminExpenseRow,
  type AdminFeedbackPage,
  type AdminGroupDetail,
  type AdminGroupFilterOption,
  type AdminGroupListPage,
  type AdminHealthSummary,
  type AdminMeSummary,
  type AdminOverviewSummary,
  type AdminReceiptScanSettings,
  type AdminStorageSummary,
  type AdminTrendsSummary,
  type AdminUserDetail,
  type AdminUserListPage,
  type AdminUserRow,
  type ApiClientError,
  type EquoApiClient,
} from "./apiClient";
import {
  adminCsvFileName,
  buildAdminExpensesCsv,
  buildAdminGroupsCsv,
  buildAdminUsersCsv,
  downloadCsv,
} from "./adminCsv";
import {
  auditActionLabel,
  auditActionOptions,
  auditTargetText,
  describeLastSeen,
  errorGroupStatusLabel,
  errorSourceLabel,
  expenseCategoryLabel,
  EXPENSE_CATEGORY_KEYS,
  expenseImageUrl,
  expenseKindLabel,
  formatDate,
  formatDateTime,
  formatExpenseAmount,
  healthTiles,
  inboxItems,
  inviteStatus,
  inviteStatusLabel,
  overviewTiles,
  pageInfo,
  payerSummary,
  shareTypeLabel,
  storageTiles,
  trendChart,
  TREND_METRICS,
  type TrendMetric,
} from "./adminDashboard";
import {
  ADMIN_PAGE_SIZE,
  ADMIN_TAB_LABELS,
  routeOffset,
  TREND_WINDOWS,
  type AdminRoute,
  type AdminTab,
} from "./adminRoute";
import { AdminCommandPalette } from "./AdminCommandPalette";
import { useAdminRoute } from "./useAdminRoute";
import { formatAmount } from "./formatAmount";
import { loadSession } from "./sessionStore";

const PAGE_SIZE = ADMIN_PAGE_SIZE;

/** The server caps a list page at 100; exports walk pages at that size. */
const EXPORT_PAGE_SIZE = 100;

/**
 * Hard stop on an export. Nothing here is meant to be a bulk data pipe, and a
 * runaway loop against a table that grew unexpectedly is the failure mode
 * worth preventing - the file says when it was truncated.
 */
const EXPORT_MAX_ROWS = 5_000;

/**
 * Walk a paginated admin list until everything (up to EXPORT_MAX_ROWS) is
 * collected. Exports have to cover the whole table, not the 20 rows on screen -
 * an export that silently matches the current page is worse than none, because
 * it looks complete.
 */
async function fetchAllPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<{ total: number; rows: T[] }>,
): Promise<T[]> {
  const collected: T[] = [];

  for (let offset = 0; offset < EXPORT_MAX_ROWS; offset += EXPORT_PAGE_SIZE) {
    const { total, rows } = await fetchPage(offset, EXPORT_PAGE_SIZE);
    collected.push(...rows);
    if (rows.length === 0 || collected.length >= total) break;
  }

  return collected.slice(0, EXPORT_MAX_ROWS);
}

function todayKey(): string {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** The 匯出 CSV button every list panel shows above its table. */
function ExportButton({ busy, onExport }: { busy: boolean; onExport: () => void }) {
  return (
    <button type="button" className="admin-export" disabled={busy} onClick={onExport}>
      <Download aria-hidden="true" size={14} />
      {busy ? "匯出中…" : "匯出 CSV"}
    </button>
  );
}

type AccessState = "checking" | "no-session" | "forbidden" | "error" | "ok";

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

type PanelProps = {
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

export function AdminApp() {
  const [session] = useState(() => loadSession());
  const [client] = useState<EquoApiClient | null>(() =>
    session ? createApiClient() : null,
  );
  const [access, setAccess] = useState<AccessState>(session ? "checking" : "no-session");
  const [me, setMe] = useState<AdminMeSummary | null>(null);
  const [route, navigate] = useAdminRoute();
  // Loaded once here rather than inside the overview, because the sidebar
  // badges need the same numbers and a second request for them would be the
  // same data twice.
  const [health, setHealth] = useState<AdminHealthSummary | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const reloadHealth = useCallback(() => {
    if (!client) return;
    client
      .adminHealth()
      .then(setHealth)
      .catch(() => {
        // Non-fatal: the console works without its badges.
      });
  }, [client]);

  useEffect(reloadHealth, [reloadHealth]);

  // ⌘K anywhere in the console, Ctrl+K off a Mac. Bound on the window rather
  // than a container so it works with focus anywhere, including inside a
  // panel's own search box.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPaletteOpen((open) => !open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  useEffect(() => {
    if (!client) return;
    let cancelled = false;

    client
      .adminMe()
      .then((result) => {
        if (cancelled) return;
        setMe(result);
        setAccess("ok");
      })
      .catch((error: ApiClientError) => {
        if (cancelled) return;
        setAccess(error.code === "ADMIN_FORBIDDEN" || error.code === "UNAUTHENTICATED" ? "forbidden" : "error");
      });

    return () => {
      cancelled = true;
    };
  }, [client]);

  if (access !== "ok" || !client) {
    return (
      <div className="admin-shell admin-shell--gate">
        <section className="admin-gate" aria-live="polite">
          <h1 className="admin-gate__brand">Equo 管理後台</h1>
          {access === "checking" && <p>確認權限中…</p>}
          {access === "no-session" && (
            <>
              <p>請先在主站登入你的 Google 帳號，再回到這個頁面。</p>
              <a className="admin-gate__link" href="/">
                前往登入
              </a>
            </>
          )}
          {access === "forbidden" && (
            <>
              <p>這個帳號沒有後台權限。</p>
              <a className="admin-gate__link" href="/">
                回到 Equo
              </a>
            </>
          )}
          {access === "error" && <p>權限確認失敗，請稍後重新整理再試。</p>}
        </section>
      </div>
    );
  }

  // A hand-typed ?tab=admins from a non-owner would render a panel whose every
  // request 403s. The server is still the enforcement point; this just keeps
  // the screen honest about what the account can reach.
  const tab: AdminTab = route.tab === "admins" && me?.role !== "owner" ? "overview" : route.tab;

  const navItems: Array<{ key: AdminTab; icon: typeof LayoutDashboard; badge?: number }> = [
    { key: "overview", icon: LayoutDashboard },
    { key: "users", icon: UsersRound },
    { key: "groups", icon: WalletCards },
    // The two tabs with a queue behind them carry their backlog in the nav, so
    // nobody has to open them to find out there is nothing to do.
    { key: "feedback", icon: MessageSquareText, badge: health?.feedback.open },
    { key: "errors", icon: Bug, badge: health?.errors.open_groups },
    { key: "audit", icon: ScrollText },
    { key: "settings", icon: SlidersHorizontal },
    // Managing admins is owner-only; the server enforces it too, this just
    // hides a tab that would 403 anyway.
    ...(me?.role === "owner" ? [{ key: "admins" as const, icon: ShieldCheck }] : []),
  ];

  return (
    <div className="admin-shell">
      <aside className="admin-sidebar">
        <div className="admin-sidebar__brand">
          <span className="admin-sidebar__logo" aria-hidden="true">
            E
          </span>
          <span className="admin-sidebar__brand-text">
            <strong>Equo</strong>
            <span>管理後台</span>
          </span>
        </div>

        <button className="admin-palette-trigger" type="button" onClick={() => setPaletteOpen(true)}>
          <Search aria-hidden="true" size={15} />
          <span>快速搜尋</span>
          <kbd>⌘K</kbd>
        </button>

        <nav className="admin-nav" aria-label="後台功能">
          <p className="admin-nav__section">平台</p>
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.key}
                type="button"
                className={tab === item.key ? "admin-nav__item admin-nav__item--active" : "admin-nav__item"}
                onClick={() => navigate({ tab: item.key })}
              >
                <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                <span>{ADMIN_TAB_LABELS[item.key]}</span>
                {item.badge ? <span className="admin-nav__badge">{item.badge > 99 ? "99+" : item.badge}</span> : null}
              </button>
            );
          })}
        </nav>

        <div className="admin-sidebar__footer">
          <span className="admin-sidebar__email" title={me?.user.email}>
            {me?.user.email}
          </span>
          <a href="/">回主站</a>
        </div>
      </aside>

      <main className="admin-main">
        {tab === "overview" && (
          <OverviewPanel client={client} route={route} onNavigate={navigate} health={health} />
        )}
        {tab === "users" && <UsersPanel client={client} route={route} onNavigate={navigate} role={me?.role} />}
        {tab === "groups" && <GroupsPanel client={client} route={route} onNavigate={navigate} role={me?.role} />}
        {tab === "feedback" && (
          <FeedbackPanel client={client} route={route} onNavigate={navigate} onCountsChanged={reloadHealth} />
        )}
        {tab === "errors" && (
          <ErrorsPanel client={client} route={route} onNavigate={navigate} onCountsChanged={reloadHealth} />
        )}
        {tab === "audit" && <AuditPanel client={client} route={route} onNavigate={navigate} />}
        {tab === "settings" && <SettingsPanel client={client} canEdit={me?.role === "owner" || me?.role === "admin"} />}
        {tab === "admins" && <AdminsPanel client={client} meUserId={me?.user.id ?? ""} />}
      </main>

      {paletteOpen && (
        <AdminCommandPalette
          client={client}
          canManageAdmins={me?.role === "owner"}
          onNavigate={navigate}
          onClose={() => setPaletteOpen(false)}
        />
      )}
    </div>
  );
}

/**
 * The growth chart: one metric, one window, drawn as a filled sparkline.
 *
 * Hand-rolled SVG rather than a charting library - this is four polylines over
 * at most 90 points, and a chart dependency would be most of the admin bundle.
 */
function TrendChartCard({ trends }: { trends: AdminTrendsSummary }) {
  const [metric, setMetric] = useState<TrendMetric>("expenses");
  const chart = useMemo(() => trendChart(trends.points, metric), [trends.points, metric]);

  return (
    <section className="admin-trend" aria-label="趨勢">
      <div className="admin-trend__head">
        <div className="admin-trend__chips" role="group" aria-label="趨勢指標">
          {TREND_METRICS.map((option) => (
            <button
              key={option.key}
              type="button"
              className={metric === option.key ? "admin-chip admin-chip--active" : "admin-chip"}
              aria-pressed={metric === option.key}
              onClick={() => setMetric(option.key)}
            >
              {option.label}
            </button>
          ))}
        </div>
        <p className="admin-trend__total">
          <strong>{chart.total.toLocaleString("zh-TW")}</strong>
          <span>{`／${trends.days} 日`}</span>
          {chart.changePct !== null && (
            <em className={chart.changePct < 0 ? "admin-delta admin-delta--down" : "admin-delta"}>
              {chart.changePct >= 0 ? `▲ ${chart.changePct}%` : `▼ ${Math.abs(chart.changePct)}%`}
            </em>
          )}
        </p>
      </div>

      <svg
        className="admin-trend__svg"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label={`${TREND_METRICS.find((option) => option.key === metric)?.label}趨勢，共 ${chart.total} 筆`}
      >
        <polygon className="admin-trend__area" points={`0,100 ${chart.polyline} 100,100`} />
        <polyline className="admin-trend__line" points={chart.polyline} />
      </svg>

      <div className="admin-trend__axis">
        <span>{chart.labels[0] ?? ""}</span>
        <span>{`峰值 ${chart.max.toLocaleString("zh-TW")}`}</span>
        <span>{chart.labels[chart.labels.length - 1] ?? ""}</span>
      </div>
    </section>
  );
}

function OverviewPanel({ client, route, onNavigate, health }: PanelProps & { health: AdminHealthSummary | null }) {
  const [overview, setOverview] = useState<AdminOverviewSummary | null>(null);
  const [storage, setStorage] = useState<AdminStorageSummary | null>(null);
  const [trends, setTrends] = useState<AdminTrendsSummary | null>(null);
  const trendDays = route.days;
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    client
      .adminOverview()
      .then((result) => {
        if (!cancelled) setOverview(result);
      })
      .catch(() => {
        if (!cancelled) setError("總覽載入失敗，請重新整理。");
      });
    // Storage, health and trends are supplementary: each loads separately so a
    // hiccup in one never blocks the core metrics. A failure leaves that
    // section out rather than blanking the page.
    client
      .adminStorage()
      .then((result) => {
        if (!cancelled) setStorage(result);
      })
      .catch(() => {
        /* non-fatal: overview still renders without the storage tiles */
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    let cancelled = false;
    client
      .adminTrends(trendDays)
      .then((result) => {
        if (!cancelled) setTrends(result);
      })
      .catch(() => {
        if (!cancelled) setTrends(null);
      });
    return () => {
      cancelled = true;
    };
  }, [client, trendDays]);

  if (error) return <p className="admin-error">{error}</p>;
  if (!overview) return <p className="admin-loading">載入中…</p>;

  const inbox = health ? inboxItems(health, Date.now()) : [];

  return (
    <section aria-label="總覽">
      {health && (
        <section className="admin-inbox" aria-label="今天要處理">
          <h3 className="admin-subheading">今天要處理</h3>
          {inbox.length === 0 ? (
            <p className="admin-inbox__clear">沒有待處理的事。</p>
          ) : (
            <ul className="admin-inbox__list">
              {inbox.map((item) => {
                const target = item.route;
                return (
                <li key={item.key}>
                  {target ? (
                    <button
                      type="button"
                      className={`admin-inbox__item admin-inbox__item--${item.tone}`}
                      onClick={() => onNavigate({ tab: target.tab, status: target.status })}
                    >
                      <span className="admin-inbox__count">{item.count}</span>
                      <span>{item.label}</span>
                    </button>
                  ) : (
                    <span className={`admin-inbox__item admin-inbox__item--${item.tone}`}>
                      <span>{item.label}</span>
                    </span>
                  )}
                </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      <div className="admin-tiles">
        {overviewTiles(overview).map((tile) => (
          <article key={tile.key} className="admin-tile">
            <p className="admin-tile__label">{tile.label}</p>
            <p className="admin-tile__value">{tile.value.toLocaleString("zh-TW")}</p>
            {tile.hint && <p className="admin-tile__hint">{tile.hint}</p>}
          </article>
        ))}
      </div>

      <div className="admin-subheading-row admin-subheading--spaced">
        <h3 className="admin-subheading">趨勢</h3>
        <div className="admin-trend__windows" role="group" aria-label="時間範圍">
          {TREND_WINDOWS.map((days) => (
            <button
              key={days}
              type="button"
              className={trendDays === days ? "admin-chip admin-chip--active" : "admin-chip"}
              aria-pressed={trendDays === days}
              onClick={() => onNavigate({ days })}
            >
              {`${days} 日`}
            </button>
          ))}
        </div>
      </div>
      {trends ? <TrendChartCard trends={trends} /> : <p className="admin-loading">載入中…</p>}

      {health && (
        <>
          <h3 className="admin-subheading admin-subheading--spaced">系統狀態</h3>
          <div className="admin-tiles">
            {healthTiles(health, Date.now()).map((tile) => (
              <article key={tile.key} className={`admin-tile admin-tile--${tile.tone}`}>
                <p className="admin-tile__label">
                  <span className={`admin-dot admin-dot--${tile.tone}`} aria-hidden="true" />
                  {tile.label}
                </p>
                <p className="admin-tile__value">{tile.value}</p>
                <p className="admin-tile__hint">{tile.hint}</p>
              </article>
            ))}
          </div>
        </>
      )}

      {storage && (
        <>
          <h3 className="admin-subheading admin-subheading--spaced">儲存空間</h3>
          <div className="admin-tiles">
            {storageTiles(storage).map((tile) => (
              <article
                key={tile.key}
                className={tile.danger ? "admin-tile admin-tile--danger" : "admin-tile"}
              >
                <p className="admin-tile__label">{tile.label}</p>
                <p className="admin-tile__value">{tile.value}</p>
                {tile.hint && <p className="admin-tile__hint">{tile.hint}</p>}
              </article>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

type ListState<T> = {
  page: T | null;
  loading: boolean;
  error: string;
};

function UsersPanel({ client, route, onNavigate, role }: PanelProps) {
  // The typing buffer is the one piece of list state that stays local - the URL
  // carries what was actually searched for, not every keystroke on the way
  // there. It re-syncs whenever the route changes underneath (Back, or a
  // pasted link).
  const [searchInput, setSearchInput] = useState(route.search);
  const search = route.search;
  const offset = routeOffset(route);
  const selectedUserId = route.userId;
  const [state, setState] = useState<ListState<AdminUserListPage>>({ page: null, loading: true, error: "" });
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setSearchInput(route.search);
  }, [route.search]);

  /** Exports every user matching the current search, not just this page. */
  async function exportUsers() {
    setExporting(true);
    try {
      const users = await fetchAllPages(async (offset, limit) => {
        const page = await client.adminListUsers({ search, limit, offset });
        return { total: page.total, rows: page.users };
      });
      downloadCsv(adminCsvFileName("使用者", todayKey()), buildAdminUsersCsv(users));
    } catch {
      setState((current) => ({ ...current, error: "匯出失敗，請稍後再試。" }));
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: "" }));
    client
      .adminListUsers({ search, limit: PAGE_SIZE, offset })
      .then((page) => {
        if (!cancelled) setState({ page, loading: false, error: "" });
      })
      .catch(() => {
        if (!cancelled) setState({ page: null, loading: false, error: "使用者列表載入失敗。" });
      });
    return () => {
      cancelled = true;
    };
  }, [client, search, offset]);

  if (selectedUserId) {
    return <UserDetailPanel client={client} route={route} onNavigate={onNavigate} role={role} />;
  }

  const now = Date.now();
  const info = state.page ? pageInfo(state.page.total, PAGE_SIZE, offset, state.page.users.length) : null;

  return (
    <section aria-label="使用者查詢">
      <form
        className="admin-search"
        onSubmit={(event) => {
          event.preventDefault();
          onNavigate({ search: searchInput.trim() });
        }}
      >
        <input
          type="search"
          value={searchInput}
          placeholder="搜尋 email 或名稱"
          onChange={(event) => setSearchInput(event.target.value)}
          aria-label="搜尋使用者"
        />
        <button type="submit">搜尋</button>
        <ExportButton busy={exporting} onExport={exportUsers} />
      </form>

      {state.error && <p className="admin-error">{state.error}</p>}
      {state.loading && <p className="admin-loading">載入中…</p>}

      {state.page && !state.loading && (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>使用者</th>
                  <th>Email</th>
                  <th className="admin-table__num">群組</th>
                  <th className="admin-table__num">支出筆數</th>
                  <th>最後活躍</th>
                  <th>加入時間</th>
                  <th>狀態</th>
                </tr>
              </thead>
              <tbody>
                {state.page.users.map((user) => (
                  <tr key={user.id} className="admin-table__row" onClick={() => onNavigate({ userId: user.id })}>
                    <td>{user.display_name || "—"}</td>
                    <td>{user.email}</td>
                    <td className="admin-table__num">{user.group_count}</td>
                    <td className="admin-table__num">{user.expense_count}</td>
                    <td>{describeLastSeen(user.last_seen_at, now)}</td>
                    <td>{formatDate(user.created_at)}</td>
                    <td>{user.disabled_at ? <span className="admin-badge admin-badge--danger">已停用</span> : "使用中"}</td>
                  </tr>
                ))}
                {state.page.users.length === 0 && (
                  <tr>
                    <td colSpan={7} className="admin-table__empty">
                      沒有符合的使用者
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {info && (
            <Pagination
              info={info}
              total={state.page.total}
              onPrev={() => onNavigate({ page: Math.max(route.page - 1, 1) })}
              onNext={() => onNavigate({ page: route.page + 1 })}
            />
          )}
        </>
      )}
    </section>
  );
}

function UserDetailPanel({ client, route, onNavigate, role }: PanelProps) {
  const userId = route.userId;
  const selectedGroupId = route.groupId;
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    client
      .adminUserDetail(userId)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch(() => {
        if (!cancelled) setError("使用者資料載入失敗。");
      });
    return () => {
      cancelled = true;
    };
  }, [client, userId]);

  async function toggleDisabled() {
    if (!detail) return;
    const disabling = !detail.user.disabled_at;
    const label = detail.user.display_name || detail.user.email;
    const confirmed = window.confirm(
      disabling
        ? `確定要停用「${label}」嗎？停用後該帳號無法登入，群組內的歷史帳目會保留。`
        : `確定要恢復「${label}」的帳號嗎？恢復後即可重新登入。`,
    );
    if (!confirmed) return;

    setActionBusy(true);
    try {
      const result = await client.adminSetUserDisabled(detail.user.id, disabling);
      setDetail({ ...detail, user: { ...detail.user, disabled_at: result.disabled_at } });
    } catch {
      setError(disabling ? "停用失敗，請稍後再試。" : "恢復失敗，請稍後再試。");
    } finally {
      setActionBusy(false);
    }
  }

  /**
   * The subject-access document, downloaded rather than rendered: it is an
   * answer to be forwarded to the person who asked for it, and no screen in the
   * console is a good place to read a year of somebody's ledger.
   */
  async function exportUser() {
    if (!detail) return;
    setActionBusy(true);
    setError("");
    try {
      const document = await client.adminExportUser(detail.user.id);
      const blob = new Blob([JSON.stringify(document, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const link = window.document.createElement("a");
      link.href = url;
      link.download = `equo-個資-${detail.user.email || detail.user.id}-${todayKey()}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setNotice("個資檔已下載，這次匯出已記入稽核紀錄。");
    } catch {
      setError("匯出失敗，請稍後再試。");
    } finally {
      setActionBusy(false);
    }
  }

  /**
   * The only irreversible action in the console, so it asks for the account's
   * email to be typed out. A confirm() dialog is muscle memory; typing the
   * address is not.
   */
  async function deleteAccount() {
    if (!detail) return;
    const typed = window.prompt(
      `刪除「${detail.user.email}」的帳號無法復原：個人資料會被清除，共用群組裡的帳目會保留成匿名成員。\n` +
        `確定的話，請輸入這個帳號的 email：`,
    );
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== detail.user.email.toLowerCase()) {
      setError("輸入的 email 不符，已取消刪除。");
      return;
    }

    setActionBusy(true);
    setError("");
    try {
      const result = await client.adminDeleteUser(detail.user.id);
      setNotice(
        `帳號已刪除：${result.groups_reassigned} 個群組換手、${result.groups_deleted} 個私人群組刪除、` +
          `${result.memberships_anonymized} 筆成員資料匿名化。`,
      );
      onNavigate({ userId: "" });
    } catch (caught) {
      setError((caught as ApiClientError).message || "刪除失敗，請稍後再試。");
    } finally {
      setActionBusy(false);
    }
  }

  if (selectedGroupId) {
    return (
      <GroupDetailPanel
        client={client}
        groupId={selectedGroupId}
        role={role}
        backLabel="回使用者詳情"
        onBack={() => onNavigate({ groupId: "" })}
      />
    );
  }

  return (
    <section aria-label="使用者詳情">
      <button type="button" className="admin-back" onClick={() => onNavigate({ userId: "" })}>
        ← 回使用者列表
      </button>

      {error && <p className="admin-error">{error}</p>}
      {!detail && !error && <p className="admin-loading">載入中…</p>}

      {detail && (
        <>
          <article className="admin-user-card">
            {detail.user.avatar_url ? (
              <img className="admin-user-card__avatar" src={detail.user.avatar_url} alt="" />
            ) : (
              <div className="admin-user-card__avatar admin-user-card__avatar--fallback" aria-hidden="true">
                {(detail.user.display_name || detail.user.email).slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="admin-user-card__body">
              <h2 className="admin-user-card__name">
                {detail.user.display_name || "—"}
                {detail.user.disabled_at && <span className="admin-badge admin-badge--danger">已停用</span>}
              </h2>
              <p className="admin-user-card__email">{detail.user.email}</p>
              <p className="admin-user-card__meta">
                加入 {formatDate(detail.user.created_at)}・最後活躍 {describeLastSeen(detail.user.last_seen_at, Date.now())}
                ・{detail.user.group_count} 個群組・{detail.user.expense_count} 筆支出
              </p>
            </div>
            <div className="admin-user-card__actions">
              <button
                type="button"
                className={detail.user.disabled_at ? "admin-action" : "admin-action admin-action--danger"}
                disabled={actionBusy}
                onClick={toggleDisabled}
              >
                {actionBusy ? "處理中…" : detail.user.disabled_at ? "恢復帳號" : "停用帳號"}
              </button>
              {canWrite(role) && (
                <button type="button" className="admin-action" disabled={actionBusy} onClick={exportUser}>
                  匯出個資 JSON
                </button>
              )}
              {isConsoleOwner(role) && (
                <button
                  type="button"
                  className="admin-action admin-action--danger"
                  disabled={actionBusy}
                  onClick={deleteAccount}
                >
                  刪除帳號
                </button>
              )}
            </div>
          </article>

          {notice && <p className="admin-notice">{notice}</p>}

          {isConsoleOwner(role) && <MergeAccountSection client={client} user={detail.user} onMerged={setNotice} />}

          <h3 className="admin-subheading">所屬群組</h3>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>群組</th>
                  <th>角色</th>
                  <th className="admin-table__num">成員</th>
                  <th className="admin-table__num">支出筆數</th>
                  <th className="admin-table__num">總支出</th>
                  <th>最後記帳</th>
                  <th>狀態</th>
                </tr>
              </thead>
              <tbody>
                {detail.groups.map((group) => (
                  <tr key={group.id} className="admin-table__row" onClick={() => onNavigate({ groupId: group.id })}>
                    <td>{group.name}</td>
                    <td>{group.role === "owner" ? "擁有者" : "成員"}</td>
                    <td className="admin-table__num">{group.member_count}</td>
                    <td className="admin-table__num">{group.expense_count}</td>
                    <td className="admin-table__num">{formatAmount(group.spend_total_minor, group.currency)}</td>
                    <td>{group.last_expense_at ? formatDate(group.last_expense_at) : "—"}</td>
                    <td>{group.archived_at ? "已封存" : group.member_status === "removed" ? "已退出" : "使用中"}</td>
                  </tr>
                ))}
                {detail.groups.length === 0 && (
                  <tr>
                    <td colSpan={7} className="admin-table__empty">
                      尚未加入任何群組
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}

/**
 * "One person, two accounts" - fold this account's memberships into another.
 *
 * The target is chosen by searching the user list rather than by pasting an id:
 * the person doing this knows the other account by its email, and a mistyped
 * uuid here would retire the wrong account.
 */
function MergeAccountSection({
  client,
  user,
  onMerged,
}: {
  client: EquoApiClient;
  user: AdminUserDetail["user"];
  onMerged: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [candidates, setCandidates] = useState<AdminUserRow[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflicts, setConflicts] = useState<Array<{ group_id: string; name: string }>>([]);

  async function runSearch(event: FormEvent) {
    event.preventDefault();
    if (!search.trim()) return;
    setSearching(true);
    setError("");
    try {
      const page = await client.adminListUsers({ search: search.trim(), limit: 10 });
      setCandidates(page.users.filter((candidate) => candidate.id !== user.id));
    } catch {
      setError("搜尋失敗，請稍後再試。");
    } finally {
      setSearching(false);
    }
  }

  async function merge(target: AdminUserRow) {
    const confirmed = window.confirm(
      `確定把「${user.email}」的所有群組成員身分轉到「${target.email}」嗎？\n` +
        `轉移後「${user.email}」會被停用，帳目本身不會移動（帳目掛在成員身分上）。`,
    );
    if (!confirmed) return;

    setBusy(true);
    setError("");
    setConflicts([]);
    try {
      const result = await client.adminMergeUsers(user.id, target.id);
      onMerged(
        `已把 ${result.memberships_moved} 筆成員身分轉到 ${target.email}` +
          `${result.groups_reowned > 0 ? `，並轉移 ${result.groups_reowned} 個群組的擁有者` : ""}。原帳號已停用。`,
      );
      setOpen(false);
      setCandidates([]);
      setSearch("");
    } catch (caught) {
      const failure = caught as ApiClientError;
      setError(failure.message || "合併失敗，請稍後再試。");
      // The refusal that has something to show: both accounts share a group,
      // and naming them is the difference between "merge failed" and a next
      // step somebody can take.
      const groups = failure.details?.groups;
      setConflicts(Array.isArray(groups) ? (groups as Array<{ group_id: string; name: string }>) : []);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="admin-merge">
        <button type="button" className="admin-action" onClick={() => setOpen(true)}>
          合併到另一個帳號…
        </button>
      </div>
    );
  }

  return (
    <section className="admin-merge admin-merge--open" aria-label="合併帳號">
      <h3 className="admin-subheading">合併帳號</h3>
      <p className="admin-modal__hint">
        找到這個人的另一個帳號，把「{user.email}」的群組成員身分整併過去。帳目掛在成員身分上，所以不會有金額變動。
      </p>

      <form className="admin-inline-form" onSubmit={runSearch}>
        <input
          className="admin-input"
          placeholder="用 email 或名稱搜尋要保留的帳號"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <button type="submit" className="admin-action" disabled={searching || !search.trim()}>
          {searching ? "搜尋中…" : "搜尋"}
        </button>
        <button type="button" className="admin-action" onClick={() => setOpen(false)}>
          取消
        </button>
      </form>

      {error && <p className="admin-error">{error}</p>}
      {conflicts.length > 0 && (
        <p className="admin-error">
          兩個帳號都在這些群組裡：{conflicts.map((group) => group.name).join("、")}。
          請先在其中一個群組移除其中一邊的成員身分，再合併。
        </p>
      )}

      {candidates.length > 0 && (
        <ul className="admin-merge__results">
          {candidates.map((candidate) => (
            <li key={candidate.id}>
              <span>
                <strong>{candidate.display_name || "—"}</strong> <span className="admin-muted">{candidate.email}</span>
              </span>
              <button type="button" className="admin-action" disabled={busy} onClick={() => merge(candidate)}>
                {busy ? "合併中…" : "合併到這個帳號"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Group drill-down: roster on top, the group's actual expenses below. Reached
 * from both the groups tab and a user's group list, so it takes an onBack
 * label rather than assuming which list it came from.
 */
function GroupDetailPanel({
  client,
  groupId,
  role,
  backLabel,
  onBack,
}: {
  client: EquoApiClient;
  groupId: string;
  role?: string;
  backLabel: string;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<AdminGroupDetail | null>(null);
  const [error, setError] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [transferTo, setTransferTo] = useState("");
  const [transferBusy, setTransferBusy] = useState(false);
  const [notice, setNotice] = useState("");

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError("");
    client
      .adminGroupDetail(groupId)
      .then((result) => {
        if (!cancelled) setDetail(result);
      })
      .catch(() => {
        if (!cancelled) setError("群組資料載入失敗。");
      });
    return () => {
      cancelled = true;
    };
  }, [client, groupId, reloadKey]);

  /**
   * Only a member with an account behind it can own the group - the RPC
   * refuses the rest, so they are never offered. Removed members stay eligible:
   * "the owner left" is exactly the case this is for, and re-owning a group to
   * someone who walked away is a decision for the person doing it.
   */
  const ownerCandidates = (detail?.members ?? []).filter(
    (member) => member.user_id !== null && member.role !== "owner",
  );

  async function transferOwner() {
    if (!detail || !transferTo) return;
    const member = detail.members.find((candidate) => candidate.id === transferTo);
    const confirmed = window.confirm(
      `確定把「${detail.group.name}」的擁有者換成「${member?.display_name || member?.email || "這位成員"}」嗎？` +
        `原擁有者會降為一般成員。`,
    );
    if (!confirmed) return;

    setTransferBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await client.adminTransferGroupOwner(detail.group.id, transferTo);
      setNotice(`已把擁有者轉移給 ${result.owner_display_name || "該成員"}。`);
      setTransferTo("");
      setReloadKey((key) => key + 1);
    } catch (caught) {
      setError((caught as ApiClientError).message || "轉移失敗，請稍後再試。");
    } finally {
      setTransferBusy(false);
    }
  }

  const now = Date.now();

  return (
    <section aria-label="群組詳情">
      <button type="button" className="admin-back" onClick={onBack}>
        ← {backLabel}
      </button>

      {error && <p className="admin-error">{error}</p>}
      {!detail && !error && <p className="admin-loading">載入中…</p>}

      {detail && (
        <>
          <article className="admin-group-card">
            {detail.group.cover_image_url ? (
              <img className="admin-group-card__cover" src={detail.group.cover_image_url} alt="" />
            ) : (
              <div className="admin-group-card__cover admin-group-card__cover--fallback" aria-hidden="true">
                {detail.group.name.slice(0, 1).toUpperCase()}
              </div>
            )}
            <div className="admin-group-card__body">
              <h2 className="admin-group-card__name">
                {detail.group.name}
                {detail.group.deleted_at && <span className="admin-badge admin-badge--danger">已刪除</span>}
                {!detail.group.deleted_at && detail.group.archived_at && <span className="admin-badge">已封存</span>}
              </h2>
              <p className="admin-group-card__meta">
                建立 {formatDate(detail.group.created_at)}・擁有者 {detail.group.owner_display_name ?? "—"}・
                {detail.group.member_count} 位成員・{detail.group.expense_count} 筆帳目・總支出{" "}
                {formatAmount(detail.group.spend_total_minor, detail.group.currency)}
              </p>
              <p className="admin-group-card__meta">
                最後記帳 {detail.group.last_expense_at ? formatDateTime(detail.group.last_expense_at) : "—"}・幣別{" "}
                {detail.group.currency}
              </p>
            </div>
          </article>

          {notice && <p className="admin-notice">{notice}</p>}

          <div className="admin-subheading-row">
            <h3 className="admin-subheading">成員</h3>
            {canWrite(role) && (
              <div className="admin-inline-form">
                <label className="admin-inline-form__label" htmlFor="admin-transfer-owner">
                  轉移擁有者
                </label>
                <select
                  id="admin-transfer-owner"
                  className="admin-select"
                  value={transferTo}
                  onChange={(event) => setTransferTo(event.target.value)}
                  disabled={transferBusy || ownerCandidates.length === 0}
                >
                  <option value="">
                    {ownerCandidates.length === 0 ? "沒有可接手的成員" : "選擇新的擁有者…"}
                  </option>
                  {ownerCandidates.map((member) => (
                    <option key={member.id} value={member.id}>
                      {member.display_name || member.email || member.id.slice(0, 8)}
                      {member.status === "removed" ? "（已退出）" : ""}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="admin-action"
                  disabled={transferBusy || !transferTo}
                  onClick={transferOwner}
                >
                  {transferBusy ? "轉移中…" : "轉移"}
                </button>
              </div>
            )}
          </div>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>成員</th>
                  <th>Email</th>
                  <th>角色</th>
                  <th>加入時間</th>
                  <th className="admin-table__num">記帳筆數</th>
                  <th className="admin-table__num">結餘</th>
                  <th>狀態</th>
                </tr>
              </thead>
              <tbody>
                {detail.members.map((member) => (
                  <tr key={member.id}>
                    <td>{member.display_name || "—"}</td>
                    <td>{member.email ?? <span className="admin-muted">未綁定帳號</span>}</td>
                    <td>{member.role === "owner" ? "擁有者" : "成員"}</td>
                    <td>{formatDate(member.joined_at)}</td>
                    <td className="admin-table__num">{member.expense_count}</td>
                    <td
                      className={
                        member.balance_minor < 0 ? "admin-table__num admin-amount--negative" : "admin-table__num"
                      }
                    >
                      {formatAmount(member.balance_minor, detail.group.currency)}
                    </td>
                    <td>{member.status === "removed" ? "已退出" : "使用中"}</td>
                  </tr>
                ))}
                {detail.members.length === 0 && (
                  <tr>
                    <td colSpan={7} className="admin-table__empty">
                      這個群組沒有成員
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <h3 className="admin-subheading admin-subheading--spaced">邀請碼</h3>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>狀態</th>
                  <th className="admin-table__num">使用</th>
                  <th>到期</th>
                  <th>建立者</th>
                  <th>建立時間</th>
                </tr>
              </thead>
              <tbody>
                {detail.invites.map((invite) => {
                  const status = inviteStatus(invite, now);
                  return (
                    <tr key={invite.id}>
                      <td>
                        <span
                          className={status === "live" ? "admin-badge admin-badge--ok" : "admin-badge"}
                        >
                          {inviteStatusLabel(status)}
                        </span>
                      </td>
                      <td className="admin-table__num">
                        {invite.use_count} / {invite.max_uses}
                      </td>
                      <td>{invite.expires_at ? formatDate(invite.expires_at) : "永久"}</td>
                      <td>{invite.created_by_name ?? "—"}</td>
                      <td>{formatDate(invite.created_at)}</td>
                    </tr>
                  );
                })}
                {detail.invites.length === 0 && (
                  <tr>
                    <td colSpan={5} className="admin-table__empty">
                      這個群組沒有邀請碼
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <GroupExpensesSection client={client} group={detail.group} role={role} />
        </>
      )}
    </section>
  );
}

function GroupExpensesSection({
  client,
  group,
  role,
}: {
  client: EquoApiClient;
  group: AdminGroupDetail["group"];
  role?: string;
}) {
  const [offset, setOffset] = useState(0);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [state, setState] = useState<ListState<AdminExpensePage>>({ page: null, loading: true, error: "" });
  const [selected, setSelected] = useState<AdminExpenseRow | null>(null);
  const [exporting, setExporting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  /** The group's whole ledger, honouring the 顯示已刪除 toggle. */
  async function exportExpenses() {
    setExporting(true);
    try {
      const expenses = await fetchAllPages(async (pageOffset, limit) => {
        const page = await client.adminListGroupExpenses(group.id, {
          limit,
          offset: pageOffset,
          includeDeleted,
        });
        return { total: page.total, rows: page.expenses };
      });
      downloadCsv(adminCsvFileName(`${group.name}-帳目`, todayKey()), buildAdminExpensesCsv(expenses));
    } catch {
      setState((current) => ({ ...current, error: "匯出失敗，請稍後再試。" }));
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: "" }));
    client
      .adminListGroupExpenses(group.id, { limit: PAGE_SIZE, offset, includeDeleted })
      .then((page) => {
        if (!cancelled) setState({ page, loading: false, error: "" });
      })
      .catch(() => {
        if (!cancelled) setState({ page: null, loading: false, error: "支出明細載入失敗。" });
      });
    return () => {
      cancelled = true;
    };
  }, [client, group.id, offset, includeDeleted, reloadKey]);

  const info = state.page ? pageInfo(state.page.total, PAGE_SIZE, offset, state.page.expenses.length) : null;

  return (
    <>
      <div className="admin-subheading-row">
        <h3 className="admin-subheading">帳目明細</h3>
        <label className="admin-toggle">
          <input
            type="checkbox"
            checked={includeDeleted}
            onChange={(event) => {
              setOffset(0);
              setIncludeDeleted(event.target.checked);
            }}
          />
          顯示已刪除（{group.deleted_expense_count} 筆）
        </label>
        <ExportButton busy={exporting} onExport={exportExpenses} />
      </div>

      {state.error && <p className="admin-error">{state.error}</p>}
      {state.loading && <p className="admin-loading">載入中…</p>}

      {state.page && !state.loading && (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>日期</th>
                  <th>項目</th>
                  <th>類型</th>
                  <th>分類</th>
                  <th className="admin-table__num">金額</th>
                  <th>付款</th>
                  <th className="admin-table__num">分攤人數</th>
                  <th>記錄者</th>
                  <th>照片</th>
                </tr>
              </thead>
              <tbody>
                {state.page.expenses.map((expense) => {
                  const image = expenseImageUrl(expense);
                  return (
                    <tr
                      key={expense.id}
                      className={
                        expense.deleted_at ? "admin-table__row admin-table__row--deleted" : "admin-table__row"
                      }
                      onClick={() => setSelected(expense)}
                    >
                      <td>{formatDate(expense.expense_date)}</td>
                      <td>
                        {expense.title}
                        {expense.deleted_at && <span className="admin-badge admin-badge--danger">已刪除</span>}
                      </td>
                      <td>{expenseKindLabel(expense.kind)}</td>
                      <td>{expense.kind === "transfer" ? "—" : expenseCategoryLabel(expense.category)}</td>
                      <td className="admin-table__num">
                        {formatExpenseAmount(expense.amount_minor, expense.currency)}
                      </td>
                      <td>
                        {expense.kind === "transfer"
                          ? `${payerSummary(expense.payers)} → ${expense.transfer_to_name ?? "—"}`
                          : payerSummary(expense.payers)}
                      </td>
                      <td className="admin-table__num">{expense.shares.length}</td>
                      <td>{expense.created_by_name ?? "—"}</td>
                      <td>
                        {image ? (
                          <img className="admin-thumb" src={image} alt="" loading="lazy" />
                        ) : (
                          <span className="admin-muted">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {state.page.expenses.length === 0 && (
                  <tr>
                    <td colSpan={9} className="admin-table__empty">
                      這個群組還沒有帳目
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {info && (
            <Pagination
              info={info}
              total={state.page.total}
              onPrev={() => setOffset(Math.max(offset - PAGE_SIZE, 0))}
              onNext={() => setOffset(offset + PAGE_SIZE)}
            />
          )}
        </>
      )}

      {selected && (
        <ExpenseDetailDialog
          client={client}
          groupId={group.id}
          expense={selected}
          groupCurrency={group.currency}
          canEdit={canWrite(role)}
          onClose={() => setSelected(null)}
          onChanged={() => {
            setSelected(null);
            setReloadKey((key) => key + 1);
          }}
        />
      )}
    </>
  );
}

function ExpenseDetailDialog({
  client,
  groupId,
  expense,
  groupCurrency,
  canEdit,
  onClose,
  onChanged,
}: {
  client: EquoApiClient;
  groupId: string;
  expense: AdminExpenseRow;
  groupCurrency: string;
  canEdit: boolean;
  onClose: () => void;
  /** A write landed; the caller re-reads the page rather than patching a row. */
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(expense.title);
  const [category, setCategory] = useState(expense.category);
  const [expenseDate, setExpenseDate] = useState(expense.expense_date.slice(0, 10));
  const [note, setNote] = useState(expense.note ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const image = expenseImageUrl(expense);
  /**
   * Only what actually differs is sent. An unchanged field left out of the
   * patch keeps the audit log's diff honest - it should say "the category
   * changed", not list every field the form happened to contain.
   */
  async function saveEdits() {
    const patch: AdminExpenseMetaPatch = {};
    if (title.trim() !== expense.title) patch.title = title.trim();
    if (category !== expense.category) patch.category = category;
    if (expenseDate !== expense.expense_date.slice(0, 10)) patch.expense_date = expenseDate;
    if (note !== (expense.note ?? "")) patch.note = note;

    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }

    setBusy(true);
    setError("");
    try {
      await client.adminUpdateExpenseMeta(groupId, expense.id, patch);
      onChanged();
    } catch (caught) {
      setError((caught as ApiClientError).message || "儲存失敗，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  async function toggleDeleted() {
    const deleting = !expense.deleted_at;
    const confirmed = window.confirm(
      deleting
        ? `確定要刪除「${expense.title}」嗎？這是軟刪除，之後可以在「顯示已刪除」裡復原，但所有成員的結餘會立刻改變。`
        : `確定要復原「${expense.title}」嗎？這筆帳會重新計入所有成員的結餘。`,
    );
    if (!confirmed) return;

    setBusy(true);
    setError("");
    try {
      await client.adminSetExpenseDeleted(groupId, expense.id, deleting);
      onChanged();
    } catch (caught) {
      setError((caught as ApiClientError).message || "操作失敗，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="admin-modal" role="dialog" aria-modal="true" aria-label="帳目明細" onClick={onClose}>
      <article className="admin-modal__panel" onClick={(event) => event.stopPropagation()}>
        <header className="admin-modal__header">
          <div>
            <h3 className="admin-modal__title">
              {expense.title}
              {expense.deleted_at && <span className="admin-badge admin-badge--danger">已刪除</span>}
            </h3>
            <p className="admin-modal__meta">
              {formatDate(expense.expense_date)}・{expenseKindLabel(expense.kind)}
              {expense.kind !== "transfer" && `・${expenseCategoryLabel(expense.category)}`}・
              {formatExpenseAmount(expense.amount_minor, expense.currency)}
              {expense.currency !== groupCurrency && `（群組幣別為 ${groupCurrency}）`}
            </p>
          </div>
          <button type="button" className="admin-modal__close" onClick={onClose} aria-label="關閉">
            ×
          </button>
        </header>

        {image && (
          <a className="admin-modal__image-link" href={image} target="_blank" rel="noreferrer">
            <img className="admin-modal__image" src={image} alt="帳目照片" />
          </a>
        )}

        {expense.note && <p className="admin-modal__note">{expense.note}</p>}

        <h4 className="admin-modal__subheading">付款</h4>
        <ul className="admin-split-list">
          {expense.payers.map((payer) => (
            <li key={payer.member_id}>
              <span>{payer.display_name || "—"}</span>
              <span>{formatAmount(payer.amount_minor, payer.currency)}</span>
            </li>
          ))}
          {expense.payers.length === 0 && <li className="admin-muted">沒有付款記錄</li>}
        </ul>

        {expense.kind === "transfer" ? (
          <p className="admin-modal__note">轉帳給 {expense.transfer_to_name ?? "—"}</p>
        ) : (
          <>
            <h4 className="admin-modal__subheading">分攤</h4>
            <ul className="admin-split-list">
              {expense.shares.map((share) => (
                <li key={share.member_id}>
                  <span>
                    {share.display_name || "—"}
                    <span className="admin-muted">
                      {" "}
                      {shareTypeLabel(share.share_type)}
                      {share.share_type === "percent" && share.share_value !== null && ` ${share.share_value}%`}
                    </span>
                  </span>
                  <span>{formatAmount(share.amount_minor, expense.currency)}</span>
                </li>
              ))}
              {expense.shares.length === 0 && <li className="admin-muted">沒有分攤記錄</li>}
            </ul>
          </>
        )}

        <p className="admin-modal__footer">
          建立者 {expense.created_by_name ?? "—"}・記錄於 {formatDateTime(expense.created_at)}・版本 {expense.version}
          {expense.deleted_at && `・刪除於 ${formatDateTime(expense.deleted_at)}`}
        </p>

        {error && <p className="admin-error">{error}</p>}

        {canEdit && !editing && (
          <div className="admin-modal__actions">
            <button type="button" className="admin-action" disabled={busy} onClick={() => setEditing(true)}>
              修改內容
            </button>
            <button
              type="button"
              className={expense.deleted_at ? "admin-action" : "admin-action admin-action--danger"}
              disabled={busy}
              onClick={toggleDeleted}
            >
              {busy ? "處理中…" : expense.deleted_at ? "復原這筆" : "刪除這筆"}
            </button>
          </div>
        )}

        {canEdit && editing && (
          <form
            className="admin-modal__edit"
            onSubmit={(event) => {
              event.preventDefault();
              void saveEdits();
            }}
          >
            {/*
              Only the descriptive fields. Amounts, payers and shares are a
              linked set — the API refuses to change one without the others,
              and a form that pretended otherwise would be the fastest way to
              unbalance somebody's group.
            */}
            <p className="admin-modal__hint">金額、付款人與分攤無法在後台修改，請讓成員自己在 app 內編輯。</p>
            <label className="admin-field">
              <span>項目</span>
              <input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={120} required />
            </label>
            <label className="admin-field">
              <span>分類</span>
              <select value={category} onChange={(event) => setCategory(event.target.value)}>
                {EXPENSE_CATEGORY_KEYS.map((key) => (
                  <option key={key} value={key}>
                    {expenseCategoryLabel(key)}
                  </option>
                ))}
                {/* A category from an older build stays selectable rather than
                    being silently rewritten to 其他 on the next save. */}
                {!EXPENSE_CATEGORY_KEYS.includes(expense.category) && (
                  <option value={expense.category}>{expense.category}</option>
                )}
              </select>
            </label>
            <label className="admin-field">
              <span>日期</span>
              <input type="date" value={expenseDate} onChange={(event) => setExpenseDate(event.target.value)} required />
            </label>
            <label className="admin-field">
              <span>備註</span>
              <textarea value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={500} />
            </label>
            <div className="admin-modal__actions">
              <button type="submit" className="admin-action admin-action--primary" disabled={busy}>
                {busy ? "儲存中…" : "儲存"}
              </button>
              <button
                type="button"
                className="admin-action"
                disabled={busy}
                onClick={() => {
                  setEditing(false);
                  setError("");
                  setTitle(expense.title);
                  setCategory(expense.category);
                  setExpenseDate(expense.expense_date.slice(0, 10));
                  setNote(expense.note ?? "");
                }}
              >
                取消
              </button>
            </div>
          </form>
        )}
      </article>
    </div>
  );
}

const GROUP_FILTER_CHIPS: Array<{ key: AdminGroupFilterOption; label: string }> = [
  { key: "all", label: "全部" },
  { key: "archived", label: "已封存" },
  { key: "empty", label: "空群組" },
  { key: "deleted", label: "已刪除" },
];

function groupStatusLabel(group: { archived_at: string | null; deleted_at: string | null }): string {
  if (group.deleted_at) return "已刪除";
  if (group.archived_at) return "已封存";
  return "使用中";
}

function GroupsPanel({ client, route, onNavigate, role }: PanelProps) {
  const [searchInput, setSearchInput] = useState(route.search);
  const search = route.search;
  const filter: AdminGroupFilterOption = route.filter;
  const offset = routeOffset(route);
  const selectedGroupId = route.groupId;
  const [state, setState] = useState<ListState<AdminGroupListPage>>({ page: null, loading: true, error: "" });
  const [busyGroupId, setBusyGroupId] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    setSearchInput(route.search);
  }, [route.search]);

  /** Exports every group matching the current search AND filter. */
  async function exportGroups() {
    setExporting(true);
    try {
      const groups = await fetchAllPages(async (pageOffset, limit) => {
        const page = await client.adminListGroups({ search, limit, offset: pageOffset, filter });
        return { total: page.total, rows: page.groups };
      });
      downloadCsv(adminCsvFileName("群組", todayKey()), buildAdminGroupsCsv(groups));
    } catch {
      setState((current) => ({ ...current, error: "匯出失敗，請稍後再試。" }));
    } finally {
      setExporting(false);
    }
  }

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: "" }));
    client
      .adminListGroups({ search, limit: PAGE_SIZE, offset, filter })
      .then((page) => {
        if (!cancelled) setState({ page, loading: false, error: "" });
      })
      .catch(() => {
        if (!cancelled) setState({ page: null, loading: false, error: "群組列表載入失敗。" });
      });
    return () => {
      cancelled = true;
    };
  }, [client, search, offset, filter, reloadKey]);

  async function runGroupAction(groupId: string, name: string, action: "archive" | "unarchive" | "delete" | "restore") {
    const confirmText: Record<typeof action, string> = {
      archive: `確定要封存「${name}」嗎？成員將無法再記帳，但資料保留。`,
      unarchive: `確定要解除封存「${name}」嗎？`,
      delete: `確定要刪除「${name}」嗎？群組會從所有成員的列表消失，之後可在「已刪除」檢視復原。`,
      restore: `確定要復原「${name}」嗎？群組會重新出現在成員的列表。`,
    };
    if (!window.confirm(confirmText[action])) return;

    setBusyGroupId(groupId);
    try {
      if (action === "archive" || action === "unarchive") {
        await client.adminSetGroupArchived(groupId, action === "archive");
      } else {
        await client.adminSetGroupDeleted(groupId, action === "delete");
      }
      setReloadKey((key) => key + 1);
    } catch {
      setState((current) => ({ ...current, error: "操作失敗，請稍後再試。" }));
    } finally {
      setBusyGroupId("");
    }
  }

  if (selectedGroupId) {
    return (
      <GroupDetailPanel
        client={client}
        groupId={selectedGroupId}
        role={role}
        backLabel="回群組列表"
        onBack={() => {
          onNavigate({ groupId: "" });
          // The detail's own actions don't write, but coming back from a group
          // that was archived/deleted elsewhere shouldn't show a stale row.
          setReloadKey((key) => key + 1);
        }}
      />
    );
  }

  const info = state.page ? pageInfo(state.page.total, PAGE_SIZE, offset, state.page.groups.length) : null;

  return (
    <section aria-label="群組查詢">
      <form
        className="admin-search"
        onSubmit={(event) => {
          event.preventDefault();
          onNavigate({ search: searchInput.trim() });
        }}
      >
        <input
          type="search"
          value={searchInput}
          placeholder="搜尋群組名稱"
          onChange={(event) => setSearchInput(event.target.value)}
          aria-label="搜尋群組"
        />
        <button type="submit">搜尋</button>
        <ExportButton busy={exporting} onExport={exportGroups} />
      </form>

      <div className="admin-chips" role="group" aria-label="群組篩選">
        {GROUP_FILTER_CHIPS.map((chip) => (
          <button
            key={chip.key}
            type="button"
            className={filter === chip.key ? "admin-chip admin-chip--active" : "admin-chip"}
            onClick={() => onNavigate({ filter: chip.key })}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {state.error && <p className="admin-error">{state.error}</p>}
      {state.loading && <p className="admin-loading">載入中…</p>}

      {state.page && !state.loading && (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>群組</th>
                  <th>擁有者</th>
                  <th className="admin-table__num">成員</th>
                  <th className="admin-table__num">支出筆數</th>
                  <th className="admin-table__num">總支出</th>
                  <th>最後記帳</th>
                  <th>建立時間</th>
                  <th>狀態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {state.page.groups.map((group) => {
                  const busy = busyGroupId === group.id;
                  return (
                    <tr key={group.id}>
                      <td>{group.name}</td>
                      <td>{group.owner_display_name ?? "—"}</td>
                      <td className="admin-table__num">{group.member_count}</td>
                      <td className="admin-table__num">{group.expense_count}</td>
                      <td className="admin-table__num">{formatAmount(group.spend_total_minor, group.currency)}</td>
                      <td>{group.last_expense_at ? formatDate(group.last_expense_at) : "—"}</td>
                      <td>{formatDate(group.created_at)}</td>
                      <td>
                        {group.deleted_at ? (
                          <span className="admin-badge admin-badge--danger">已刪除</span>
                        ) : (
                          groupStatusLabel(group)
                        )}
                      </td>
                      <td className="admin-table__actions">
                        <button type="button" className="admin-action" onClick={() => onNavigate({ groupId: group.id })}>
                          查看
                        </button>
                        {group.deleted_at ? (
                          <button
                            type="button"
                            className="admin-action"
                            disabled={busy}
                            onClick={() => runGroupAction(group.id, group.name, "restore")}
                          >
                            復原
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="admin-action"
                              disabled={busy}
                              onClick={() =>
                                runGroupAction(group.id, group.name, group.archived_at ? "unarchive" : "archive")
                              }
                            >
                              {group.archived_at ? "解封存" : "封存"}
                            </button>
                            <button
                              type="button"
                              className="admin-action admin-action--danger"
                              disabled={busy}
                              onClick={() => runGroupAction(group.id, group.name, "delete")}
                            >
                              刪除
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {state.page.groups.length === 0 && (
                  <tr>
                    <td colSpan={9} className="admin-table__empty">
                      沒有符合的群組
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {info && (
            <Pagination
              info={info}
              total={state.page.total}
              onPrev={() => onNavigate({ page: Math.max(route.page - 1, 1) })}
              onNext={() => onNavigate({ page: route.page + 1 })}
            />
          )}
        </>
      )}
    </section>
  );
}

const FEEDBACK_STATUS_CHIPS = [
  { key: "all", label: "全部" },
  { key: "new", label: "新進" },
  { key: "reviewing", label: "處理中" },
  { key: "done", label: "已完成" },
] as const;

const FEEDBACK_TYPE_LABELS: Record<string, string> = {
  problem: "問題",
  suggestion: "建議",
  confusing: "困惑",
  other: "其他",
};

const FEEDBACK_STATUS_LABELS: Record<string, string> = {
  new: "新進",
  reviewing: "處理中",
  done: "已完成",
};

function FeedbackPanel({ client, route, onNavigate, onCountsChanged }: PanelProps) {
  const statusFilter = route.status;
  const offset = routeOffset(route);
  const [state, setState] = useState<ListState<AdminFeedbackPage>>({ page: null, loading: true, error: "" });
  const [busyId, setBusyId] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: "" }));
    client
      .adminListFeedback({ limit: PAGE_SIZE, offset, status: statusFilter })
      .then((page) => {
        if (!cancelled) setState({ page, loading: false, error: "" });
      })
      .catch(() => {
        if (!cancelled) setState({ page: null, loading: false, error: "回饋列表載入失敗。" });
      });
    return () => {
      cancelled = true;
    };
  }, [client, offset, statusFilter, reloadKey]);

  async function updateStatus(feedbackId: string, status: string) {
    setBusyId(feedbackId);
    try {
      await client.adminSetFeedbackStatus(feedbackId, status);
      setReloadKey((key) => key + 1);
      onCountsChanged?.();
    } catch {
      setState((current) => ({ ...current, error: "狀態更新失敗，請稍後再試。" }));
    } finally {
      setBusyId("");
    }
  }

  const info = state.page ? pageInfo(state.page.total, PAGE_SIZE, offset, state.page.feedback.length) : null;

  return (
    <section aria-label="使用者回饋">
      <div className="admin-chips" role="group" aria-label="回饋狀態篩選">
        {FEEDBACK_STATUS_CHIPS.map((chip) => (
          <button
            key={chip.key}
            type="button"
            className={statusFilter === chip.key ? "admin-chip admin-chip--active" : "admin-chip"}
            onClick={() => onNavigate({ status: chip.key })}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {state.error && <p className="admin-error">{state.error}</p>}
      {state.loading && <p className="admin-loading">載入中…</p>}

      {state.page && !state.loading && (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>時間</th>
                  <th>使用者</th>
                  <th>類型</th>
                  <th>內容</th>
                  <th>狀態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {state.page.feedback.map((item) => {
                  const busy = busyId === item.id;
                  return (
                    <tr key={item.id}>
                      <td>{formatDateTime(item.created_at)}</td>
                      <td>{item.user_email ?? "—"}</td>
                      <td>{FEEDBACK_TYPE_LABELS[item.type] ?? item.type}</td>
                      <td className="admin-table__message" title={item.message}>
                        {item.message}
                      </td>
                      <td>{FEEDBACK_STATUS_LABELS[item.status] ?? item.status}</td>
                      <td className="admin-table__actions">
                        {item.status !== "reviewing" && item.status !== "done" && (
                          <button type="button" className="admin-action" disabled={busy} onClick={() => updateStatus(item.id, "reviewing")}>
                            處理中
                          </button>
                        )}
                        {item.status !== "done" && (
                          <button type="button" className="admin-action" disabled={busy} onClick={() => updateStatus(item.id, "done")}>
                            完成
                          </button>
                        )}
                        {item.status === "done" && (
                          <button type="button" className="admin-action" disabled={busy} onClick={() => updateStatus(item.id, "new")}>
                            重開
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {state.page.feedback.length === 0 && (
                  <tr>
                    <td colSpan={6} className="admin-table__empty">
                      尚無回饋
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {info && (
            <Pagination
              info={info}
              total={state.page.total}
              onPrev={() => onNavigate({ page: Math.max(route.page - 1, 1) })}
              onNext={() => onNavigate({ page: route.page + 1 })}
            />
          )}
        </>
      )}
    </section>
  );
}

const ERROR_STATUS_CHIPS = [
  { key: "all", label: "全部" },
  { key: "open", label: "未處理" },
  { key: "resolved", label: "已處理" },
] as const;

/**
 * Errors, collapsed.
 *
 * One row per distinct error rather than per occurrence: a single bad release
 * used to fill every page with the same message, which is exactly when the
 * page stops being read. The row carries the two numbers that decide whether
 * something matters - how often, and to how many people - and a status, so a
 * handled problem can be put away instead of scrolling forever.
 */
function ErrorsPanel({ client, route, onNavigate, onCountsChanged }: PanelProps) {
  const [searchInput, setSearchInput] = useState(route.search);
  const [state, setState] = useState<ListState<AdminErrorGroupPage>>({ page: null, loading: true, error: "" });
  const [busyFingerprint, setBusyFingerprint] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const offset = routeOffset(route);

  useEffect(() => {
    setSearchInput(route.search);
  }, [route.search]);

  useEffect(() => {
    // The drill-down owns the screen and fetches its own occurrences; loading
    // the grouped list behind it would be a wasted round-trip on every open.
    if (route.fingerprint) return;

    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: "" }));
    client
      .adminListErrorGroups({ search: route.search, status: route.status, limit: PAGE_SIZE, offset })
      .then((page) => {
        if (!cancelled) setState({ page, loading: false, error: "" });
      })
      .catch(() => {
        if (!cancelled) setState({ page: null, loading: false, error: "錯誤日誌載入失敗。" });
      });
    return () => {
      cancelled = true;
    };
  }, [client, route.search, route.status, route.fingerprint, offset, reloadKey]);

  async function updateStatus(group: AdminErrorGroupRow, status: "open" | "resolved") {
    setBusyFingerprint(group.fingerprint);
    try {
      await client.adminSetErrorGroupStatus(group.fingerprint, status);
      setReloadKey((key) => key + 1);
      onCountsChanged?.();
    } catch {
      setState((current) => ({ ...current, error: "狀態更新失敗，請稍後再試。" }));
    } finally {
      setBusyFingerprint("");
    }
  }

  if (route.fingerprint) {
    return (
      <ErrorGroupPanel
        client={client}
        fingerprint={route.fingerprint}
        onBack={() => onNavigate({ fingerprint: "" })}
      />
    );
  }

  const info = state.page ? pageInfo(state.page.total, PAGE_SIZE, offset, state.page.groups.length) : null;

  return (
    <section aria-label="錯誤日誌">
      <form
        className="admin-search"
        onSubmit={(event) => {
          event.preventDefault();
          onNavigate({ search: searchInput.trim() });
        }}
      >
        <input
          type="search"
          value={searchInput}
          placeholder="搜尋訊息、頁面或 email"
          onChange={(event) => setSearchInput(event.target.value)}
          aria-label="搜尋錯誤"
        />
        <button type="submit">搜尋</button>
      </form>

      <div className="admin-chips" role="group" aria-label="錯誤狀態篩選">
        {ERROR_STATUS_CHIPS.map((chip) => (
          <button
            key={chip.key}
            type="button"
            className={route.status === chip.key ? "admin-chip admin-chip--active" : "admin-chip"}
            onClick={() => onNavigate({ status: chip.key })}
          >
            {chip.label}
          </button>
        ))}
      </div>

      {state.error && <p className="admin-error">{state.error}</p>}
      {state.loading && <p className="admin-loading">載入中…</p>}

      {state.page && !state.loading && (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>錯誤</th>
                  <th>來源</th>
                  <th className="admin-table__num">次數</th>
                  <th className="admin-table__num">人數</th>
                  <th>首次</th>
                  <th>最近</th>
                  <th>狀態</th>
                  <th>操作</th>
                </tr>
              </thead>
              <tbody>
                {state.page.groups.map((group) => {
                  const busy = busyFingerprint === group.fingerprint;
                  return (
                    <tr key={group.fingerprint}>
                      <td className="admin-table__message" title={group.sample_message}>
                        {group.sample_message}
                        {group.last_page && <span className="admin-table__submeta">{group.last_page}</span>}
                      </td>
                      <td>{errorSourceLabel(group.source)}</td>
                      <td className="admin-table__num">{group.occurrences.toLocaleString("zh-TW")}</td>
                      <td className="admin-table__num">{group.user_count.toLocaleString("zh-TW")}</td>
                      <td>{formatDateTime(group.first_seen)}</td>
                      <td>{formatDateTime(group.last_seen)}</td>
                      <td>
                        {group.status === "resolved" ? (
                          <span className="admin-badge" title={group.status_updated_by ?? undefined}>
                            {errorGroupStatusLabel(group.status)}
                          </span>
                        ) : (
                          errorGroupStatusLabel(group.status)
                        )}
                      </td>
                      <td className="admin-table__actions">
                        <button
                          type="button"
                          className="admin-action"
                          onClick={() => onNavigate({ fingerprint: group.fingerprint })}
                        >
                          查看
                        </button>
                        {group.status === "resolved" ? (
                          <button
                            type="button"
                            className="admin-action"
                            disabled={busy}
                            onClick={() => updateStatus(group, "open")}
                          >
                            重開
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="admin-action"
                            disabled={busy}
                            onClick={() => updateStatus(group, "resolved")}
                          >
                            標記已處理
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {state.page.groups.length === 0 && (
                  <tr>
                    <td colSpan={8} className="admin-table__empty">
                      {route.search || route.status !== "all" ? "沒有符合的錯誤記錄" : "沒有錯誤記錄——很好！"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {info && (
            <Pagination
              info={info}
              total={state.page.total}
              onPrev={() => onNavigate({ page: Math.max(route.page - 1, 1) })}
              onNext={() => onNavigate({ page: route.page + 1 })}
            />
          )}
        </>
      )}
    </section>
  );
}

/**
 * The occurrences behind one group: the same flat list the console always had,
 * scoped to a single fingerprint. This is where the per-report detail lives -
 * who hit it, on which page, with what context.
 */
function ErrorGroupPanel({
  client,
  fingerprint,
  onBack,
}: {
  client: EquoApiClient;
  fingerprint: string;
  onBack: () => void;
}) {
  const [state, setState] = useState<ListState<AdminErrorPage>>({ page: null, loading: true, error: "" });
  const [offset, setOffset] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: "" }));
    client
      .adminListErrors({ fingerprint, limit: PAGE_SIZE, offset })
      .then((page) => {
        if (!cancelled) setState({ page, loading: false, error: "" });
      })
      .catch(() => {
        if (!cancelled) setState({ page: null, loading: false, error: "錯誤紀錄載入失敗。" });
      });
    return () => {
      cancelled = true;
    };
  }, [client, fingerprint, offset]);

  const info = state.page ? pageInfo(state.page.total, PAGE_SIZE, offset, state.page.errors.length) : null;
  const sample = state.page?.errors[0];

  return (
    <section aria-label="錯誤詳情">
      <button type="button" className="admin-back" onClick={onBack}>
        ← 回錯誤列表
      </button>

      {sample && (
        <article className="admin-error-card">
          <h2 className="admin-error-card__message">{sample.message}</h2>
          <p className="admin-error-card__meta">
            {errorSourceLabel(sample.source)}・共 {(state.page?.total ?? 0).toLocaleString("zh-TW")} 次
          </p>
        </article>
      )}

      {state.error && <p className="admin-error">{state.error}</p>}
      {state.loading && <p className="admin-loading">載入中…</p>}

      {state.page && !state.loading && (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>時間</th>
                  <th>使用者</th>
                  <th>訊息</th>
                  <th>內容</th>
                  <th>頁面</th>
                </tr>
              </thead>
              <tbody>
                {state.page.errors.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDateTime(item.created_at)}</td>
                    <td>{item.user_email ?? "—"}</td>
                    <td className="admin-table__message" title={item.message}>
                      {item.message}
                    </td>
                    <td className="admin-table__message" title={item.context ?? undefined}>
                      {item.context ?? "—"}
                    </td>
                    <td>{item.page ?? "—"}</td>
                  </tr>
                ))}
                {state.page.errors.length === 0 && (
                  <tr>
                    <td colSpan={5} className="admin-table__empty">
                      這個錯誤已經沒有紀錄了
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {info && (
            <Pagination
              info={info}
              total={state.page.total}
              onPrev={() => setOffset(Math.max(offset - PAGE_SIZE, 0))}
              onNext={() => setOffset(offset + PAGE_SIZE)}
            />
          )}
        </>
      )}
    </section>
  );
}

function AuditPanel({ client, route, onNavigate }: PanelProps) {
  const [searchInput, setSearchInput] = useState(route.search);
  const search = route.search;
  const action = route.action;
  const offset = routeOffset(route);
  const [state, setState] = useState<ListState<AdminAuditLogPage>>({ page: null, loading: true, error: "" });

  useEffect(() => {
    setSearchInput(route.search);
  }, [route.search]);

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: "" }));
    client
      .adminListAuditLogs({ search, action, limit: PAGE_SIZE, offset })
      .then((page) => {
        if (!cancelled) setState({ page, loading: false, error: "" });
      })
      .catch(() => {
        if (!cancelled) setState({ page: null, loading: false, error: "稽核記錄載入失敗。" });
      });
    return () => {
      cancelled = true;
    };
  }, [client, search, action, offset]);

  const info = state.page ? pageInfo(state.page.total, PAGE_SIZE, offset, state.page.logs.length) : null;

  return (
    <section aria-label="稽核記錄">
      <form
        className="admin-search"
        onSubmit={(event) => {
          event.preventDefault();
          onNavigate({ search: searchInput.trim() });
        }}
      >
        <input
          type="search"
          value={searchInput}
          placeholder="搜尋操作者或對象"
          onChange={(event) => setSearchInput(event.target.value)}
          aria-label="搜尋稽核記錄"
        />
        <select
          className="admin-select"
          value={action}
          aria-label="篩選動作"
          onChange={(event) => onNavigate({ action: event.target.value })}
        >
          <option value="">全部動作</option>
          {auditActionOptions().map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button type="submit">搜尋</button>
      </form>

      {state.error && <p className="admin-error">{state.error}</p>}
      {state.loading && <p className="admin-loading">載入中…</p>}

      {state.page && !state.loading && (
        <>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>時間</th>
                  <th>操作者</th>
                  <th>動作</th>
                  <th>對象</th>
                </tr>
              </thead>
              <tbody>
                {state.page.logs.map((log) => (
                  <tr key={log.id}>
                    <td>{formatDateTime(log.created_at)}</td>
                    <td>{log.admin_email ?? "—"}</td>
                    <td>{auditActionLabel(log.action)}</td>
                    <td>{auditTargetText(log.metadata)}</td>
                  </tr>
                ))}
                {state.page.logs.length === 0 && (
                  <tr>
                    <td colSpan={4} className="admin-table__empty">
                      {search || action ? "沒有符合的稽核記錄" : "尚無稽核記錄"}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {info && (
            <Pagination
              info={info}
              total={state.page.total}
              onPrev={() => onNavigate({ page: Math.max(route.page - 1, 1) })}
              onNext={() => onNavigate({ page: route.page + 1 })}
            />
          )}
        </>
      )}
    </section>
  );
}

const ADMIN_ROLE_OPTIONS = [
  { value: "owner", label: "擁有者" },
  { value: "admin", label: "管理員" },
  { value: "support", label: "客服" },
] as const;

function AdminsPanel({ client, meUserId }: { client: EquoApiClient; meUserId: string }) {
  const [admins, setAdmins] = useState<AdminAccountRow[] | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyUserId, setBusyUserId] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [addEmail, setAddEmail] = useState("");
  const [addRole, setAddRole] = useState<string>("support");
  const [addBusy, setAddBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setAdmins(null);
    setError("");
    client
      .adminListAdmins()
      .then((result) => {
        if (!cancelled) setAdmins(result.admins);
      })
      .catch(() => {
        if (!cancelled) setError("管理員列表載入失敗。");
      });
    return () => {
      cancelled = true;
    };
  }, [client, reloadKey]);

  function describeError(err: ApiClientError, fallback: string): string {
    if (err.code === "ADMIN_CONFLICT") return "無法移除或降級最後一位擁有者。";
    if (err.code === "ADMIN_NOT_FOUND") return "找不到對應的使用者，對方需先登入過 Equo。";
    if (err.code === "ADMIN_FORBIDDEN") return "只有擁有者能管理管理員。";
    return fallback;
  }

  async function changeRole(admin: AdminAccountRow, role: string) {
    if (role === admin.role || !admin.email) return;
    setBusyUserId(admin.user_id);
    setError("");
    setNotice("");
    try {
      await client.adminSetAdminRole(admin.email, role);
      setNotice(`已將 ${admin.email} 設為${ADMIN_ROLE_OPTIONS.find((o) => o.value === role)?.label ?? role}。`);
      setReloadKey((key) => key + 1);
    } catch (err) {
      setError(describeError(err as ApiClientError, "角色變更失敗，請稍後再試。"));
    } finally {
      setBusyUserId("");
    }
  }

  async function remove(admin: AdminAccountRow) {
    const label = admin.email || admin.display_name || admin.user_id;
    const selfWarning = admin.user_id === meUserId ? "\n\n注意：這會移除你自己的後台權限。" : "";
    if (!window.confirm(`確定要移除「${label}」的後台權限嗎？${selfWarning}`)) return;
    setBusyUserId(admin.user_id);
    setError("");
    setNotice("");
    try {
      await client.adminRemoveAdmin(admin.user_id);
      setNotice(`已移除 ${label} 的後台權限。`);
      setReloadKey((key) => key + 1);
    } catch (err) {
      setError(describeError(err as ApiClientError, "移除失敗，請稍後再試。"));
    } finally {
      setBusyUserId("");
    }
  }

  async function addAdmin(event: FormEvent) {
    event.preventDefault();
    const email = addEmail.trim();
    if (!email) return;
    setAddBusy(true);
    setError("");
    setNotice("");
    try {
      await client.adminSetAdminRole(email, addRole);
      setNotice(`已新增 ${email}。`);
      setAddEmail("");
      setReloadKey((key) => key + 1);
    } catch (err) {
      setError(describeError(err as ApiClientError, "新增失敗，請稍後再試。"));
    } finally {
      setAddBusy(false);
    }
  }

  return (
    <section aria-label="管理員">
      <form className="admin-search" onSubmit={addAdmin}>
        <input
          type="email"
          value={addEmail}
          placeholder="以 email 新增管理員"
          onChange={(event) => setAddEmail(event.target.value)}
          aria-label="新增管理員的 email"
        />
        <select
          className="admin-select"
          value={addRole}
          aria-label="新管理員角色"
          onChange={(event) => setAddRole(event.target.value)}
        >
          {ADMIN_ROLE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <button type="submit" disabled={addBusy}>
          {addBusy ? "新增中…" : "新增"}
        </button>
      </form>

      {error && <p className="admin-error">{error}</p>}
      {notice && <p className="admin-notice">{notice}</p>}
      {!admins && !error && <p className="admin-loading">載入中…</p>}

      {admins && (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>使用者</th>
                <th>Email</th>
                <th>角色</th>
                <th>加入時間</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {admins.map((admin) => {
                const busy = busyUserId === admin.user_id;
                return (
                  <tr key={admin.user_id}>
                    <td>
                      {admin.display_name || "—"}
                      {admin.user_id === meUserId && <span className="admin-badge">你</span>}
                    </td>
                    <td>{admin.email ?? <span className="admin-muted">未登入過</span>}</td>
                    <td>
                      <select
                        className="admin-select"
                        value={admin.role}
                        disabled={busy || !admin.email}
                        aria-label={`${admin.email ?? admin.user_id} 的角色`}
                        onChange={(event) => changeRole(admin, event.target.value)}
                      >
                        {ADMIN_ROLE_OPTIONS.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>{formatDate(admin.created_at)}</td>
                    <td className="admin-table__actions">
                      <button
                        type="button"
                        className="admin-action admin-action--danger"
                        disabled={busy}
                        onClick={() => remove(admin)}
                      >
                        移除
                      </button>
                    </td>
                  </tr>
                );
              })}
              {admins.length === 0 && (
                <tr>
                  <td colSpan={5} className="admin-table__empty">
                    尚無管理員
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function Pagination({
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

/**
 * Runtime settings an admin can change without a deploy.
 *
 * Only receipt recognition so far, and it is here rather than in an env var for
 * one reason: it is the only feature that costs money per call, so "stop it
 * now" has to be a thing somebody can do in seconds. Choosing the model is the
 * same switch and comes along for free.
 */
function SettingsPanel({ client, canEdit }: { client: EquoApiClient; canEdit: boolean }) {
  const [settings, setSettings] = useState<AdminReceiptScanSettings | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [model, setModel] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError("");
    client
      .adminGetReceiptScanSettings()
      .then((result) => {
        if (cancelled) return;
        setSettings(result);
        setEnabled(result.enabled);
        setModel(result.model);
      })
      .catch(() => {
        if (!cancelled) setError("設定載入失敗，可能是資料庫尚未套用 app_settings migration。");
      });
    return () => {
      cancelled = true;
    };
  }, [client]);

  // The saved state is the baseline, so re-selecting the original value clears
  // the dirty flag instead of leaving a Save button that would write nothing.
  const dirty = Boolean(settings) && (enabled !== settings?.enabled || model !== settings?.model);
  const selected = settings?.models.find((entry) => entry.id === model);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (!dirty || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const saved = await client.adminSetReceiptScanSettings(enabled, model);
      setSettings(saved);
      setEnabled(saved.enabled);
      setModel(saved.model);
      setNotice(saved.enabled ? `已儲存，目前使用 ${saved.model}。` : "已關閉收據辨識，使用者仍可附上照片。");
    } catch (err) {
      const code = (err as ApiClientError).code;
      setError(code === "ADMIN_FORBIDDEN" ? "只有管理員或擁有者能變更設定。" : "儲存失敗，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="設定">
      {error && <p className="admin-error">{error}</p>}
      {notice && <p className="admin-notice">{notice}</p>}
      {!settings && !error && <p className="admin-loading">載入中…</p>}

      {settings && (
        <form className="admin-settings-card" onSubmit={save}>
          <div className="admin-settings-head">
            <h2>收據辨識</h2>
            <p>
              使用者拍下收據後自動填入金額與店名。關閉後仍會把照片附在支出上，只是需要手動輸入金額。
            </p>
          </div>

          {/* A provider without a key makes every control below cosmetic, so
              say so rather than letting someone "turn on" a model that cannot
              run. Named per provider, because the env var to add differs. */}
          {!selected?.available && (
            <p className="admin-error">
              這個部署沒有設定 {selected?.provider === "google" ? "GEMINI_API_KEY" : "ANTHROPIC_API_KEY"}
              ，選定的模型無法運作。請先在 Vercel 環境變數加入後重新部署。
            </p>
          )}

          <label className="admin-settings-row">
            <input
              type="checkbox"
              checked={enabled}
              disabled={!canEdit || busy}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            <span>
              <strong>啟用收據辨識</strong>
              <small>成本異常時可立即關閉，不需重新部署。</small>
            </span>
          </label>

          <label className="admin-settings-row">
            <select
              className="admin-select"
              value={model}
              disabled={!canEdit || busy}
              aria-label="辨識模型"
              onChange={(event) => setModel(event.target.value)}
            >
              {settings.models.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.id}
                  {option.available ? "" : "（未設定金鑰）"}
                </option>
              ))}
            </select>
            <span>
              <strong>辨識模型</strong>
              <small>{selected?.note ?? "換模型後下一次掃描立即生效。"}</small>
            </span>
          </label>

          {selected?.provider === "google" && (
            <p className="admin-warning">
              <strong>Gemini 免費層會用你送出的內容訓練 Google 的模型，且真人可能閱讀。</strong>
              Google 條款明文寫著「請勿向免費服務提交敏感、機密或個人資訊」，而收據上有消費地點、時間、品項與卡號末四碼——那是使用者的個資，不是你的測試資料。
              隱私權政策第 3 節目前寫的是 Google Gemini 免費方案——換成別家或改用付費方案時，
              記得回去改那一段（<code>legalContent.ts</code>），否則政策會與實際不符。
            </p>
          )}

          <div className="admin-settings-foot">
            <span className="admin-muted">
              {settings.updated_at
                ? `最後變更：${formatDateTime(settings.updated_at)}${settings.updated_by_email ? `（${settings.updated_by_email}）` : ""}`
                : "尚未變更過，目前為預設值"}
            </span>
            {canEdit && (
              <button type="submit" disabled={!dirty || busy}>
                {busy ? "儲存中…" : "儲存"}
              </button>
            )}
          </div>
        </form>
      )}
    </section>
  );
}
