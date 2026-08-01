import {
  Archive,
  ChartNoAxesColumn,
  History,
  House,
  Pencil,
  Trash2,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

export const sideNavItems: Array<{ id: string; label: string; icon: LucideIcon }> = [
  { id: "home", label: text.groupHome, icon: House },
  { id: "records", label: text.records, icon: History },
  { id: "analysis", label: text.analysis, icon: ChartNoAxesColumn },
  { id: "members", label: text.members, icon: UserRound },
];

type GroupSideNavProps = {
  groupName: string;
  coverImageUrl?: string | null;
  memberCount: number;
  isOwner: boolean;
  /** Called before any navigation when rendered inside the mobile drawer, so the drawer closes first. */
  onBeforeNavigate?: () => void;
  onEditGroup: () => void;
  onNavigate: (id: string) => void;
  onArchive: () => void;
  onDelete: () => void;
};

/** The group side navigation (profile dot, group card, nav list, owner danger actions) - rendered in both the desktop rail and the mobile settings drawer. */
export function GroupSideNav({
  groupName,
  coverImageUrl,
  memberCount,
  isOwner,
  onBeforeNavigate,
  onEditGroup,
  onNavigate,
  onArchive,
  onDelete,
}: GroupSideNavProps) {
  const closeDrawer = () => onBeforeNavigate?.();

  return (
    <>
      <div className="side-group-card">
        <div className="side-cover">{coverImageUrl ? <img src={coverImageUrl} alt="" loading="lazy" decoding="async" /> : null}</div>
        <div className="side-group-name">
          <div className="side-group-title-row">
            <h2>{groupName}</h2>
            {isOwner ? (
              <button
                className="side-edit-group"
                type="button"
                aria-label={text.editGroup}
                onClick={() => {
                  closeDrawer();
                  onEditGroup();
                }}
              >
                <Pencil aria-hidden="true" size={15} />
              </button>
            ) : null}
          </div>
          <span>
            {memberCount} {text.people}
          </span>
        </div>
      </div>
      <nav className="side-nav-list" aria-label={text.groupHome}>
        {sideNavItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              className={item.id === "home" ? "side-nav-item active" : "side-nav-item"}
              type="button"
              key={item.id}
              onClick={() => {
                closeDrawer();
                onNavigate(item.id);
              }}
            >
              <Icon aria-hidden="true" size={19} />
              {item.label}
            </button>
          );
        })}
      </nav>
      {isOwner ? (
        <div className="side-danger-actions">
          <button
            className="side-archive-action"
            type="button"
            onClick={() => {
              closeDrawer();
              onArchive();
            }}
          >
            <Archive aria-hidden="true" size={16} />
            {text.archiveGroup}
          </button>
          <button
            className="side-delete-action"
            type="button"
            onClick={() => {
              closeDrawer();
              onDelete();
            }}
          >
            <Trash2 aria-hidden="true" size={16} />
            {text.deleteGroup}
          </button>
        </div>
      ) : null}
    </>
  );
}
