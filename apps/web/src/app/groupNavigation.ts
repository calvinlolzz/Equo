import { UI_TEXT } from "./uiText";

export const GROUP_SIDE_NAV_ITEMS = [
  { id: "home", label: UI_TEXT.groupNavigation.home, targetId: "group-home" },
  { id: "currency", label: UI_TEXT.groupNavigation.currency, targetId: "group-currency" },
  { id: "records", label: UI_TEXT.groupNavigation.records, targetId: "group-records" },
  { id: "analysis", label: UI_TEXT.groupNavigation.analysis, targetId: "group-analysis" },
  { id: "members", label: UI_TEXT.groupNavigation.members, targetId: "group-members" },
] as const;
