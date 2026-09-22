import { Archive, ChevronsLeft, ChevronsRight, Plus, RefreshCw, Scan, Wallet } from "lucide-react";
import type { Group } from "./appTypes";
import { balanceTone, describeBalance, summarizeGroupBalances } from "./groupBalanceSummary";
import { formatAmount } from "./formatAmount";
import { groupDisplayName, isPersonalGroup, orderGroupsForRail } from "./personalLedger";
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
  /**
   * Desktop only. Undefined in the mobile left drawer, which has no strip to
   * collapse — the toggle button only renders when this is passed.
   */
  railExpanded?: boolean;
  onToggleRail?: () => void;
};

const text = UI_TEXT.app;

export function GroupRail({
  activeGroup,
  groups,
  onCreateGroup,
  onOpenArchivedGroups,
  onRefresh,
  onSelectGroup,
  onShowInviteCode,
  inert,
  railExpanded,
  onToggleRail,
}: GroupRailProps) {
  // The question people open the app with, answered before they pick a group.
  const summary = summarizeGroupBalances(groups);

  return (
    <aside className="group-rail glass-panel" aria-label={text.groupList} inert={inert} aria-hidden={inert || undefined}>
      <div className="rail-heading">
        <div className="rail-heading-text">
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
        {orderGroupsForRail(groups).map((group) => {
          const personal = isPersonalGroup(group);
          // Falls back to the currency code when the balance is unknown - an
          // older deployment, or a row patched from a write response. Never
          // computed for the ledger, which has no balance to speak of.
          const balance = personal ? null : describeBalance(group.balanceMinor, group.currency);
          const tone = personal ? null : balanceTone(group.balanceMinor);

          return (
          <button className={activeGroup.id === group.id ? "group-item active" : "group-item"} type="button" key={group.id} onClick={() => onSelectGroup(group)}>
            <span className="group-item-row">
              {personal ? (
                // Never `.placeholder` - that class hides its content on
                // phones (see app-base.css), which would leave the ledger's
                // row with no icon at all on mobile.
                <span className="group-item-thumb group-item-thumb--personal" aria-hidden="true">
                  <Wallet size={20} />
                </span>
              ) : group.coverImageUrl ? (
                <span className="group-item-thumb">
                  <img src={group.coverImageUrl} alt="" loading="lazy" decoding="async" />
                </span>
              ) : (
                // The collapsed strip's only way to tell one group from
                // another — the same first-character fallback MemberAvatar
                // uses when there is no photo.
                <span className="group-item-thumb placeholder" aria-hidden="true">
                  {(group.name || "?").slice(0, 1).toUpperCase()}
                </span>
              )}
              <span className="group-item-text">
                <strong>{groupDisplayName(group)}</strong>
                {personal ? (
                  <span>{UI_TEXT.personalLedger.railSubtitle}</span>
                ) : (
                  <span className={tone ? `balance-line ${tone}` : undefined}>{balance ?? group.currency}</span>
                )}
              </span>
              {!personal && group.unreadCount ? (
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
        {/* Only the desktop instance gets this — the mobile left drawer has no
            strip to collapse, so it is never passed onToggleRail. */}
        {onToggleRail ? (
          <button
            className="rail-toggle"
            type="button"
            aria-expanded={railExpanded ?? false}
            aria-label={railExpanded ? text.collapseGroupList : text.expandGroupList}
            onClick={onToggleRail}
          >
            {railExpanded ? <ChevronsLeft aria-hidden="true" size={16} /> : <ChevronsRight aria-hidden="true" size={16} />}
            <span>{railExpanded ? text.collapseGroupList : text.expandGroupList}</span>
          </button>
        ) : null}
      </div>
    </aside>
  );
}
