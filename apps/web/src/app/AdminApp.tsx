import { useEffect, useMemo, useState, type FormEvent } from "react";
import { Bug, Download, LayoutDashboard, MessageSquareText, ScrollText, ShieldCheck, UsersRound, WalletCards } from "lucide-react";
import "./AdminApp.css";
import {
  createApiClient,
  type AdminAccountRow,
  type AdminAuditLogPage,
  type AdminErrorGroupPage,
  type AdminErrorGroupRow,
  type AdminErrorPage,
  type AdminExpensePage,
  type AdminExpenseRow,
  type AdminFeedbackPage,
  type AdminGroupDetail,
  type AdminGroupFilterOption,
  type AdminGroupListPage,
  type AdminHealthSummary,
  type AdminMeSummary,
  type AdminOverviewSummary,
  type AdminStorageSummary,
  type AdminTrendsSummary,
  type AdminUserDetail,
  type AdminUserListPage,
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
  expenseImageUrl,
  expenseKindLabel,
  formatDate,
  formatDateTime,
  formatExpenseAmount,
  healthTiles,
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
  routeOffset,
  TREND_WINDOWS,
  type AdminRoute,
  type AdminTab,
} from "./adminRoute";
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
type PanelProps = {
  client: EquoApiClient;
  route: AdminRoute;
  onNavigate: (patch: Partial<AdminRoute>) => void;
};

export function AdminApp() {
  const [session] = useState(() => loadSession());
  const [client] = useState<EquoApiClient | null>(() =>
    session ? createApiClient() : null,
  );
  const [access, setAccess] = useState<AccessState>(session ? "checking" : "no-session");
  const [me, setMe] = useState<AdminMeSummary | null>(null);
  const [route, navigate] = useAdminRoute();

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

  const navItems: Array<{ key: AdminTab; label: string; icon: typeof LayoutDashboard }> = [
    { key: "overview", label: "總覽", icon: LayoutDashboard },
    { key: "users", label: "使用者", icon: UsersRound },
    { key: "groups", label: "群組", icon: WalletCards },
    { key: "feedback", label: "回饋", icon: MessageSquareText },
    { key: "errors", label: "錯誤", icon: Bug },
    { key: "audit", label: "稽核", icon: ScrollText },
    // Managing admins is owner-only; the server enforces it too, this just
    // hides a tab that would 403 anyway.
    ...(me?.role === "owner"
      ? [{ key: "admins" as const, label: "管理員", icon: ShieldCheck }]
      : []),
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
                <span>{item.label}</span>
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
        {tab === "overview" && <OverviewPanel client={client} route={route} onNavigate={navigate} />}
        {tab === "users" && <UsersPanel client={client} route={route} onNavigate={navigate} />}
        {tab === "groups" && <GroupsPanel client={client} route={route} onNavigate={navigate} />}
        {tab === "feedback" && <FeedbackPanel client={client} route={route} onNavigate={navigate} />}
        {tab === "errors" && <ErrorsPanel client={client} route={route} onNavigate={navigate} />}
        {tab === "audit" && <AuditPanel client={client} route={route} onNavigate={navigate} />}
        {tab === "admins" && <AdminsPanel client={client} meUserId={me?.user.id ?? ""} />}
      </main>
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

function OverviewPanel({ client, route, onNavigate }: PanelProps) {
  const [overview, setOverview] = useState<AdminOverviewSummary | null>(null);
  const [storage, setStorage] = useState<AdminStorageSummary | null>(null);
  const [trends, setTrends] = useState<AdminTrendsSummary | null>(null);
  const trendDays = route.days;
  const [health, setHealth] = useState<AdminHealthSummary | null>(null);
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
    client
      .adminHealth()
      .then((result) => {
        if (!cancelled) setHealth(result);
      })
      .catch(() => {
        /* non-fatal */
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

  return (
    <section aria-label="總覽">
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

function UsersPanel({ client, route, onNavigate }: PanelProps) {
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
    return <UserDetailPanel client={client} route={route} onNavigate={onNavigate} />;
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

function UserDetailPanel({ client, route, onNavigate }: PanelProps) {
  const userId = route.userId;
  const selectedGroupId = route.groupId;
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

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

  if (selectedGroupId) {
    return (
      <GroupDetailPanel
        client={client}
        groupId={selectedGroupId}
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
            <button
              type="button"
              className={detail.user.disabled_at ? "admin-action" : "admin-action admin-action--danger"}
              disabled={actionBusy}
              onClick={toggleDisabled}
            >
              {actionBusy ? "處理中…" : detail.user.disabled_at ? "恢復帳號" : "停用帳號"}
            </button>
          </article>

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
 * Group drill-down: roster on top, the group's actual expenses below. Reached
 * from both the groups tab and a user's group list, so it takes an onBack
 * label rather than assuming which list it came from.
 */
function GroupDetailPanel({
  client,
  groupId,
  backLabel,
  onBack,
}: {
  client: EquoApiClient;
  groupId: string;
  backLabel: string;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<AdminGroupDetail | null>(null);
  const [error, setError] = useState("");

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
  }, [client, groupId]);

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

          <h3 className="admin-subheading">成員</h3>
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

          <GroupExpensesSection client={client} group={detail.group} />
        </>
      )}
    </section>
  );
}

function GroupExpensesSection({
  client,
  group,
}: {
  client: EquoApiClient;
  group: AdminGroupDetail["group"];
}) {
  const [offset, setOffset] = useState(0);
  const [includeDeleted, setIncludeDeleted] = useState(false);
  const [state, setState] = useState<ListState<AdminExpensePage>>({ page: null, loading: true, error: "" });
  const [selected, setSelected] = useState<AdminExpenseRow | null>(null);
  const [exporting, setExporting] = useState(false);

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
  }, [client, group.id, offset, includeDeleted]);

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
          expense={selected}
          groupCurrency={group.currency}
          onClose={() => setSelected(null)}
        />
      )}
    </>
  );
}

function ExpenseDetailDialog({
  expense,
  groupCurrency,
  onClose,
}: {
  expense: AdminExpenseRow;
  groupCurrency: string;
  onClose: () => void;
}) {
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const image = expenseImageUrl(expense);

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

function GroupsPanel({ client, route, onNavigate }: PanelProps) {
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

function FeedbackPanel({ client, route, onNavigate }: PanelProps) {
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
function ErrorsPanel({ client, route, onNavigate }: PanelProps) {
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
