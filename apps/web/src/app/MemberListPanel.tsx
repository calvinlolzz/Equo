import { Check, Inbox, Pencil, UserMinus, UserRound, X } from "lucide-react";
import type { Member } from "./appTypes";
import { formatSigned } from "./formatAmount";
import { MemberAvatar } from "./MemberAvatar";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

type MemberListPanelProps = {
  members: Member[];
  balances: Map<string, number>;
  currency: string;
  renamingMemberId: string;
  renameMemberValue: string;
  confirmingRemoveMemberId: string;
  pendingAction: string | null;
  onRenameValueChange: (value: string) => void;
  onStartRename: (member: Member) => void;
  onCancelRename: () => void;
  onSubmitRename: (member: Member) => void;
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
  confirmingRemoveMemberId,
  pendingAction,
  onRenameValueChange,
  onStartRename,
  onCancelRename,
  onSubmitRename,
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
          return (
            <div
              className={manageable ? "member-dialog-row has-member-actions" : "member-dialog-row"}
              key={member.id}
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
                  <b>{formatSigned(balances.get(member.id) ?? 0, currency)}</b>
                </>
              )}
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
