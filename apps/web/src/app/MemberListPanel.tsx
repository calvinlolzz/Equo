import { BellRing, Check, Inbox, Pencil, UserMinus, UserRound, Wallet, X } from "lucide-react";
import type { Member } from "./appTypes";
import { describeMemberBalance } from "./groupBalanceSummary";
import { settlementBetween, type SettlementIntent } from "./settlementActions";
import { MemberAvatar } from "./MemberAvatar";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

type MemberListPanelProps = {
  members: Member[];
  balances: Map<string, number>;
  currency: string;
  renamingMemberId: string;
  renameMemberValue: string;
  /** Which row's 收款資訊 is mid-edit, and its draft value. */
  editingPaymentNoteMemberId: string;
  paymentNoteValue: string;
  confirmingRemoveMemberId: string;
  pendingAction: string | null;
  /** The logged-in user's own member row, so they aren't offered a reminder to themselves. */
  currentMemberId?: string;
  /** Members already reminded in this session — the button stays, spent, rather than vanishing. */
  nudgedMemberIds?: string[];
  onNudge?: (member: Member) => void;
  /**
   * Settle up directly with this row. Only offered where something can
   * actually pass between the two of you — the row works that out from the
   * balances it already has (see settlementBetween) and hands over the
   * transfer it decided on, so nothing recomputes it a second way.
   */
  onSettleWith?: (member: Member, intent: SettlementIntent) => void;
  onRenameValueChange: (value: string) => void;
  onStartRename: (member: Member) => void;
  onCancelRename: () => void;
  onSubmitRename: (member: Member) => void;
  onPaymentNoteValueChange: (value: string) => void;
  onStartEditPaymentNote: (member: Member) => void;
  onCancelEditPaymentNote: () => void;
  onSubmitPaymentNote: (member: Member) => void;
  onRemove: (member: Member) => void;
  onInvite: () => void;
  onAddVirtualMember: () => void;
};

/** The 群組成員 bottom-sheet content: member rows with balances, virtual-member rename/remove, invite + add actions. */
export function MemberListPanel({
  members,
  balances,
  currency,
  renamingMemberId,
  renameMemberValue,
  editingPaymentNoteMemberId,
  paymentNoteValue,
  confirmingRemoveMemberId,
  pendingAction,
  currentMemberId,
  nudgedMemberIds = [],
  onNudge,
  onSettleWith,
  onRenameValueChange,
  onStartRename,
  onCancelRename,
  onSubmitRename,
  onPaymentNoteValueChange,
  onStartEditPaymentNote,
  onCancelEditPaymentNote,
  onSubmitPaymentNote,
  onRemove,
  onInvite,
  onAddVirtualMember,
}: MemberListPanelProps) {
  return (
    <>
      <div className="dialog-header">
        <h3>{text.members}</h3>
        <p>
          {members.length} {text.people}
        </p>
      </div>
      <div className="dialog-section-list">
        <span className="dialog-list-title">{text.members}</span>
        {members.map((member) => {
          // Only VIRTUAL members can be renamed/removed - real users own their
          // names via their profile, and the owner is protected. (A virtual
          // member is never the owner.)
          const manageable = Boolean(member.virtual);
          const isRenaming = manageable && renamingMemberId === member.id;
          const renamePending = pendingAction === `renameMember:${member.id}`;
          const removePending = pendingAction === `removeMember:${member.id}`;
          // Only somebody who owes the group, has an account to notify, and
          // isn't you. The server enforces all three again - this is about not
          // offering a button that can only fail.
          const nudgeable =
            Boolean(onNudge) &&
            !member.virtual &&
            member.id !== currentMemberId &&
            (balances.get(member.id) ?? 0) < 0;
          const nudged = nudgedMemberIds.includes(member.id);
          /**
           * What settling straight with this person would mean, if anything.
           *
           * The suggestions on the home card are the MINIMAL set — A owing B
           * is routinely routed as A → C — so a pair with money between them
           * may never appear there. "I want to pay Bob back" is a thing people
           * say about Bob, not about the transfer graph.
           *
           * null when the two of you are on the same side of zero, or either
           * is square: there is genuinely nothing to record.
           */
          const settleIntent =
            onSettleWith && currentMemberId && member.id !== currentMemberId
              ? settlementBetween(
                  { id: currentMemberId, balanceMinor: balances.get(currentMemberId) ?? 0 },
                  { id: member.id, balanceMinor: balances.get(member.id) ?? 0 },
                )
              : null;
          const settleable = Boolean(settleIntent);
          const nudgePending = pendingAction === `nudge:${member.id}`;
          // 收款資訊 is yours to write, or anybody's to write for a virtual
          // member (which has nobody to speak for it). Owning the group is not
          // a reason to publish someone else's account details - the server
          // enforces the same rule.
          const canEditPaymentNote = member.id === currentMemberId || Boolean(member.virtual);
          const editingNote = editingPaymentNoteMemberId === member.id;
          const notePending = pendingAction === `paymentNote:${member.id}`;
          const note = member.paymentNote?.trim() ?? "";
          return (
            <div className="member-dialog-entry" key={member.id}>
            <div
              className={manageable || nudgeable || settleable ? "member-dialog-row has-member-actions" : "member-dialog-row"}
            >
              <MemberAvatar className="member-avatar" name={member.name} avatarUrl={member.avatarUrl} />
              {isRenaming ? (
                <>
                  <input
                    className="member-rename-input"
                    value={renameMemberValue}
                    onChange={(event) => onRenameValueChange(event.target.value)}
                    maxLength={50}
                    aria-label={text.renameMember}
                    autoFocus
                  />
                  <span className="member-row-actions">
                    <button
                      className="member-icon-action confirm"
                      type="button"
                      aria-label={text.confirm}
                      disabled={!renameMemberValue.trim() || renamePending}
                      onClick={() => onSubmitRename(member)}
                    >
                      <Check aria-hidden="true" size={15} />
                    </button>
                    <button
                      className="member-icon-action"
                      type="button"
                      aria-label={text.cancel}
                      disabled={renamePending}
                      onClick={onCancelRename}
                    >
                      <X aria-hidden="true" size={15} />
                    </button>
                  </span>
                </>
              ) : (
                <>
                  <span>
                    <strong>{member.name}</strong>
                    <small>{member.virtual ? text.virtualMember : member.role === "owner" ? text.owner : text.member}</small>
                  </span>
                  {nudgeable || settleable ? (
                    <span className="member-row-actions">
                      {settleable ? (
                        <button
                          className="member-icon-action settle"
                          type="button"
                          aria-label={`${text.settleWithMember}: ${member.name}`}
                          disabled={pendingAction === `settle:${member.id}`}
                          onClick={() => settleIntent && onSettleWith?.(member, settleIntent)}
                        >
                          <Wallet aria-hidden="true" size={15} />
                        </button>
                      ) : null}
                      {nudgeable ? (
                        <button
                          className={nudged ? "member-icon-action nudge sent" : "member-icon-action nudge"}
                          type="button"
                          aria-label={`${text.nudgeAria}: ${member.name}`}
                          disabled={nudgePending || nudged}
                          onClick={() => onNudge?.(member)}
                        >
                          <BellRing aria-hidden="true" size={14} />
                          {nudged ? text.nudgeSent : text.nudge}
                        </button>
                      ) : null}
                    </span>
                  ) : null}
                  {manageable ? (
                    <span className="member-row-actions">
                      <button
                        className="member-icon-action"
                        type="button"
                        aria-label={text.renameMember}
                        disabled={removePending}
                        onClick={() => onStartRename(member)}
                      >
                        <Pencil aria-hidden="true" size={14} />
                      </button>
                      <button
                        className={
                          confirmingRemoveMemberId === member.id
                            ? "member-icon-action danger confirming"
                            : "member-icon-action danger"
                        }
                        type="button"
                        aria-label={text.removeMember}
                        disabled={removePending}
                        onClick={() => onRemove(member)}
                      >
                        {confirmingRemoveMemberId === member.id ? (
                          text.confirmRemoveMember
                        ) : (
                          <UserMinus aria-hidden="true" size={14} />
                        )}
                      </button>
                    </span>
                  ) : null}
                  <b>{describeMemberBalance(balances.get(member.id) ?? 0, currency, member.id === currentMemberId)}</b>
                </>
              )}
            </div>
            {editingNote ? (
              <div className="member-payment-note member-payment-note--editing">
                <input
                  className="member-rename-input"
                  value={paymentNoteValue}
                  onChange={(event) => onPaymentNoteValueChange(event.target.value)}
                  maxLength={200}
                  placeholder={UI_TEXT.paymentNote.placeholder}
                  aria-label={UI_TEXT.paymentNote.label}
                  autoFocus
                />
                <span className="member-row-actions">
                  <button
                    className="member-icon-action confirm"
                    type="button"
                    aria-label={UI_TEXT.paymentNote.save}
                    disabled={notePending}
                    onClick={() => onSubmitPaymentNote(member)}
                  >
                    <Check aria-hidden="true" size={15} />
                  </button>
                  <button
                    className="member-icon-action"
                    type="button"
                    aria-label={UI_TEXT.paymentNote.cancel}
                    disabled={notePending}
                    onClick={onCancelEditPaymentNote}
                  >
                    <X aria-hidden="true" size={15} />
                  </button>
                </span>
              </div>
            ) : note || canEditPaymentNote ? (
              <div className="member-payment-note">
                <Wallet aria-hidden="true" size={13} />
                <span className={note ? "member-payment-note__value" : "member-payment-note__value is-empty"}>
                  {note || UI_TEXT.paymentNote.empty}
                </span>
                {canEditPaymentNote && (
                  <button
                    className="member-icon-action"
                    type="button"
                    aria-label={note ? UI_TEXT.paymentNote.edit : UI_TEXT.paymentNote.add}
                    disabled={notePending}
                    onClick={() => onStartEditPaymentNote(member)}
                  >
                    <Pencil aria-hidden="true" size={13} />
                  </button>
                )}
              </div>
            ) : null}
            </div>
          );
        })}
      </div>
      <div className="dialog-action-row">
        <button className="secondary-action" type="button" onClick={onInvite}>
          <Inbox aria-hidden="true" size={18} />
          {text.inviteMembers}
        </button>
        <button className="primary-action" type="button" onClick={onAddVirtualMember}>
          <UserRound aria-hidden="true" size={18} />
          {text.addVirtualMember}
        </button>
      </div>
    </>
  );
}
