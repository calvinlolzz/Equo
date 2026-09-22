import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { GroupSideNav } from "./GroupSideNav";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

/** Clearance kept between the popover and the nearest viewport edge. */
const VIEWPORT_MARGIN = 16;
const POPOVER_WIDTH = 260;
/** Matches .group-menu-popover's own padding + gap-driven natural height for
    the fullest case (owner, all rows) — the ceiling this never needs to grow
    past even on a very tall screen. */
const POPOVER_MAX_HEIGHT = 640;

type PopoverPlacement = { top: number; left: number; maxHeight: number };

/**
 * Where the popover goes, in VIEWPORT coordinates — it is position:fixed
 * (see the CSS), not position:absolute against its trigger, precisely so it
 * is not a descendant of .workspace-grid's `overflow:hidden` any more. That
 * grid is a fixed calc(100vh - 132px) box the ledger scrolls inside of, and
 * an owner's full menu (5 nav rows + settings + archive/delete) is tall
 * enough that the grid clipped 封存群組/刪除群組 off the bottom at every
 * viewport height that was tried, not just short ones — position:fixed
 * escapes that the same way .side-drawer already does elsewhere in this
 * file's neighbourhood, no portal needed since nothing in the ancestor chain
 * (.app-shell/.workspace-grid/.pizo-home/.group-home-card) sets a transform,
 * filter or will-change that would turn it back into a containing block.
 */
function placePopover(anchor: HTMLElement): PopoverPlacement {
  const rect = anchor.getBoundingClientRect();
  const top = rect.bottom + 8;
  const left = Math.max(VIEWPORT_MARGIN, Math.min(rect.left, window.innerWidth - POPOVER_WIDTH - VIEWPORT_MARGIN));
  const available = window.innerHeight - top - VIEWPORT_MARGIN;
  return { top, left, maxHeight: Math.min(POPOVER_MAX_HEIGHT, Math.max(160, available)) };
}

type GroupMenuProps = {
  groupName: string;
  coverImageUrl?: string | null;
  memberCount: number;
  currency: string;
  exporting?: boolean;
  isOwner: boolean;
  onExportCsv: () => void;
  onEditGroup: () => void;
  onNavigate: (id: string) => void;
  onArchive: () => void;
  onDelete: () => void;
  /** True for the caller's own personal ledger - passed straight through to GroupSideNav. */
  personal?: boolean;
};

/**
 * Desktop-only. The wide layout's right-hand column (支出記錄／分析／群組成員／
 * 循環支出, plus 幣別／匯出 CSV and the owner-only archive/delete) was removed
 * in phase 3 of the desktop restyle — this ▾ popover next to the group's name
 * is where all of it went instead, reusing GroupSideNav's `variant="menu"`
 * rather than a second copy of that list.
 *
 * Disclosure, not a menu: aria-expanded + aria-controls, the same pattern
 * RecordsPanel's 進階篩選 toggle and ExpenseComposerSheet's 分帳摘要 toggle
 * already use — not role="menu", which would obligate roving-tabindex/arrow-key
 * navigation this codebase does not otherwise implement.
 */
export function GroupMenu({
  groupName,
  coverImageUrl,
  memberCount,
  currency,
  exporting,
  isOwner,
  onExportCsv,
  onEditGroup,
  onNavigate,
  onArchive,
  onDelete,
  personal = false,
}: GroupMenuProps) {
  const [open, setOpen] = useState(false);
  const [placement, setPlacement] = useState<PopoverPlacement | null>(null);
  const anchorRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const popoverId = useId();

  function close() {
    setOpen(false);
    // The popover always holds focus while open (see the effect below), so
    // closing it any of these ways would otherwise drop focus to <body> -
    // not just untidy, but a real regression for keyboard users, who would
    // lose their place and have Tab restart from the top of the document.
    // If a pointerdown/scroll was itself headed for another focusable
    // element, that element's own default focus behaviour runs after this
    // and simply wins.
    triggerRef.current?.focus();
  }

  // Computed before paint (not a plain effect) so the popover never renders
  // one frame at position:fixed's default (0,0) before this runs.
  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    setPlacement(placePopover(anchorRef.current));
  }, [open]);

  useEffect(() => {
    if (!open) return;

    // pointerdown, not click: this effect is registered on the commit that
    // follows the opening click, so that gesture's own pointerdown has
    // already passed — a "click" listener here would be a coin-flip on
    // event ordering against the trigger's own onClick.
    function onPointerDown(event: PointerEvent) {
      if (!anchorRef.current?.contains(event.target as Node)) close();
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") close();
    }
    // Now that the popover is position:fixed against the viewport rather
    // than the trigger it opened from, a scroll (of .pizo-home, the ledger's
    // own internal scroller, or anything else) would otherwise leave it
    // hanging in place while the trigger moves out from under it. Closing on
    // any scroll is the ordinary, expected fix - not trying to track the
    // trigger and follow it. Capture:true so this catches a scroll fired on
    // ANY nested scrollable element, not just window/document - a "scroll"
    // event does not bubble, but the capture phase still reaches it on the
    // way down.
    function onScroll() {
      close();
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("scroll", onScroll, true);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  useEffect(() => {
    // Depends on `placement`, not just `open`: the popover itself only
    // mounts once placement resolves (one render later than `open` flips
    // true — see the layout effect above), so an effect keyed on [open]
    // alone would fire while popoverRef.current was still null, focus
    // nothing, and never get another chance to.
    if (!open || !placement) return;
    popoverRef.current?.querySelector<HTMLButtonElement>(".side-nav-item")?.focus();
  }, [open, placement]);

  return (
    <div className="group-menu-anchor" ref={anchorRef}>
      <h2>{groupName}</h2>
      <button
        className="group-menu-trigger"
        type="button"
        ref={triggerRef}
        aria-expanded={open}
        // Only wired up while the popover actually exists — the id it points
        // at is only mounted when open, and an aria-controls IDREF that
        // never resolves is an invalid ARIA reference AT tooling flags on
        // every desktop group page, not just while the menu is open.
        aria-controls={open ? popoverId : undefined}
        aria-label={text.groupManage}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronDown aria-hidden="true" size={18} />
      </button>
      {open && placement ? (
        <div
          className="group-menu-popover"
          id={popoverId}
          ref={popoverRef}
          style={{ top: placement.top, left: placement.left, maxHeight: placement.maxHeight }}
        >
          <GroupSideNav
            variant="menu"
            groupName={groupName}
            coverImageUrl={coverImageUrl}
            memberCount={memberCount}
            currency={currency}
            exporting={exporting}
            isOwner={isOwner}
            personal={personal}
            onBeforeNavigate={() => setOpen(false)}
            onEditGroup={onEditGroup}
            onNavigate={onNavigate}
            onArchive={onArchive}
            onDelete={onDelete}
            onExportCsv={() => {
              setOpen(false);
              onExportCsv();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}
