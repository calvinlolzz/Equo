import { useEffect, useState } from "react";
import { Bug, LayoutDashboard, MessageSquareText, ScrollText, UsersRound, WalletCards } from "lucide-react";
import "./AdminApp.css";
import {
  createApiClient,
  type AdminAuditLogPage,
  type AdminErrorPage,
  type AdminExpensePage,
  type AdminExpenseRow,
  type AdminFeedbackPage,
  type AdminGroupDetail,
  type AdminGroupFilterOption,
  type AdminGroupListPage,
  type AdminMeSummary,
  type AdminOverviewSummary,
  type AdminStorageSummary,
  type AdminUserDetail,
  type AdminUserListPage,
  type ApiClientError,
  type EquoApiClient,
} from "./apiClient";
import {
  auditActionLabel,
  auditTargetText,
  describeLastSeen,
  expenseCategoryLabel,
  expenseImageUrl,
  expenseKindLabel,
  formatDate,
  formatDateTime,
  formatExpenseAmount,
  overviewTiles,
  pageInfo,
  payerSummary,
  shareTypeLabel,
  storageTiles,
} from "./adminDashboard";
import { formatAmount } from "./formatAmount";
import { loadSession } from "./sessionStore";

const PAGE_SIZE = 20;

type AccessState = "checking" | "no-session" | "forbidden" | "error" | "ok";
type AdminTab = "overview" | "users" | "groups" | "feedback" | "errors" | "audit";

export function AdminApp() {
  const [session] = useState(() => loadSession());
  const [client] = useState<EquoApiClient | null>(() =>
    session ? createApiClient() : null,
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

  const navItems: Array<{ key: AdminTab; label: string; icon: typeof LayoutDashboard }> = [
    { key: "overview", label: "總覽", icon: LayoutDashboard },
    { key: "users", label: "使用者", icon: UsersRound },
    { key: "groups", label: "群組", icon: WalletCards },
    { key: "feedback", label: "回饋", icon: MessageSquareText },
    { key: "errors", label: "錯誤", icon: Bug },
    { key: "audit", label: "稽核", icon: ScrollText },
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
                onClick={() => setTab(item.key)}
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
        {tab === "overview" && <OverviewPanel client={client} />}
        {tab === "users" && <UsersPanel client={client} />}
        {tab === "groups" && <GroupsPanel client={client} />}
        {tab === "feedback" && <FeedbackPanel client={client} />}
        {tab === "errors" && <ErrorsPanel client={client} />}
        {tab === "audit" && <AuditPanel client={client} />}
      </main>
    </div>
  );
}

function OverviewPanel({ client }: { client: EquoApiClient }) {
  const [overview, setOverview] = useState<AdminOverviewSummary | null>(null);
  const [storage, setStorage] = useState<AdminStorageSummary | null>(null);
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
    // Storage is supplementary: load it separately so a storage hiccup never
    // blocks the core metrics. A failure just leaves the section out.
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
                  <th>狀態</th>
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
  const [actionBusy, setActionBusy] = useState(false);
  const [selectedGroupId, setSelectedGroupId] = useState("");

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
        onBack={() => setSelectedGroupId("")}
      />
    );
  }

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
                  <tr key={group.id} className="admin-table__row" onClick={() => setSelectedGroupId(group.id)}>
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

function GroupsPanel({ client }: { client: EquoApiClient }) {
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AdminGroupFilterOption>("all");
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState<ListState<AdminGroupListPage>>({ page: null, loading: true, error: "" });
  const [busyGroupId, setBusyGroupId] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [selectedGroupId, setSelectedGroupId] = useState("");

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
          setSelectedGroupId("");
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

      <div className="admin-chips" role="group" aria-label="群組篩選">
        {GROUP_FILTER_CHIPS.map((chip) => (
          <button
            key={chip.key}
            type="button"
            className={filter === chip.key ? "admin-chip admin-chip--active" : "admin-chip"}
            onClick={() => {
              setOffset(0);
              setFilter(chip.key);
            }}
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
                        <button type="button" className="admin-action" onClick={() => setSelectedGroupId(group.id)}>
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
              onPrev={() => setOffset(Math.max(offset - PAGE_SIZE, 0))}
              onNext={() => setOffset(offset + PAGE_SIZE)}
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

function FeedbackPanel({ client }: { client: EquoApiClient }) {
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [offset, setOffset] = useState(0);
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
            onClick={() => {
              setOffset(0);
              setStatusFilter(chip.key);
            }}
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
              onPrev={() => setOffset(Math.max(offset - PAGE_SIZE, 0))}
              onNext={() => setOffset(offset + PAGE_SIZE)}
            />
          )}
        </>
      )}
    </section>
  );
}

function ErrorsPanel({ client }: { client: EquoApiClient }) {
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState<ListState<AdminErrorPage>>({ page: null, loading: true, error: "" });

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: "" }));
    client
      .adminListErrors({ limit: PAGE_SIZE, offset })
      .then((page) => {
        if (!cancelled) setState({ page, loading: false, error: "" });
      })
      .catch(() => {
        if (!cancelled) setState({ page: null, loading: false, error: "錯誤日誌載入失敗。" });
      });
    return () => {
      cancelled = true;
    };
  }, [client, offset]);

  const info = state.page ? pageInfo(state.page.total, PAGE_SIZE, offset, state.page.errors.length) : null;

  return (
    <section aria-label="錯誤日誌">
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
                  <th>來源</th>
                  <th>訊息</th>
                  <th>頁面</th>
                </tr>
              </thead>
              <tbody>
                {state.page.errors.map((item) => (
                  <tr key={item.id}>
                    <td>{formatDateTime(item.created_at)}</td>
                    <td>{item.user_email ?? "—"}</td>
                    <td>{item.source === "admin" ? "後台" : "前台"}</td>
                    <td className="admin-table__message" title={item.context ?? item.message}>
                      {item.message}
                    </td>
                    <td>{item.page ?? "—"}</td>
                  </tr>
                ))}
                {state.page.errors.length === 0 && (
                  <tr>
                    <td colSpan={5} className="admin-table__empty">
                      沒有錯誤記錄——很好！
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

function AuditPanel({ client }: { client: EquoApiClient }) {
  const [offset, setOffset] = useState(0);
  const [state, setState] = useState<ListState<AdminAuditLogPage>>({ page: null, loading: true, error: "" });

  useEffect(() => {
    let cancelled = false;
    setState((current) => ({ ...current, loading: true, error: "" }));
    client
      .adminListAuditLogs({ limit: PAGE_SIZE, offset })
      .then((page) => {
        if (!cancelled) setState({ page, loading: false, error: "" });
      })
      .catch(() => {
        if (!cancelled) setState({ page: null, loading: false, error: "稽核記錄載入失敗。" });
      });
    return () => {
      cancelled = true;
    };
  }, [client, offset]);

  const info = state.page ? pageInfo(state.page.total, PAGE_SIZE, offset, state.page.logs.length) : null;

  return (
    <section aria-label="稽核記錄">
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
                      尚無稽核記錄
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
