import { useEffect, useState, type FormEvent } from "react";
import {
  type AdminUserDetail,
  type AdminUserListPage,
  type AdminUserRow,
  type ApiClientError,
  type EquoApiClient,
} from "./apiClient";
import { adminCsvFileName, appendCsvTruncationNotice, buildAdminUsersCsv, downloadCsv } from "./adminCsv";
import { describeLastSeen, formatDate, formatDateTime, pageInfo } from "./adminDashboard";
import { formatAmount } from "./formatAmount";
import { routeOffset } from "./adminRoute";
import { useAdminConfirm } from "./AdminConfirm";
import {
  canWrite,
  ExportButton,
  fetchAllPages,
  ListBody,
  isConsoleOwner,
  PAGE_SIZE,
  reportExport,
  Pagination,
  todayKey,
  truncationNotice,
  type ListState,
  type PanelProps,
} from "./adminPanelKit";
import { GroupDetailPanel } from "./AdminGroupPanels";

export function UsersPanel({ client, route, onNavigate, role, refreshKey }: PanelProps) {
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
  const [exportNotice, setExportNotice] = useState("");

  useEffect(() => {
    setSearchInput(route.search);
  }, [route.search]);

  /** Exports every user matching the current search, not just this page. */
  async function exportUsers() {
    setExporting(true);
    setExportNotice("");
    try {
      const users = await fetchAllPages(async (offset, limit) => {
        const page = await client.adminListUsers({ search, limit, offset });
        return { total: page.total, rows: page.users };
      });
      downloadCsv(
        adminCsvFileName("使用者", todayKey(), users.truncated),
        appendCsvTruncationNotice(buildAdminUsersCsv(users.rows), users.rows.length, users.total),
      );
      await reportExport(client, "users", users, search);
      setExportNotice(truncationNotice(users));
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
  }, [client, search, offset, refreshKey]);

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

      {state.error && <p className="admin-error" role="alert">{state.error}</p>}
      {exportNotice && <p className="admin-notice admin-notice--warn" aria-live="polite">{exportNotice}</p>}
      {state.loading && !state.page && <p className="admin-loading" role="status">載入中…</p>}

      {state.page && (
        <ListBody loading={state.loading}>
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
        </ListBody>
      )}
    </section>
  );
}

export function UserDetailPanel({ client, route, onNavigate, role }: PanelProps) {
  const confirm = useAdminConfirm();
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
    const ok = await confirm({
      title: disabling ? `停用「${label}」？` : `恢復「${label}」的帳號？`,
      body: disabling
        ? "停用後該帳號無法登入，群組內的歷史帳目會保留。"
        : "恢復後即可重新登入。",
      confirmLabel: disabling ? "停用" : "恢復",
      danger: disabling,
    });
    if (!ok) return;

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
  /**
   * Open a read-only view of the app as this user.
   *
   * Navigates to the app itself rather than rendering anything here: the point
   * is to see exactly what they see, and any reproduction of it inside the
   * console would be a second implementation that can disagree with the first.
   */
  async function viewAsUser() {
    if (!detail) return;
    const label = detail.user.display_name || detail.user.email;
    const ok = await confirm({
      title: `以「${label}」的身分開啟唯讀檢視？`,
      body: "你會看到他看到的畫面，但不能修改任何東西。這次檢視會寫進稽核記錄，15 分鐘後自動失效。",
      confirmLabel: "開啟檢視",
    });
    if (!ok) return;

    setActionBusy(true);
    setError("");
    try {
      await client.adminViewAs(detail.user.id);
      // A full navigation, not a router push: the cookie decides who the app
      // thinks you are, and every module reads that on the way in.
      window.location.assign("/");
    } catch (err) {
      const code = (err as ApiClientError).code;
      setError(code === "ADMIN_FORBIDDEN" ? "只有管理員或擁有者能使用唯讀檢視。" : "無法開啟檢視，請稍後再試。");
      setActionBusy(false);
    }
  }

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
    const ok = await confirm({
      title: `刪除「${detail.user.email}」的帳號？`,
      body: "無法復原：個人資料會被清除，共用群組裡的帳目會保留成匿名成員。",
      typeToConfirm: detail.user.email,
      typeToConfirmHint: "請輸入這個帳號的 email",
      confirmLabel: "刪除帳號",
      danger: true,
    });
    if (!ok) return;

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
        onNavigate={onNavigate}
      />
    );
  }

  return (
    <section aria-label="使用者詳情">
      <button type="button" className="admin-back" onClick={() => onNavigate({ userId: "" })}>
        ← 回使用者列表
      </button>

      {error && <p className="admin-error" role="alert">{error}</p>}
      {!detail && !error && <p className="admin-loading" role="status">載入中…</p>}

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
                <button
                  type="button"
                  className="admin-action"
                  disabled={actionBusy}
                  onClick={() => onNavigate({ tab: "notifications", userId: detail.user.id })}
                >
                  發通知給這個人
                </button>
              )}
              {canWrite(role) && (
                <button type="button" className="admin-action" disabled={actionBusy} onClick={exportUser}>
                  匯出個資 JSON
                </button>
              )}
              {canWrite(role) && (
                <button type="button" className="admin-action" disabled={actionBusy} onClick={viewAsUser}>
                  以他的身分檢視（唯讀）
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

          {notice && <p className="admin-notice" aria-live="polite">{notice}</p>}

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
  const confirm = useAdminConfirm();
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

  /**
   * Merging moves every membership this account has into another one and
   * disables it, and there is no unmerge. Deleting an account — which leaves
   * the ledger standing behind an anonymised member — already asks for the
   * email to be typed; this asked for one click on a browser confirm. The
   * risk was calibrated backwards.
   *
   * The TARGET's email is the one to type, because the target is the half
   * picked off a search list and therefore the half that gets picked wrong.
   * The source is simply whichever account's page this is.
   */
  async function merge(target: AdminUserRow) {
    const ok = await confirm({
      title: `把「${user.email}」併到「${target.email}」？`,
      body: `無法復原：轉移後「${user.email}」會被停用。帳目本身不會移動（帳目掛在成員身分上）。`,
      typeToConfirm: target.email,
      typeToConfirmHint: "請輸入要轉入的帳號 email",
      confirmLabel: "合併",
      danger: true,
    });
    if (!ok) return;

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

      {error && <p className="admin-error" role="alert">{error}</p>}
      {conflicts.length > 0 && (
        <p className="admin-error" role="alert">
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
