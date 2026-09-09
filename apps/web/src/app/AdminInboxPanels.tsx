import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import {
  type AdminErrorGroupPage,
  type AdminErrorGroupRow,
  type AdminErrorPage,
  type AdminFeedbackPage,
  type AdminFeedbackRow,
  type AdminNotificationAudienceOption,
  type AdminSentNotificationPage,
  type ApiClientError,
  type EquoApiClient,
} from "./apiClient";
import { errorGroupStatusLabel, errorSourceLabel, formatDateTime, pageInfo } from "./adminDashboard";
import { routeOffset, type AdminRoute } from "./adminRoute";
import { useAdminConfirm } from "./AdminConfirm";
import { ListBody, PAGE_SIZE, Pagination, type ListState, type PanelProps } from "./adminPanelKit";

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

export function FeedbackPanel({ client, route, onNavigate, onCountsChanged, refreshKey }: PanelProps) {
  const statusFilter = route.status;
  const offset = routeOffset(route);
  const [state, setState] = useState<ListState<AdminFeedbackPage>>({ page: null, loading: true, error: "" });
  const [busyId, setBusyId] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  /** Which row has its reply box open, and what has been typed into it. */
  const [replyingId, setReplyingId] = useState("");
  const [replyText, setReplyText] = useState("");

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
  }, [client, offset, statusFilter, reloadKey, refreshKey]);

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

  /** The reply and the status change are one action on the server, so they are one here too. */
  async function sendReply(feedbackId: string) {
    if (!replyText.trim()) return;
    setBusyId(feedbackId);
    try {
      await client.adminReplyFeedback(feedbackId, replyText.trim());
      setReplyingId("");
      setReplyText("");
      setReloadKey((key) => key + 1);
      onCountsChanged?.();
    } catch (caught) {
      setState((current) => ({
        ...current,
        error: (caught as ApiClientError).message || "回覆送出失敗，請稍後再試。",
      }));
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

      {state.error && <p className="admin-error" role="alert">{state.error}</p>}
      {state.loading && !state.page && <p className="admin-loading" role="status">載入中…</p>}

      {state.page && (
        <ListBody loading={state.loading}>
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
                        {/* Replying is the action that closes the loop, so it
                            comes first. It also marks the row done - a reply
                            that leaves the item in the queue just means the
                            next person answers it again. */}
                        {item.user_email && (
                          <button
                            type="button"
                            className="admin-action"
                            disabled={busy}
                            onClick={() => setReplyingId(replyingId === item.id ? "" : item.id)}
                          >
                            {replyingId === item.id ? "收起" : "回覆"}
                          </button>
                        )}
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
                {state.page.feedback
                  .filter((item) => item.id === replyingId)
                  .map((item) => (
                    <tr key={`${item.id}-reply`}>
                      <td colSpan={6}>
                        <form
                          className="admin-reply"
                          onSubmit={(event) => {
                            event.preventDefault();
                            void sendReply(item.id);
                          }}
                        >
                          <label className="admin-field">
                            <span>回覆給 {item.user_email}（會出現在他的 app 通知中心）</span>
                            <textarea
                              value={replyText}
                              rows={3}
                              maxLength={1000}
                              placeholder="謝謝回報，這個問題已經在最新版修好了…"
                              onChange={(event) => setReplyText(event.target.value)}
                            />
                          </label>
                          <div className="admin-modal__actions">
                            <button
                              type="submit"
                              className="admin-action admin-action--primary"
                              disabled={busyId === item.id || !replyText.trim()}
                            >
                              {busyId === item.id ? "送出中…" : "送出回覆並標記完成"}
                            </button>
                          </div>
                        </form>
                      </td>
                    </tr>
                  ))}
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
        </ListBody>
      )}
    </section>
  );
}

/**
 * Pick the one user or group a notification is addressed to.
 *
 * This was a text field asking for a uuid - the console never shows an id on
 * screen, so the only way to address anybody was to drill into them in another
 * tab and copy it out of the address bar. It then became a search box, which
 * was still ceremony: this deployment has single digits of users and a handful
 * of live groups, so the whole list fits in a dropdown and there is nothing to
 * search for.
 *
 * The list is capped at the server's page limit. That is far above the current
 * size, but if it is ever hit the control says so rather than quietly offering
 * a truncated list as if it were everybody.
 */
const TARGET_LIST_LIMIT = 100;

function TargetPicker({
  client,
  kind,
  selected,
  disabled,
  onPick,
}: {
  client: EquoApiClient;
  kind: "user" | "group";
  selected: string;
  disabled: boolean;
  onPick: (id: string, label: string) => void;
}) {
  const [options, setOptions] = useState<Array<{ id: string; label: string }>>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError("");
    setOptions([]);

    const load =
      kind === "user"
        ? client.adminListUsers({ limit: TARGET_LIST_LIMIT }).then((page) => ({
            total: page.total,
            // Deleted/disabled accounts stay listed but say so: "why is that
            // person missing" is a worse question than a labelled row.
            rows: page.users.map((row) => ({
              id: row.id,
              label: `${row.display_name || row.email}（${row.email}）${row.disabled_at ? "・已停用" : ""}`,
            })),
          }))
        : // The default group filter is already "non-deleted", so a deleted
          // group is never offered as a destination.
          client.adminListGroups({ limit: TARGET_LIST_LIMIT }).then((page) => ({
            total: page.total,
            rows: page.groups.map((row) => ({
              id: row.id,
              label: `${row.name}（${row.member_count} 位成員）`,
            })),
          }));

    load
      .then(({ total: count, rows }) => {
        if (cancelled) return;
        setOptions(rows);
        setTotal(count);
      })
      .catch(() => {
        if (!cancelled) setError(kind === "user" ? "使用者清單載入失敗。" : "群組清單載入失敗。");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [client, kind]);

  // Arriving from somebody's page puts an id in the URL but no name. Once the
  // list lands, hand the label back so the confirm can say who this is.
  useEffect(() => {
    if (!selected || options.length === 0) return;
    const match = options.find((option) => option.id === selected);
    if (match) onPick(match.id, match.label);
    // onPick is stable enough here (it only sets state on the parent); adding
    // it would re-run this on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, options]);

  const known = options.some((option) => option.id === selected);

  return (
    <label className="admin-field">
      <span>{kind === "user" ? "收件人" : "收件群組"}</span>
      <select
        value={selected}
        disabled={disabled || loading || Boolean(error)}
        onChange={(event) => {
          const id = event.target.value;
          onPick(id, options.find((option) => option.id === id)?.label ?? id);
        }}
      >
        <option value="">
          {loading ? "載入中…" : kind === "user" ? "選擇收件人…" : "選擇收件群組…"}
        </option>
        {options.map((option) => (
          <option key={option.id} value={option.id}>
            {option.label}
          </option>
        ))}
        {/* An id from the URL that is not in the loaded page still has to be
            selectable, or the form would silently lose its address. */}
        {selected && !known && <option value={selected}>{selected.slice(0, 8)}…</option>}
      </select>
      {error && <p className="admin-error" role="alert">{error}</p>}
      {total > options.length && (
        <p className="admin-modal__hint">
          只列出前 {options.length} 筆（共 {total} 筆）。要送給沒列出的對象，請先從列表頁進去再用「發通知給這個人」。
        </p>
      )}
    </label>
  );
}

const AUDIENCE_OPTIONS: Array<{ value: AdminNotificationAudienceOption; label: string; hint: string }> = [
  { value: "active", label: "近 30 天活躍使用者", hint: "最近開過 app 的人。公告的預設對象。" },
  { value: "all", label: "全部使用者", hint: "所有未停用的帳號，包含很久沒回來的。" },
  { value: "group", label: "指定群組", hint: "這個群組裡狀態為使用中的成員。" },
  { value: "user", label: "指定使用者", hint: "只有這一個帳號會收到。" },
];

/**
 * Send an in-app message.
 *
 * The audience is chosen first and explained in words, because it is the only
 * irreversible part of this form: the text can be re-sent, but the set of
 * people who already got it cannot be narrowed afterwards. The confirm before
 * sending says the audience and the count it is about to reach.
 */
export function NotificationsPanel({
  client,
  canSend,
  route,
  refreshKey,
}: {
  client: EquoApiClient;
  canSend: boolean;
  route: AdminRoute;
  /** See PanelProps.refreshKey — this panel takes its own props, not those. */
  refreshKey?: number;
}) {
  /**
   * Arriving from a person's or a group's page opens the form already
   * addressed to them: ?tab=notifications&user=<id> or &group=<id>.
   *
   * No new route vocabulary was needed - the console already keeps its state in
   * the URL and already carries both parameters - so these are links rather
   * than a second copy of the compose form living on each detail page, and they
   * stay shareable like every other screen here. On this tab the two parameters
   * mean "who this is addressed to" rather than "which drill-down is open",
   * which is the same overload the users tab already lives with.
   *
   * A user wins if both are somehow present, so the address is never ambiguous.
   */
  const confirm = useAdminConfirm();
  const arrivedForUser = route.userId;
  const arrivedForGroup = arrivedForUser ? "" : route.groupId;
  const [audience, setAudience] = useState<AdminNotificationAudienceOption>(
    arrivedForUser ? "user" : arrivedForGroup ? "group" : "active",
  );
  const [target, setTarget] = useState(arrivedForUser || arrivedForGroup);
  /** What the picked target is called, so the form can say who it is about to write to. */
  const [targetLabel, setTargetLabel] = useState("");
  const [title, setTitle] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [link, setLink] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [sent, setSent] = useState<AdminSentNotificationPage | null>(null);
  const [sentError, setSentError] = useState("");
  const [recalling, setRecalling] = useState("");
  const [sentReloadKey, setSentReloadKey] = useState(0);

  const needsTarget = audience === "user" || audience === "group";
  const selected = AUDIENCE_OPTIONS.find((option) => option.value === audience);

  useEffect(() => {
    let cancelled = false;
    setSentError("");
    client
      .adminListSentNotifications({ limit: 20 })
      .then((page) => {
        if (!cancelled) setSent(page);
      })
      .catch(() => {
        if (!cancelled) setSentError("已送出清單載入失敗，可能是資料庫尚未套用 notification management migration。");
      });
    return () => {
      cancelled = true;
    };
  }, [client, sentReloadKey, refreshKey]);

  async function recall(batchId: string, title: string, recipients: number, readCount: number) {
    const ok = await confirm({
      title: `收回「${title}」？`,
      body:
        `它會從 ${recipients} 個收件匣消失。` +
        (readCount > 0 ? `已經有 ${readCount} 人讀過了，收回不會讓他們忘記。` : ""),
      confirmLabel: "收回",
      danger: true,
    });
    if (!ok) return;

    setRecalling(batchId);
    setSentError("");
    try {
      const result = await client.adminDeleteNotificationBatch(batchId);
      setNotice(`已收回「${result.title}」，移除 ${result.deleted} 則。`);
      setSentReloadKey((key) => key + 1);
    } catch (caught) {
      setSentError((caught as ApiClientError).message || "收回失敗，請稍後再試。");
    } finally {
      setRecalling("");
    }
  }

  async function send(event: FormEvent) {
    event.preventDefault();
    if (!canSend || busy) return;

    // Name the actual recipient when there is one. "送給指定使用者" is not a
    // thing anybody can check before pressing send.
    const ok = await confirm({
      title: "送出這則通知？",
      body: `會送給「${needsTarget ? targetLabel || selected?.label : selected?.label}」。送出後無法收回。`,
      confirmLabel: "送出",
    });
    if (!ok) return;

    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await client.adminSendNotification({
        audience,
        target: needsTarget ? target.trim() : undefined,
        title: title.trim(),
        body: bodyText.trim(),
        link: link.trim() || undefined,
      });
      setNotice(`已送出，${result.recipients} 位使用者會在通知中心看到。`);
      setTitle("");
      setBodyText("");
      setLink("");
      setSentReloadKey((key) => key + 1);
    } catch (caught) {
      setError((caught as ApiClientError).message || "送出失敗，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="發送通知">
      <h2 className="admin-subheading">發送站內通知</h2>
      <p className="admin-modal__hint">
        通知會出現在使用者 app 右上角的鈴鐺裡，不需要他們開啟推播權限。送出後會記入稽核紀錄。
      </p>

      {!canSend && <p className="admin-error" role="alert">你的角色沒有發送通知的權限（需要管理員或擁有者）。</p>}
      {error && <p className="admin-error" role="alert">{error}</p>}
      {notice && <p className="admin-notice" aria-live="polite">{notice}</p>}

      <form className="admin-notify-form" onSubmit={send}>
        <label className="admin-field">
          <span>發送對象</span>
          <select
            value={audience}
            onChange={(event) => {
              setAudience(event.target.value as AdminNotificationAudienceOption);
              // A target picked for one audience must not survive into another:
              // a user id left over from 指定使用者 would be sent as a group id.
              setTarget("");
              setTargetLabel("");
            }}
            disabled={!canSend}
          >
            {AUDIENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>
        <p className="admin-modal__hint">{selected?.hint}</p>

        {needsTarget && (
          <TargetPicker
            client={client}
            kind={audience === "user" ? "user" : "group"}
            selected={target}
            disabled={!canSend}
            onPick={(id, label) => {
              setTarget(id);
              setTargetLabel(label);
            }}
          />
        )}

        <label className="admin-field">
          <span>標題</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={80}
            placeholder="例：這週日凌晨會短暫維護"
            disabled={!canSend}
            required
          />
        </label>

        <label className="admin-field">
          <span>內容</span>
          <textarea
            value={bodyText}
            onChange={(event) => setBodyText(event.target.value)}
            rows={5}
            maxLength={1000}
            placeholder="寫給使用者看的完整說明。"
            disabled={!canSend}
            required
          />
        </label>

        <label className="admin-field">
          <span>連結（選填）</span>
          <input
            value={link}
            onChange={(event) => setLink(event.target.value)}
            placeholder="/group/xxxx，只能是站內路徑"
            disabled={!canSend}
          />
        </label>

        <div className="admin-modal__actions">
          <button
            type="submit"
            className="admin-action admin-action--primary"
            disabled={!canSend || busy || !title.trim() || !bodyText.trim() || (needsTarget && !target.trim())}
          >
            {busy ? "送出中…" : "送出通知"}
          </button>
        </div>
      </form>

      <h3 className="admin-subheading admin-subheading--spaced">已送出</h3>
      <p className="admin-modal__hint">
        「已讀」是實際打開通知中心看過的人數——公告沒被讀跟沒送出去是兩件不同的事。收回會把每一份都刪掉，但已經讀過的人不會因此忘記。
      </p>

      {sentError && <p className="admin-error" role="alert">{sentError}</p>}

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>標題</th>
              <th>對象</th>
              <th className="admin-table__num">送達</th>
              <th className="admin-table__num">已讀</th>
              <th>送出者</th>
              <th>時間</th>
              {canSend && <th>操作</th>}
            </tr>
          </thead>
          <tbody>
            {(sent?.batches ?? []).map((batch) => (
              <tr key={batch.batch_id}>
                <td className="admin-table__message" title={batch.body}>
                  {batch.title}
                  {batch.kind === "feedback_reply" && <span className="admin-badge">意見回覆</span>}
                </td>
                <td>{AUDIENCE_OPTIONS.find((option) => option.value === batch.audience)?.label ?? "—"}</td>
                <td className="admin-table__num">{batch.recipients}</td>
                <td className="admin-table__num">
                  {batch.read_count}
                  <span className="admin-muted">
                    {" "}
                    ({batch.recipients > 0 ? Math.round((batch.read_count / batch.recipients) * 100) : 0}%)
                  </span>
                </td>
                <td>{batch.created_by_email ?? "—"}</td>
                <td>{formatDateTime(batch.created_at)}</td>
                {canSend && (
                  <td className="admin-table__actions">
                    <button
                      type="button"
                      className="admin-action admin-action--danger"
                      disabled={recalling === batch.batch_id}
                      onClick={() => recall(batch.batch_id, batch.title, batch.recipients, batch.read_count)}
                    >
                      {recalling === batch.batch_id ? "收回中…" : "收回"}
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {sent?.batches.length === 0 && (
              <tr>
                <td colSpan={canSend ? 7 : 6} className="admin-table__empty">
                  還沒有送出任何通知
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
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
export function ErrorsPanel({ client, route, onNavigate, onCountsChanged, refreshKey }: PanelProps) {
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
  }, [client, route.search, route.status, route.fingerprint, offset, reloadKey, refreshKey]);

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

      {state.error && <p className="admin-error" role="alert">{state.error}</p>}
      {state.loading && !state.page && <p className="admin-loading" role="status">載入中…</p>}

      {state.page && (
        <ListBody loading={state.loading}>
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
        </ListBody>
      )}
    </section>
  );
}

/**
 * The occurrences behind one group: the same flat list the console always had,
 * scoped to a single fingerprint. This is where the per-report detail lives -
 * who hit it, on which page, with what context.
 */
export function ErrorGroupPanel({
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

      {state.error && <p className="admin-error" role="alert">{state.error}</p>}
      {state.loading && !state.page && <p className="admin-loading" role="status">載入中…</p>}

      {state.page && (
        <ListBody loading={state.loading}>
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
        </ListBody>
      )}
    </section>
  );
}
