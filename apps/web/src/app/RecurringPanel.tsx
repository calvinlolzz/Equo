import { useEffect, useMemo, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import type { RecurringExpense, RecurringExpenseInput } from "./apiClient";
import type { Member } from "./appTypes";
import { categoryOptionsFor } from "./catalog";
import { formatAmount } from "./formatAmount";
import { MemberAvatar } from "./MemberAvatar";
import { UI_TEXT } from "./uiText";

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
  /**
   * True for the caller's own personal ledger. Recurring rules are
   * expense-only there too (see the plan's §9), but a one-member ledger has
   * nobody to pick as payer or share with - defaultPayer/emptyDraft already
   * resolve both to "me", so the pickers are hidden rather than shown with
   * one disabled option each.
   */
  personal?: boolean;
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
  personal = false,
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
        <h3>{UI_TEXT.recurring.title}</h3>
        <p>{UI_TEXT.recurring.description}</p>
      </div>

      {error ? (
        <div className="spend-period-error">
          <p>{error}</p>
          <button className="composer-mini-action" type="button" onClick={onRetry}>
            {UI_TEXT.recurring.retry}
          </button>
        </div>
      ) : null}

      {draft ? (
        <div className="dialog-section-list recurring-form">
          <span className="dialog-list-title">{draft.id ? UI_TEXT.recurring.editTitle : UI_TEXT.recurring.addTitle}</span>

          <label className="composer-field">
            <span>{UI_TEXT.recurring.itemLabel}</span>
            <input
              value={draft.title}
              placeholder={UI_TEXT.recurring.itemPlaceholder}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>

          <label className="composer-field">
            <span>{UI_TEXT.recurring.amountLabel}</span>
            <input
              value={draft.amount}
              inputMode="decimal"
              placeholder="0"
              onChange={(event) => setDraft({ ...draft, amount: event.target.value })}
            />
          </label>

          <label className="composer-field">
            <span>{UI_TEXT.recurring.dayLabel}</span>
            <select
              value={draft.dayOfMonth}
              onChange={(event) => setDraft({ ...draft, dayOfMonth: Number(event.target.value) })}
            >
              {DAYS.map((day) => (
                <option key={day} value={day}>{`${day} ${UI_TEXT.recurring.daySuffix}`.trimEnd()}</option>
              ))}
            </select>
            <small className="recurring-hint">{UI_TEXT.recurring.dayHint}</small>
          </label>

          <label className="composer-field">
            <span>{UI_TEXT.recurring.categoryLabel}</span>
            <select
              value={draft.category}
              onChange={(event) => setDraft({ ...draft, category: event.target.value })}
            >
              {categoryOptionsFor({ personal, mode: "expense" }).map((option) => (
                <option key={option.key} value={option.key}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {personal ? null : (
            <label className="composer-field">
              <span>{UI_TEXT.recurring.payerLabel}</span>
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
          )}

          {personal ? null : (
            <div className="composer-field">
              <span>{UI_TEXT.recurring.shareLabel}</span>
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
              <small className="recurring-hint">{UI_TEXT.recurring.shareHint}</small>
            </div>
          )}

          <label className="composer-field">
            <span>{UI_TEXT.recurring.noteLabel}</span>
            <input
              value={draft.note}
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            />
          </label>

          <div className="recurring-form-actions">
            <button className="composer-mini-action" type="button" onClick={() => setDraft(null)}>
              {UI_TEXT.recurring.cancel}
            </button>
            <button
              className="composer-submit"
              type="button"
              disabled={!draftValid || savingId === "save"}
              onClick={submit}
            >
              {savingId === "save" ? UI_TEXT.recurring.working : UI_TEXT.recurring.save}
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
          <Plus aria-hidden="true" size={16} /> {UI_TEXT.recurring.addAction}
        </button>
      )}

      <div className="dialog-section-list">
        <span className="dialog-list-title">{UI_TEXT.recurring.currentRules}</span>
        {loading && rules.length === 0 ? (
          <p className="dialog-empty">{UI_TEXT.recurring.loading}</p>
        ) : rules.length === 0 ? (
          <p className="dialog-empty">{UI_TEXT.recurring.empty}</p>
        ) : (
          rules.map((rule) => (
            <div className={rule.active ? "recurring-row" : "recurring-row inactive"} key={rule.id}>
              <button className="recurring-row-main" type="button" onClick={() => setDraft(toDraft(rule))}>
                <span className="recurring-row-title">
                  <strong>{rule.title}</strong>
                  <small>
                    {rule.active
                      ? `${UI_TEXT.recurring.rulePrefix}${rule.day_of_month}${UI_TEXT.recurring.ruleMiddle}${rule.next_run_date}`
                      : UI_TEXT.recurring.disabled}
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
                <small>{`${memberName.get(rule.payer_member_id) ?? "?"} ${UI_TEXT.recurring.paidBy}`}</small>
              </div>
              {rule.last_error ? <p className="recurring-row-error">{rule.last_error}</p> : null}
              <button
                className="recurring-row-delete"
                type="button"
                aria-label={`${UI_TEXT.recurring.deleteRule} ${rule.title}`}
                disabled={savingId === rule.id}
                onClick={() => onDelete(rule.id)}
              >
                <Trash2 aria-hidden="true" size={16} />
              </button>
            </div>
          ))
        )}
        <p className="recurring-footnote">
          {UI_TEXT.recurring.deleteHint}
        </p>
      </div>
    </>
  );
}
