import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { RecurringExpense, RecurringExpenseInput } from "./apiClient";
import type { Member } from "./appTypes";
import { categoryOptions } from "./catalog";
import { formatAmount } from "./formatAmount";
import { MemberAvatar } from "./MemberAvatar";

type Props = {
  members: Member[];
  currency: string;
  /** The logged-in user's own member row — the default payer. */
  currentMemberId: string | null;
  rules: RecurringExpense[];
  loading: boolean;
  error: string | null;
  savingId: string | null;
  onSave: (input: RecurringExpenseInput) => Promise<boolean>;
  onDelete: (id: string) => void;
  onRetry: () => void;
};

type Draft = {
  id?: string;
  title: string;
  amount: string;
  dayOfMonth: number;
  payerMemberId: string;
  shareMemberIds: string[];
  category: string;
  note: string;
};

/** 1-28 only. February has no 29th in three years out of four, and silently
 *  clamping a 31 would move somebody's rent day every other month. */
const DAYS = Array.from({ length: 28 }, (_, i) => i + 1);

function emptyDraft(members: Member[], payerId: string): Draft {
  return {
    title: "",
    amount: "",
    dayOfMonth: 1,
    payerMemberId: payerId,
    shareMemberIds: members.map((member) => member.id),
    category: "other",
    note: "",
  };
}

function toDraft(rule: RecurringExpense): Draft {
  return {
    id: rule.id,
    title: rule.title,
    // Editing works in the major units the user sees, not stored minor units.
    amount: String(rule.amount_minor / 100),
    dayOfMonth: rule.day_of_month,
    payerMemberId: rule.payer_member_id,
    shareMemberIds: [...rule.share_member_ids],
    category: rule.category,
    note: rule.note ?? "",
  };
}

/**
 * 循環支出: the monthly bills that otherwise get retyped — rent, utilities,
 * internet, management fees.
 *
 * The rules are templates, not expenses. A nightly job turns each one into a
 * real expense when its day comes round, and those behave like any other entry
 * from then on (editable, deletable, counted in balances). Deleting a rule
 * therefore leaves the entries it already produced alone — the panel says so,
 * because "delete the recurring rent" could otherwise read as "delete every
 * rent payment we ever recorded".
 */
export function RecurringPanel({
  members,
  currency,
  currentMemberId,
  rules,
  loading,
  error,
  savingId,
  onSave,
  onDelete,
  onRetry,
}: Props) {
  const defaultPayer = currentMemberId ?? members[0]?.id ?? "";
  const [draft, setDraft] = useState<Draft | null>(null);
  const memberName = useMemo(
    () => new Map(members.map((member) => [member.id, member.name])),
    [members],
  );

  // A group that finishes loading after the panel opened would otherwise leave
  // a draft with nobody selected.
  useEffect(() => {
    if (draft && !draft.id && draft.shareMemberIds.length === 0 && members.length > 0) {
      setDraft({ ...draft, shareMemberIds: members.map((member) => member.id), payerMemberId: defaultPayer });
    }
  }, [members, draft, defaultPayer]);

  const amountMinor = draft ? Math.round(Number(draft.amount.replace(/,/g, "")) * 100) : 0;
  const draftValid =
    draft !== null &&
    draft.title.trim() !== "" &&
    Number.isFinite(amountMinor) &&
    amountMinor > 0 &&
    draft.payerMemberId !== "" &&
    draft.shareMemberIds.length > 0;

  async function submit() {
    if (!draft || !draftValid) return;
    const saved = await onSave({
      id: draft.id,
      title: draft.title.trim(),
      amount_minor: amountMinor,
      currency,
      category: draft.category,
      note: draft.note.trim() || null,
      payer_member_id: draft.payerMemberId,
      share_member_ids: draft.shareMemberIds,
      day_of_month: draft.dayOfMonth,
    });
    if (saved) setDraft(null);
  }

  function toggleShare(memberId: string) {
    if (!draft) return;
    const next = draft.shareMemberIds.includes(memberId)
      ? draft.shareMemberIds.filter((id) => id !== memberId)
      : [...draft.shareMemberIds, memberId];
    setDraft({ ...draft, shareMemberIds: next });
  }

  return (
    <>
      <div className="dialog-header">
        <h3>{"循環支出"}</h3>
        <p>{"每個月自動記一筆，房租、水電、網路這種不用再重打。"}</p>
      </div>

      {error ? (
        <div className="spend-period-error">
          <p>{error}</p>
          <button className="composer-mini-action" type="button" onClick={onRetry}>
            {"重試"}
          </button>
        </div>
      ) : null}

      {draft ? (
        <div className="dialog-section-list recurring-form">
          <span className="dialog-list-title">{draft.id ? "編輯循環支出" : "新增循環支出"}</span>

          <label className="composer-field">
            <span>{"項目"}</span>
            <input
              value={draft.title}
              placeholder="房租"
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>

          <label className="composer-field">
            <span>{"金額"}</span>
            <input
              value={draft.amount}
              inputMode="decimal"
              placeholder="0"
              onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
            />
          </label>

          <label className="composer-field">
            <span>{"每月幾號"}</span>
            <select
              value={draft.dayOfMonth}
              onChange={(event) => setDraft({ ...draft, dayOfMonth: Number(event.target.value) })}
            >
              {DAYS.map((day) => (
                <option key={day} value={day}>{`${day} 號`}</option>
              ))}
            </select>
            <small className="recurring-hint">{"只到 28 號：二月沒有 29-31 號，夾過去會讓日期每年跳一次。"}</small>
          </label>

          <label className="composer-field">
            <span>{"分類"}</span>
            <select
              value={draft.category}
              onChange={(event) => setDraft({ ...draft, category: event.target.value })}
            >
              {categoryOptions().map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <label className="composer-field">
            <span>{"誰付錢"}</span>
            <select
              value={draft.payerMemberId}
              onChange={(event) => setDraft({ ...draft, payerMemberId: event.target.value })}
            >
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name}
                </option>
              ))}
            </select>
          </label>

          <div className="composer-field">
            <span>{"分攤給"}</span>
            <div className="recurring-share-row">
              {members.map((member) => (
                <button
                  key={member.id}
                  className={draft.shareMemberIds.includes(member.id) ? "recurring-chip active" : "recurring-chip"}
                  type="button"
                  aria-pressed={draft.shareMemberIds.includes(member.id)}
                  onClick={() => toggleShare(member.id)}
                >
                  {member.name}
                </button>
              ))}
            </div>
            <small className="recurring-hint">{"平均分攤，餘數會分給排在前面的人。"}</small>
          </div>

          <label className="composer-field">
            <span>{"備註"}</span>
            <input
              value={draft.note}
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            />
          </label>

          <div className="recurring-form-actions">
            <button className="composer-mini-action" type="button" onClick={() => setDraft(null)}>
              {"取消"}
            </button>
            <button
              className="composer-submit"
              type="button"
              disabled={!draftValid || savingId === "save"}
              onClick={submit}
            >
              {savingId === "save" ? "處理中…" : "儲存"}
            </button>
          </div>
        </div>
      ) : (
        <button
          className="composer-mini-action recurring-add"
          type="button"
          disabled={members.length === 0}
          onClick={() => setDraft(emptyDraft(members, defaultPayer))}
        >
          <Plus aria-hidden="true" size={16} /> {"新增循環支出"}
        </button>
      )}

      <div className="dialog-section-list">
        <span className="dialog-list-title">{"目前的規則"}</span>
        {loading && rules.length === 0 ? (
          <p className="dialog-empty">{"載入中…"}</p>
        ) : rules.length === 0 ? (
          <p className="dialog-empty">{"還沒有循環支出。"}</p>
        ) : (
          rules.map((rule) => (
            <div className={rule.active ? "recurring-row" : "recurring-row inactive"} key={rule.id}>
              <button className="recurring-row-main" type="button" onClick={() => setDraft(toDraft(rule))}>
                <span className="recurring-row-title">
                  <strong>{rule.title}</strong>
                  <small>
                    {rule.active
                      ? `每月 ${rule.day_of_month} 號・下次 ${rule.next_run_date}`
                      : "已停用"}
                  </small>
                </span>
                <b>{formatAmount(rule.amount_minor, rule.currency)}</b>
              </button>
              <div className="recurring-row-people">
                {rule.share_member_ids.map((id) => (
                  <MemberAvatar
                    key={id}
                    className="member-avatar tiny"
                    name={memberName.get(id)}
                  />
                ))}
                <small>{`${memberName.get(rule.payer_member_id) ?? "?"} 付`}</small>
              </div>
              {rule.last_error ? <p className="recurring-row-error">{rule.last_error}</p> : null}
              <button
                className="recurring-row-delete"
                type="button"
                aria-label={`刪除 ${rule.title}`}
                disabled={savingId === rule.id}
                onClick={() => onDelete(rule.id)}
              >
                <Trash2 aria-hidden="true" size={16} />
              </button>
            </div>
          ))
        )}
        <p className="recurring-footnote">
          {"刪除規則只是以後不再自動記帳，已經產生的支出會留著。"}
        </p>
      </div>
    </>
  );
}
