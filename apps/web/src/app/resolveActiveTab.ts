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
export type ActiveTab = "home" | "records" | "analysis" | "members";

export function resolveActiveTab(dialog: DialogMode): ActiveTab {
  if (dialog === "recordsPanel") return "records";
  if (dialog === "analysisPanel") return "analysis";
  if (dialog === "memberList") return "members";
  return "home";
}
