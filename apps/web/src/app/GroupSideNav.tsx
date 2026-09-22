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
 * This filter is a "drawer" thing, not a "rail" thing — the desktop ▾ menu
 * ("menu") carries the same full list "rail" always did. On a desktop that
 * list IS the navigation — 群組首頁, 支出記錄 and 分析 have nowhere else to be.
 * On a phone those three are the first three buttons of the bar at the
 * bottom of the screen, so the drawer would otherwise offer a second copy of
 * the navigation you had just used to reach it. What is left is what the bar
 * has no room for: the member list and the recurring rules, plus the
 * group's own settings above and below them.
 */
const DRAWER_ITEMS = new Set(["members", "recurring"]);

type GroupSideNavProps = {
  /**
   * "rail" is the desktop wide-layout navigation (phase 3: no longer
   * rendered on screen, kept for reversibility); "drawer" is the phone's 設定
   * sheet; "menu" is the desktop ▾ popover next to the group's name, which
   * replaced "rail" as the actual desktop route to this content.
   */
  variant?: "rail" | "drawer" | "menu";
  groupName: string;
  /** Fixed when the group is created, so this is shown rather than edited. */
  currency: string;
  exporting?: boolean;
  onExportCsv: () => void;
  coverImageUrl?: string | null;
  memberCount: number;
  isOwner: boolean;
  /**
   * Called before any navigation/edit/archive/delete/export fires, so the
   * surrounding chrome closes first — the mobile drawer for "drawer", the ▾
   * popover (GroupMenu.tsx) for "menu". Unused by "rail", which is no longer
   * rendered anywhere.
   */
  onBeforeNavigate?: () => void;
  onEditGroup: () => void;
  onNavigate: (id: string) => void;
  onArchive: () => void;
  onDelete: () => void;
  /**
   * True for the caller's own personal ledger: no members to list or invite,
   * no archive/delete (the server rejects both - see handlers/groups.ts),
   * and the edit row is 帳本設定 rather than 編輯群組.
   */
  personal?: boolean;
};

/**
 * The group side navigation (group card, nav list, settings, owner danger
 * actions) — three variants of one list. "menu" (the desktop ▾ popover,
 * GroupMenu.tsx) is the one actually reachable on a wide screen; "drawer" is
 * the phone's 設定 sheet; "rail" — the old three-column layout's permanent
 * right-hand column — is kept only so App.tsx's now-permanently-inert
 * `<aside className="group-side-nav">` still has something to mount, for
 * reversibility, and is not on any screen a user can reach.
 */
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
  personal = false,
}: GroupSideNavProps) {
  const closeDrawer = () => onBeforeNavigate?.();
  const items = (variant === "drawer" ? sideNavItems.filter((item) => DRAWER_ITEMS.has(item.id)) : sideNavItems).filter(
    (item) => !personal || item.id !== "members",
  );
  const editLabel = personal ? UI_TEXT.personalLedger.settingsTitle : text.editGroup;

  return (
    <>
      {variant === "menu" ? null : (
        <div className="side-group-card">
          <div className="side-cover">{coverImageUrl ? <img src={coverImageUrl} alt="" loading="lazy" decoding="async" /> : null}</div>
          <div className="side-group-name">
            <div className="side-group-title-row">
              <h2>{groupName}</h2>
              {isOwner ? (
                <button
                  className="side-edit-group"
                  type="button"
                  aria-label={editLabel}
                  onClick={() => {
                    closeDrawer();
                    onEditGroup();
                  }}
                >
                  <Pencil aria-hidden="true" size={15} />
                </button>
              ) : null}
            </div>
            {/* The ledger has exactly one member (its owner) - a count that
                never varies is not information, so the header just doesn't
                say it. */}
            {personal ? null : (
              <span>
                {memberCount} {text.people}
              </span>
            )}
          </div>
        </div>
      )}
      {/* One visual list, two elements: the destinations stay inside a <nav>
          because they are navigation, and 幣別 / 匯出 CSV are not - one is a
          fact and the other an action. Wrapping them keeps that distinction in
          the markup while closing the 16px drawer gap that fell between them
          and made four rows read as two stranded pairs. */}
      <div className="side-lists">
        <nav className="side-nav-list" aria-label={text.groupHome}>
          {items.map((item) => {
            const Icon = item.icon;
            // Personal ledgers have no "group" to be the home of, so the
            // first row reads 帳本首頁 instead of 群組首頁.
            const label = item.id === "home" && personal ? UI_TEXT.personalLedger.homeLabel : item.label;
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
                {label}
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
          {/* The popover has no cover/name/pencil header (see above), so this
              is the only desktop route to 編輯群組 left once that header is
              gone. Owner-gated to match the pencil's own gating. */}
          {variant === "menu" && isOwner ? (
            <button
              className="side-settings-row side-settings-action"
              type="button"
              onClick={() => {
                closeDrawer();
                onEditGroup();
              }}
            >
              <Pencil aria-hidden="true" size={19} />
              <span>{editLabel}</span>
            </button>
          ) : null}
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
      </div>
      {isOwner && !personal ? (
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
