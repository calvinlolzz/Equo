import type { DialogMode } from "./appTypes";

/**
 * Which bottom-tab destination the user is currently looking at.
 *
 * The tab bar had no selected state at all: five identical buttons, so nothing
 * on screen told you where you were. There is no router to ask, because three
 * of the tabs open the shared bottom sheet rather than navigating - so the
 * answer is derived from which panel that sheet is showing.
 *
 * Anything else (no dialog, or a dialog that isn't a tab destination - the
 * profile sheet, create-group, an expense detail) leaves "home" selected: those
 * open OVER the home screen, which is still what's behind them.
 */
export type ActiveTab = "home" | "records" | "analysis" | "settings";

/**
 * `settingsOpen` is the group-settings drawer, which is the fifth tab. The
 * member list gets the same answer: it is only reachable from inside that
 * drawer, and the drawer closes on the way - without this the tab bar would
 * snap back to 首頁 the moment you arrived somewhere you navigated to from 群組.
 */
export function resolveActiveTab(dialog: DialogMode, settingsOpen = false): ActiveTab {
  if (dialog === "recordsPanel") return "records";
  if (dialog === "analysisPanel") return "analysis";
  if (dialog === "memberList") return "settings";
  if (settingsOpen) return "settings";
  return "home";
}
