import { useEffect, useMemo, useState } from "react";
import {
  type AdminExpenseMetaPatch,
  type AdminExpensePage,
  type AdminExpenseRow,
  type AdminGroupDetail,
  type AdminGroupFilterOption,
  type AdminGroupListPage,
  type ApiClientError,
  type EquoApiClient,
} from "./apiClient";
import { adminCsvFileName, appendCsvTruncationNotice, buildAdminExpensesCsv, buildAdminGroupsCsv, downloadCsv } from "./adminCsv";
import {
  expenseCategoryKeys,
  expenseCategoryLabel,
  expenseImageUrl,
  expenseKindLabel,
  formatDate,
  formatDateTime,
  formatExpenseAmount,
  inviteStatus,
  inviteStatusLabel,
  pageInfo,
  payerSummary,
  shareTypeLabel,
} from "./adminDashboard";
import { routeOffset, type AdminRoute } from "./adminRoute";
import { useAdminConfirm } from "./AdminConfirm";
import {
  canWrite,
  ExportButton,
  fetchAllPages,
  ListBody,
  PAGE_SIZE,
  Pagination,
  todayKey,
  truncationNotice,
  type ListState,
  type PanelProps,
} from "./adminPanelKit";
import { formatAmount } from "./formatAmount";

/**
 * Group drill-down: roster on top, the group's actual expenses below. Reached
 * from both the groups tab and a user's group list, so it takes an onBack
 * label rather than assuming which list it came from.
 */
export function GroupDetailPanel({
  client,
  groupId,
  role,
  backLabel,
  onBack,
  onNavigate,
}: {
  client: EquoApiClient;
  groupId: string;
  role?: string;
  backLabel: string;
  onBack: () => void;
  /** Reached from two different lists, so it navigates rather than owning a route. */
  onNavigate: (patch: Partial<AdminRoute>) => void;
}) {
  const confirm = useAdminConfirm();
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
    const ok = await confirm({
      title: "轉移群組擁有者？",
      body: `「${detail.group.name}」的擁有者會換成「${member?.display_name || member?.email || "這位成員"}」，原擁有者降為一般成員。`,
      confirmLabel: "轉移",
    });
    if (!ok) return;

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

      {error && <p className="admin-error" role="alert">{error}</p>}
      {!detail && !error && <p className="admin-loading" role="status">載入中…</p>}

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
            {/* A deleted group's members should not be written to: the group is
                gone from their app, so a notification about it has no context
                to land in. */}
            {canWrite(role) && !detail.group.deleted_at && (
              <div className="admin-user-card__actions">
                <button
                  type="button"
                  className="admin-action"
                  onClick={() => onNavigate({ tab: "notifications", groupId: detail.group.id })}
                >
                  發通知給這個群組
                </button>
              </div>
            )}
          </article>

          {notice && <p className="admin-notice" aria-live="polite">{notice}</p>}

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
  const [exportNotice, setExportNotice] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  /** The group's whole ledger, honouring the 顯示已刪除 toggle. */
  async function exportExpenses() {
    setExporting(true);
    setExportNotice("");
    try {
      const expenses = await fetchAllPages(async (pageOffset, limit) => {
        const page = await client.adminListGroupExpenses(group.id, {
          limit,
          offset: pageOffset,
          includeDeleted,
        });
        return { total: page.total, rows: page.expenses };
      });
      downloadCsv(
        adminCsvFileName(`${group.name}-帳目`, todayKey(), expenses.truncated),
        appendCsvTruncationNotice(buildAdminExpensesCsv(expenses.rows), expenses.rows.length, expenses.total),
      );
      setExportNotice(truncationNotice(expenses));
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

      {state.error && <p className="admin-error" role="alert">{state.error}</p>}
      {exportNotice && <p className="admin-notice admin-notice--warn" aria-live="polite">{exportNotice}</p>}
      {state.loading && !state.page && <p className="admin-loading" role="status">載入中…</p>}

      {state.page && (
        <ListBody loading={state.loading}>
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
        </ListBody>
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
  const confirm = useAdminConfirm();
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
  // Read at render rather than at module load: the catalog arrives from the
  // server after first paint, and a list captured at import time would be the
  // bundle's defaults forever.
  const categoryKeys = expenseCategoryKeys();

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
    const ok = await confirm({
      title: deleting ? `刪除「${expense.title}」？` : `復原「${expense.title}」？`,
      body: deleting
        ? "這是軟刪除，之後可以在「顯示已刪除」裡復原，但所有成員的結餘會立刻改變。"
        : "這筆帳會重新計入所有成員的結餘。",
      confirmLabel: deleting ? "刪除" : "復原",
      danger: deleting,
    });
    if (!ok) return;

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

        {error && <p className="admin-error" role="alert">{error}</p>}

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
                {categoryKeys.map((key) => (
                  <option key={key} value={key}>
                    {expenseCategoryLabel(key)}
                  </option>
                ))}
                {/* A category from an older build stays selectable rather than
                    being silently rewritten to 其他 on the next save. */}
                {!categoryKeys.includes(expense.category) && (
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

export function GroupsPanel({ client, route, onNavigate, role, refreshKey }: PanelProps) {
  const confirm = useAdminConfirm();
  const [searchInput, setSearchInput] = useState(route.search);
  const search = route.search;
  const filter: AdminGroupFilterOption = route.filter;
  const offset = routeOffset(route);
  const selectedGroupId = route.groupId;
  const [state, setState] = useState<ListState<AdminGroupListPage>>({ page: null, loading: true, error: "" });
  const [busyGroupId, setBusyGroupId] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState("");

  useEffect(() => {
    setSearchInput(route.search);
  }, [route.search]);

  /** Exports every group matching the current search AND filter. */
  async function exportGroups() {
    setExporting(true);
    setExportNotice("");
    try {
      const groups = await fetchAllPages(async (pageOffset, limit) => {
        const page = await client.adminListGroups({ search, limit, offset: pageOffset, filter });
        return { total: page.total, rows: page.groups };
      });
      downloadCsv(
        adminCsvFileName("群組", todayKey(), groups.truncated),
        appendCsvTruncationNotice(buildAdminGroupsCsv(groups.rows), groups.rows.length, groups.total),
      );
      setExportNotice(truncationNotice(groups));
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
  }, [client, search, offset, filter, reloadKey, refreshKey]);

  async function runGroupAction(groupId: string, name: string, action: "archive" | "unarchive" | "delete" | "restore") {
    const confirmTitle: Record<typeof action, string> = {
      archive: `封存「${name}」？`,
      unarchive: `解除封存「${name}」？`,
      delete: `刪除「${name}」？`,
      restore: `復原「${name}」？`,
    };
    const confirmText: Record<typeof action, string> = {
      archive: "成員將無法再記帳，但資料保留。",
      unarchive: "成員可以重新記帳。",
      delete: "群組會從所有成員的列表消失，之後可在「已刪除」檢視復原。",
      restore: "群組會重新出現在成員的列表。",
    };
    const confirmAction: Record<typeof action, string> = {
      archive: "封存",
      unarchive: "解除封存",
      delete: "刪除",
      restore: "復原",
    };
    const ok = await confirm({
      title: confirmTitle[action],
      body: confirmText[action],
      confirmLabel: confirmAction[action],
      danger: action === "delete",
    });
    if (!ok) return;

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
        onNavigate={onNavigate}
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

      {state.error && <p className="admin-error" role="alert">{state.error}</p>}
      {exportNotice && <p className="admin-notice admin-notice--warn" aria-live="polite">{exportNotice}</p>}
      {state.loading && !state.page && <p className="admin-loading" role="status">載入中…</p>}

      {state.page && (
        <ListBody loading={state.loading}>
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
        </ListBody>
      )}
    </section>
  );
}
