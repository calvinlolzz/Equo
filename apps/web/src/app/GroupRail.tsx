import { Archive, Plus, RefreshCw, Ticket } from "lucide-react";
import type { Group } from "./appTypes";
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
  return (
    <aside className="group-rail glass-panel" aria-label={text.groupList} inert={inert} aria-hidden={inert || undefined}>
      <div className="rail-heading">
        <div>
          <h1>群組</h1>
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
        {groups.map((group) => (
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
                <span>{group.currency}</span>
              </span>
            </span>
          </button>
        ))}
        <button className="group-create-item" type="button" onClick={onCreateGroup}>
          <span className="group-create-icon">
            <Plus aria-hidden="true" size={18} />
          </span>
          <strong>{text.createGroup}</strong>
        </button>
      </div>

      <div className="rail-bottom-actions">
        <button className="rail-join-toggle" type="button" onClick={onShowInviteCode}>
          <Ticket aria-hidden="true" size={16} />
          {text.inputInviteCode}
        </button>
      </div>
    </aside>
  );
}
