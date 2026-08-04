import { Archive, Plus, RefreshCw, Scan } from "lucide-react";
import type { Group } from "./appTypes";
import { balanceTone, describeBalance, summarizeGroupBalances } from "./groupBalanceSummary";
import { formatAmount } from "./formatAmount";
import { UI_TEXT } from "./uiText";

type GroupRailProps = {
  activeGroup: Group;
  groups: Group[];
  onCreateGroup: () => void;
  onOpenArchivedGroups: () => void;
  onRefresh: () => void;
  onSelectGroup: (group: Group) => void;
  onShowInviteCode: () => void;
  // When the desktop rail is hidden by the responsive layout, the caller
  // marks it inert so its buttons stay out of the tab order / a11y tree.
  inert?: boolean;
};

const text = UI_TEXT.app;

export function GroupRail({ activeGroup, groups, onCreateGroup, onOpenArchivedGroups, onRefresh, onSelectGroup, onShowInviteCode, inert }: GroupRailProps) {
  // The question people open the app with, answered before they pick a group.
  const summary = summarizeGroupBalances(groups);

  return (
    <aside className="group-rail glass-panel" aria-label={text.groupList} inert={inert} aria-hidden={inert || undefined}>
      <div className="rail-heading">
        <div>
          <h1>群組</h1>
          {summary.known ? (
            <p className="rail-total">
              {summary.totals.length === 0 ? (
                <span className="balance-line settled">{text.balanceSettled}</span>
              ) : (
                // Two currencies is already an unusual amount of information
                // for a header; past that it becomes a list, and a list here
                // pushes the groups themselves off the screen.
                <>
                  {summary.totals.slice(0, 2).map((total) => (
                    <span className={total.netMinor > 0 ? "balance-line positive" : "balance-line negative"} key={total.currency}>
                      {total.netMinor > 0 ? text.balanceOwedToYou : text.balanceYouOwe}{" "}
                      {formatAmount(Math.abs(total.netMinor), total.currency)}
                    </span>
                  ))}
                  {summary.totals.length > 2 ? (
                    <span className="balance-line">{`+${summary.totals.length - 2} ${text.balanceMoreCurrencies}`}</span>
                  ) : null}
                </>
              )}
            </p>
          ) : null}
        </div>
        <div className="rail-heading-actions">
          <button className="rail-icon-action" type="button" aria-label={text.refresh} onClick={onRefresh}>
            <RefreshCw aria-hidden="true" size={20} />
          </button>
          <button className="rail-icon-action" type="button" aria-label={text.archivedGroups} onClick={onOpenArchivedGroups}>
            <Archive aria-hidden="true" size={20} />
          </button>
        </div>
      </div>

      <div className="group-list">
        {groups.map((group) => {
          // Falls back to the currency code when the balance is unknown - an
          // older deployment, or a row patched from a write response.
          const balance = describeBalance(group.balanceMinor, group.currency);
          const tone = balanceTone(group.balanceMinor);

          return (
          <button className={activeGroup.id === group.id ? "group-item active" : "group-item"} type="button" key={group.id} onClick={() => onSelectGroup(group)}>
            <span className="group-item-row">
              {group.coverImageUrl ? (
                <span className="group-item-thumb">
                  <img src={group.coverImageUrl} alt="" loading="lazy" decoding="async" />
                </span>
              ) : (
                <span className="group-item-thumb placeholder" aria-hidden="true" />
              )}
              <span className="group-item-text">
                <strong>{group.name}</strong>
                <span className={tone ? `balance-line ${tone}` : undefined}>{balance ?? group.currency}</span>
              </span>
              {group.unreadCount ? (
                // Counted, not just dotted: "3 筆新的" is a different decision
                // from "1 筆新的" when you are deciding whether to look now.
                <span className="group-item-unread" aria-label={`${group.unreadCount} ${text.unreadEntries}`}>
                  {group.unreadCount > 99 ? "99+" : group.unreadCount}
                </span>
              ) : null}
            </span>
          </button>
          );
        })}
        <button className="group-create-item" type="button" onClick={onCreateGroup}>
          <span className="group-create-icon">
            <Plus aria-hidden="true" size={18} />
          </span>
          <strong>{text.createGroup}</strong>
        </button>
      </div>

      <div className="rail-bottom-actions">
        <button className="rail-join-toggle" type="button" onClick={onShowInviteCode}>
          <Scan aria-hidden="true" size={16} />
          {text.scanOrInputInviteCode}
        </button>
      </div>
    </aside>
  );
}
