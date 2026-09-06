import {
  Archive,
  ChartNoAxesColumn,
  CircleDollarSign,
  History,
  House,
  Pencil,
  Repeat,
  Share,
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
  { id: "recurring", label: text.recurring, icon: Repeat },
];

/**
 * What the mobile drawer shows: everything the bottom bar does not.
 *
 * This component is both the desktop rail and the phone's 設定 drawer, and the
 * same list was wrong for one of them. On a desktop the rail IS the navigation
 * — 群組首頁, 支出記錄 and 分析 have nowhere else to be. On a phone those three
 * are the first three buttons of the bar at the bottom of the screen, so the
 * drawer was offering a second copy of the navigation you had just used to
 * reach it. What is left is what the bar has no room for: the member list and
 * the recurring rules, plus the group's own settings above and below them.
 */
const DRAWER_ITEMS = new Set(["members", "recurring"]);

type GroupSideNavProps = {
  /** "rail" is the desktop navigation; "drawer" is the phone's 設定 sheet. */
  variant?: "rail" | "drawer";
  groupName: string;
  /** Fixed when the group is created, so this is shown rather than edited. */
  currency: string;
  exporting?: boolean;
  onExportCsv: () => void;
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
  variant = "rail",
  groupName,
  currency,
  exporting = false,
  onExportCsv,
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
  const items = variant === "drawer" ? sideNavItems.filter((item) => DRAWER_ITEMS.has(item.id)) : sideNavItems;

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
        {items.map((item) => {
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
      {/* The group's own settings, below the things you can open.
          幣別 is read-only on purpose: it is chosen when the group is created
          and every amount ever entered is denominated in it, so it is a fact
          about the group rather than a preference. It used to be a readOnly
          input in the edit dialog, which looked like a field somebody had
          forgotten to make work. 匯出 CSV moved here from the bottom of 支出記錄
          for the same reason it sits here in the app this drawer is modelled
          on: it is something you do to the group, not part of reading it. */}
      <div className="side-settings-list">
        <div className="side-settings-row">
          <CircleDollarSign aria-hidden="true" size={19} />
          <span>{text.currency}</span>
          <strong>{currency}</strong>
        </div>
        <button className="side-settings-row side-settings-action" type="button" disabled={exporting} onClick={onExportCsv}>
          <Share aria-hidden="true" size={19} />
          <span>{exporting ? text.processing : text.exportCsv}</span>
        </button>
      </div>
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
