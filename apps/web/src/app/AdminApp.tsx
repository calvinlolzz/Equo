import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Bug, Download, LayoutDashboard, Megaphone, MessageSquareText, RefreshCw, ScrollText, Search, ShieldCheck, SlidersHorizontal, UsersRound, WalletCards } from "lucide-react";
import "./AdminApp.css";
import {
  createApiClient,
  type AdminAccountRow,
  type AdminAuditLogPage,
  type AdminCatalogCategoryRow,
  type AdminCatalogCurrencyRow,
  type AdminCatalogPayload,
  type AdminErrorGroupPage,
  type AdminErrorGroupRow,
  type AdminErrorPage,
  type AdminExpenseMetaPatch,
  type AdminExpensePage,
  type AdminExpenseRow,
  type AdminFeedbackPage,
  type AdminGroupDetail,
  type AdminGroupFilterOption,
  type AdminAutoNudgeSettings,
  type AdminRetention,
  type SiteNoticeResponse,
  type AdminGroupListPage,
  type AdminHealthSummary,
  type AdminMeSummary,
  type AdminNotificationAudienceOption,
  type AdminSentNotificationPage,
  type AdminOverviewSummary,
  type AdminReceiptScanSettings,
  type AdminScanUsage,
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
  appendCsvTruncationNotice,
  buildAdminExpensesCsv,
  buildAdminGroupsCsv,
  buildAdminUsersCsv,
  downloadCsv,
} from "./adminCsv";
import {
  auditActionLabel,
  brokenRecurringRules,
  auditActionOptions,
  auditTargetText,
  describeLastSeen,
  errorGroupStatusLabel,
  errorSourceLabel,
  expenseCategoryLabel,
  expenseCategoryKeys,
  expenseImageUrl,
  expenseKindLabel,
  formatDate,
  formatClock,
  formatDateTime,
  formatExpenseAmount,
  formatLatency,
  formatUsdMicros,
  healthTiles,
  inboxItems,
  inviteStatus,
  inviteStatusLabel,
  overviewTiles,
  pageInfo,
  payerSummary,
  scanUsageTiles,
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
import { AdminConfirmProvider, useAdminConfirm } from "./AdminConfirm";
import { FeedbackPanel, ErrorsPanel, ErrorGroupPanel, NotificationsPanel } from "./AdminInboxPanels";
import { GroupDetailPanel, GroupsPanel } from "./AdminGroupPanels";
import { UserDetailPanel, UsersPanel } from "./AdminUserPanels";
import {
  canWrite,
  ExportButton,
  fetchAllPages,
  ListBody,
  isConsoleOwner,
  PAGE_SIZE,
  Pagination,
  todayKey,
  truncationNotice,
  type ListState,
  type PanelProps,
} from "./adminPanelKit";
import { RetentionCard, SettingsPanel } from "./AdminSettingsPanel";
export { canWrite, isConsoleOwner } from "./adminPanelKit";
import { AdminCommandPalette } from "./AdminCommandPalette";
import { hydrateCatalog } from "./catalog";
import { useAdminRoute } from "./useAdminRoute";
import { formatAmount } from "./formatAmount";
import { loadSession } from "./sessionStore";


type AccessState = "checking" | "no-session" | "forbidden" | "error" | "ok";

/**
 * How often the sidebar badges and the overview inbox re-read themselves.
 *
 * A minute: the queues behind them are human-paced (a piece of feedback, a new
 * error group), so anything faster is a request per operator per few seconds
 * for numbers that did not move.
 */
const HEALTH_POLL_MS = 60_000;



/**
 * The console, wrapped in its own confirm.
 *
 * A thin shell rather than a provider inside the tree: every panel below asks
 * for a confirmation through context, so the provider has to be above all of
 * them, and this is the only place that is.
 */
export function AdminApp() {
  return (
    <AdminConfirmProvider>
      <AdminConsole />
    </AdminConfirmProvider>
  );
}

function AdminConsole() {
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

  const [healthAt, setHealthAt] = useState<number | null>(null);
  /**
   * Bumped to tell every panel below to re-read.
   *
   * The panels are driven by the URL, so without this the only way to see new
   * rows was F5 - which reloads the whole SPA, and an operator watching an
   * incident was doing it every couple of minutes. It rides in PanelProps and
   * sits in each list effect's deps; changing nothing else about the request
   * is the point, so the same page comes back, only newer.
   */
  const [refreshKey, setRefreshKey] = useState(0);

  const reloadHealth = useCallback(() => {
    if (!client) return;
    client
      .adminHealth()
      .then((result) => {
        setHealth(result);
        setHealthAt(Date.now());
      })
      .catch(() => {
        // Non-fatal: the console works without its badges.
      });
  }, [client]);

  useEffect(reloadHealth, [reloadHealth]);

  const refreshAll = useCallback(() => {
    reloadHealth();
    setRefreshKey((key) => key + 1);
  }, [reloadHealth]);

  /**
   * Keep the backlog counts honest on a console somebody leaves open.
   *
   * Only while the tab is actually being looked at: a background tab polling
   * every minute is a request an operator will never read, and the browser
   * throttles the timer there anyway. Coming back to the tab refreshes
   * immediately rather than waiting out the rest of an interval - that is the
   * moment the numbers are most likely to be stale and most likely to be read.
   */
  useEffect(() => {
    if (!client) return;

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") reloadHealth();
    }, HEALTH_POLL_MS);

    const onVisible = () => {
      if (document.visibilityState === "visible") reloadHealth();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [client, reloadHealth]);

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
    { key: "notifications", icon: Megaphone },
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

        {/* Says how old what you are looking at is, and gives you the one
            action that fixes it. Before this the only refresh in the console
            was F5, which throws away the whole SPA to re-read one table. */}
        <div className="admin-refresh-row">
          <button className="admin-refresh" type="button" onClick={refreshAll}>
            <RefreshCw aria-hidden="true" size={14} />
            <span>重新整理</span>
          </button>
          <span className="admin-refresh__stamp" aria-live="polite">
            {healthAt ? `${formatClock(healthAt)} 更新` : "尚未更新"}
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
          <OverviewPanel client={client} route={route} onNavigate={navigate} health={health} refreshKey={refreshKey} />
        )}
        {tab === "users" && <UsersPanel client={client} route={route} onNavigate={navigate} role={me?.role} refreshKey={refreshKey} />}
        {tab === "groups" && <GroupsPanel client={client} route={route} onNavigate={navigate} role={me?.role} refreshKey={refreshKey} />}
        {tab === "feedback" && (
          <FeedbackPanel client={client} route={route} onNavigate={navigate} onCountsChanged={reloadHealth} refreshKey={refreshKey} />
        )}
        {tab === "notifications" && (
          <NotificationsPanel client={client} canSend={canWrite(me?.role)} route={route} refreshKey={refreshKey} />
        )}
        {tab === "errors" && (
          <ErrorsPanel client={client} route={route} onNavigate={navigate} onCountsChanged={reloadHealth} refreshKey={refreshKey} />
        )}
        {tab === "audit" && <AuditPanel client={client} route={route} onNavigate={navigate} refreshKey={refreshKey} />}
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

/**
 * The tile labels, spelled out so the placeholders can carry them.
 *
 * Kept next to the panel rather than derived from overviewTiles(), which needs
 * the payload that has not arrived yet - that is the whole point.
 * overviewTilesMatchLabels in AdminApp.test.tsx fails if the two drift.
 */
const OVERVIEW_TILE_LABELS = ["使用者", "新使用者（7 日）", "群組", "支出筆數"];

function OverviewPanel({ client, route, onNavigate, health, refreshKey }: PanelProps & { health: AdminHealthSummary | null }) {
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
  }, [client, refreshKey]);

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
  }, [client, trendDays, refreshKey]);

  if (error) return <p className="admin-error" role="alert">{error}</p>;

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

      {/* The four counters are the only thing on this screen that waits on
          adminOverview. They used to hold the whole page hostage - the panel
          returned one line of 載入中… and nothing else, including the inbox
          above, which is drawn from `health` and was already in memory before
          this component mounted. Now only the tiles wait, and they wait as
          themselves rather than as an absence. */}
      <div className="admin-tiles" aria-busy={!overview}>
        {overview
          ? overviewTiles(overview).map((tile) => (
              <article key={tile.key} className="admin-tile">
                <p className="admin-tile__label">{tile.label}</p>
                <p className="admin-tile__value">{tile.value.toLocaleString("zh-TW")}</p>
                {tile.hint && <p className="admin-tile__hint">{tile.hint}</p>}
              </article>
            ))
          : OVERVIEW_TILE_LABELS.map((label) => (
              <article key={label} className="admin-tile admin-tile--pending">
                <p className="admin-tile__label">{label}</p>
                <p className="admin-tile__value">—</p>
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
      {trends ? <TrendChartCard trends={trends} /> : <p className="admin-loading" role="status">載入中…</p>}

      <RetentionCard client={client} />

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

      {/* Only when something is broken. A good day shows nothing here, which is
          the same rule the inbox above follows. */}
      {health && brokenRecurringRules(health).length > 0 && (
        <>
          <h3 className="admin-subheading admin-subheading--spaced">已停用的循環支出</h3>
          <p className="admin-muted">
            {"這些規則在每晚產生帳目時失敗，已被自動停用——在群組成員修正原因之前不會再產生任何帳。"}
          </p>
          <div className="admin-table-wrap">
            <table className="admin-table">
              <thead>
                <tr>
                  <th>規則</th>
                  <th>群組</th>
                  <th>原因</th>
                  <th>最後嘗試</th>
                </tr>
              </thead>
              <tbody>
                {brokenRecurringRules(health).map((rule) => (
                  // Whole-row navigation, the same affordance the users and
                  // groups tables use - acting on this means going and looking
                  // at the group.
                  <tr
                    key={rule.id}
                    className="admin-table__row"
                    onClick={() => onNavigate({ tab: "groups", groupId: rule.groupId })}
                  >
                    <td>{rule.title}</td>
                    <td>{rule.groupName}</td>
                    <td>{rule.error}</td>
                    <td>{rule.lastRunAt ? formatDateTime(rule.lastRunAt) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
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


function AuditPanel({ client, route, onNavigate, refreshKey }: PanelProps) {
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
  }, [client, search, action, offset, refreshKey]);

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

      {state.error && <p className="admin-error" role="alert">{state.error}</p>}
      {state.loading && !state.page && <p className="admin-loading" role="status">載入中…</p>}

      {state.page && (
        <ListBody loading={state.loading}>
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
        </ListBody>
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
  const confirm = useAdminConfirm();
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
    const ok = await confirm({
      title: `移除「${label}」的後台權限？`,
      body: selfWarning || "這個帳號將無法再進入後台。",
      confirmLabel: "移除權限",
      danger: true,
    });
    if (!ok) return;
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

      {error && <p className="admin-error" role="alert">{error}</p>}
      {notice && <p className="admin-notice" aria-live="polite">{notice}</p>}
      {!admins && !error && <p className="admin-loading" role="status">載入中…</p>}

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
