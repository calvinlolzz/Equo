import { useEffect, useState } from "react";
import "./AdminApp.css";
import {
  createApiClient,
  type AdminGroupListPage,
  type AdminMeSummary,
  type AdminOverviewSummary,
  type AdminUserDetail,
  type AdminUserListPage,
  type ApiClientError,
  type EquoApiClient,
} from "./apiClient";
import { describeLastSeen, formatDate, overviewTiles, pageInfo } from "./adminDashboard";
import { formatAmount } from "./formatAmount";
import { loadSession } from "./sessionStore";

const PAGE_SIZE = 20;

type AccessState = "checking" | "no-session" | "forbidden" | "error" | "ok";
type AdminTab = "overview" | "users" | "groups";

export function AdminApp() {
  const [session] = useState(() => loadSession());
  const [client] = useState<EquoApiClient | null>(() =>
    session ? createApiClient({ authToken: session.token }) : null,
  );
  const [access, setAccess] = useState<AccessState>(session ? "checking" : "no-session");
  const [me, setMe] = useState<AdminMeSummary | null>(null);
  const [tab, setTab] = useState<AdminTab>("overview");

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

  return (
    <div className="admin-shell">
      <header className="admin-header">
        <div className="admin-header__brand">
          <span className="admin-header__logo">Equo</span>
          <span className="admin-header__title">管理後台</span>
        </div>
        <nav className="admin-tabs" aria-label="後台功能">
          <button
            type="button"
            className={tab === "overview" ? "admin-tab admin-tab--active" : "admin-tab"}
            onClick={() => setTab("overview")}
          >
            總覽
          </button>
          <button
            type="button"
            className={tab === "users" ? "admin-tab admin-tab--active" : "admin-tab"}
            onClick={() => setTab("users")}
          >
            使用者
          </button>
          <button
            type="button"
            className={tab === "groups" ? "admin-tab admin-tab--active" : "admin-tab"}
            onClick={() => setTab("groups")}
          >
            群組
          </button>
        </nav>
        <div className="admin-header__user">
          <span>{me?.user.email}</span>
          <a href="/">回主站</a>
        </div>
      </header>

      <main className="admin-main">
        {tab === "overview" && <OverviewPanel client={client} />}
        {tab === "users" && <UsersPanel client={client} />}
        {tab === "groups" && <GroupsPanel client={client} />}
      </main>
    </div>
  );
}

function OverviewPanel({ client }: { client: EquoApiClient }) {
  const [overview, setOverview] = useState<AdminOverviewSummary | null>(null);
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
    return () => {
      cancelled = true;
    };
  }, [client]);

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
    </section>
  );
}

type ListState<T> = {
  page: T | null;
  loading: boolean;
  error: string;
};

function UsersPanel({ client }: { client: EquoApiClient }) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState<ListState<AdminUserListPage>>({ page: null, loading: true, error: "" });
  const [selectedUserId, setSelectedUserId] = useState("");

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
    return <UserDetailPanel client={client} userId={selectedUserId} onBack={() => setSelectedUserId("")} />;
  }

  const now = Date.now();
  const info = state.page ? pageInfo(state.page.total, PAGE_SIZE, offset, state.page.users.length) : null;

  return (
    <section aria-label="使用者查詢">
      <form
        className="admin-search"
        onSubmit={(event) => {
          event.preventDefault();
          setOffset(0);
          setSearch(searchInput.trim());
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
                </tr>
              </thead>
              <tbody>
                {state.page.users.map((user) => (
                  <tr key={user.id} className="admin-table__row" onClick={() => setSelectedUserId(user.id)}>
                    <td>{user.display_name || "—"}</td>
                    <td>{user.email}</td>
                    <td className="admin-table__num">{user.group_count}</td>
                    <td className="admin-table__num">{user.expense_count}</td>
                    <td>{describeLastSeen(user.last_seen_at, now)}</td>
                    <td>{formatDate(user.created_at)}</td>
                  </tr>
                ))}
                {state.page.users.length === 0 && (
                  <tr>
                    <td colSpan={6} className="admin-table__empty">
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
              onPrev={() => setOffset(Math.max(offset - PAGE_SIZE, 0))}
              onNext={() => setOffset(offset + PAGE_SIZE)}
            />
          )}
        </>
      )}
    </section>
  );
}

function UserDetailPanel({
  client,
  userId,
  onBack,
}: {
  client: EquoApiClient;
  userId: string;
  onBack: () => void;
}) {
  const [detail, setDetail] = useState<AdminUserDetail | null>(null);
  const [error, setError] = useState("");

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

  return (
    <section aria-label="使用者詳情">
      <button type="button" className="admin-back" onClick={onBack}>
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
            <div>
              <h2 className="admin-user-card__name">{detail.user.display_name || "—"}</h2>
              <p className="admin-user-card__email">{detail.user.email}</p>
              <p className="admin-user-card__meta">
                加入 {formatDate(detail.user.created_at)}・最後活躍 {describeLastSeen(detail.user.last_seen_at, Date.now())}
                ・{detail.user.group_count} 個群組・{detail.user.expense_count} 筆支出
              </p>
            </div>
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
                  <tr key={group.id}>
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

function GroupsPanel({ client }: { client: EquoApiClient }) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState<ListState<AdminGroupListPage>>({ page: null, loading: true, error: "" });

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: "" }));
    client
      .adminListGroups({ search, limit: PAGE_SIZE, offset })
      .then((page) => {
        if (!cancelled) setState({ page, loading: false, error: "" });
      })
      .catch(() => {
        if (!cancelled) setState({ page: null, loading: false, error: "群組列表載入失敗。" });
      });
    return () => {
      cancelled = true;
    };
  }, [client, search, offset]);

  const info = state.page ? pageInfo(state.page.total, PAGE_SIZE, offset, state.page.groups.length) : null;

  return (
    <section aria-label="群組查詢">
      <form
        className="admin-search"
        onSubmit={(event) => {
          event.preventDefault();
          setOffset(0);
          setSearch(searchInput.trim());
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
      </form>

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
                </tr>
              </thead>
              <tbody>
                {state.page.groups.map((group) => (
                  <tr key={group.id}>
                    <td>{group.name}</td>
                    <td>{group.owner_display_name ?? "—"}</td>
                    <td className="admin-table__num">{group.member_count}</td>
                    <td className="admin-table__num">{group.expense_count}</td>
                    <td className="admin-table__num">{formatAmount(group.spend_total_minor, group.currency)}</td>
                    <td>{group.last_expense_at ? formatDate(group.last_expense_at) : "—"}</td>
                    <td>{formatDate(group.created_at)}</td>
                    <td>{group.archived_at ? "已封存" : "使用中"}</td>
                  </tr>
                ))}
                {state.page.groups.length === 0 && (
                  <tr>
                    <td colSpan={8} className="admin-table__empty">
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
              onPrev={() => setOffset(Math.max(offset - PAGE_SIZE, 0))}
              onNext={() => setOffset(offset + PAGE_SIZE)}
            />
          )}
        </>
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
