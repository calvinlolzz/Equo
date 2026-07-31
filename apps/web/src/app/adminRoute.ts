import type { AdminGroupFilterOption } from "./apiClient";

/**
 * The console's location, as a URL.
 *
 * Every list in the admin console used to live in component state, which meant
 * a reload dropped you back on 總覽, the browser Back button left the page
 * entirely, and there was no way to send a colleague "look at this group" - the
 * URL said /admin no matter what was on screen. All of that is one problem: the
 * console had no addressable state.
 *
 * This module is the whole vocabulary, as pure functions over a query string,
 * so the parsing rules are testable without a browser and the component only
 * has to deal with pushState.
 */

export type AdminTab = "overview" | "users" | "groups" | "feedback" | "errors" | "audit" | "admins";

const TABS: readonly AdminTab[] = ["overview", "users", "groups", "feedback", "errors", "audit", "admins"];

const GROUP_FILTERS: readonly AdminGroupFilterOption[] = ["all", "archived", "empty", "deleted"];

const FEEDBACK_STATUSES: readonly string[] = ["all", "new", "reviewing", "done"];

const ERROR_STATUSES: readonly string[] = ["all", "open", "resolved"];

/** Rows per page. Lives here because the URL carries a 1-based page, not an offset. */
export const ADMIN_PAGE_SIZE = 20;

export const TREND_WINDOWS: readonly number[] = [7, 30, 90];

export type AdminRoute = {
  tab: AdminTab;
  /** Committed search term (the typing buffer stays in the component). */
  search: string;
  /** Feedback status on the feedback tab, error-group status on the errors tab. */
  status: string;
  /** Audit action filter. */
  action: string;
  filter: AdminGroupFilterOption;
  /** 1-based, so the URL reads the way the pager does. */
  page: number;
  /** Open user drill-down. */
  userId: string;
  /** Open group drill-down (reachable from the groups tab and from a user's row). */
  groupId: string;
  /** Open error-group drill-down. */
  fingerprint: string;
  /** Trend window on the overview. */
  days: number;
};

export const DEFAULT_ADMIN_ROUTE: AdminRoute = {
  tab: "overview",
  search: "",
  status: "all",
  action: "",
  filter: "all",
  page: 1,
  userId: "",
  groupId: "",
  fingerprint: "",
  days: 30,
};

function oneOf<T extends string>(value: string | null, allowed: readonly T[], fallback: T): T {
  return value && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/**
 * A URL is something a person can hand-edit, so every field is validated back
 * into range rather than trusted: a bad tab lands on 總覽, page 0 or "abc"
 * becomes page 1, an unknown filter becomes 全部. The console never renders a
 * state it cannot produce itself.
 */
export function parseAdminRoute(search: string): AdminRoute {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const page = Number(params.get("page"));
  const days = Number(params.get("days"));
  const tab = oneOf(params.get("tab"), TABS, DEFAULT_ADMIN_ROUTE.tab);

  return {
    tab,
    search: params.get("q")?.trim() ?? "",
    status: tab === "errors" ? oneOf(params.get("status"), ERROR_STATUSES, "all") : oneOf(params.get("status"), FEEDBACK_STATUSES, "all"),
    action: params.get("action") ?? "",
    filter: oneOf(params.get("filter"), GROUP_FILTERS, "all"),
    page: Number.isFinite(page) && page >= 1 ? Math.floor(page) : 1,
    userId: params.get("user") ?? "",
    groupId: params.get("group") ?? "",
    fingerprint: params.get("err") ?? "",
    days: TREND_WINDOWS.includes(days) ? days : DEFAULT_ADMIN_ROUTE.days,
  };
}

/**
 * Only what differs from the default is written, so the common case stays
 * /admin?tab=groups instead of a wall of empty parameters, and a link stays
 * short enough to paste into a chat message.
 */
export function adminRouteToSearch(route: AdminRoute): string {
  const params = new URLSearchParams();
  if (route.tab !== DEFAULT_ADMIN_ROUTE.tab) params.set("tab", route.tab);
  if (route.search) params.set("q", route.search);
  if (route.status && route.status !== "all") params.set("status", route.status);
  if (route.action) params.set("action", route.action);
  if (route.filter !== "all") params.set("filter", route.filter);
  if (route.page > 1) params.set("page", String(route.page));
  if (route.userId) params.set("user", route.userId);
  if (route.groupId) params.set("group", route.groupId);
  if (route.fingerprint) params.set("err", route.fingerprint);
  if (route.days !== DEFAULT_ADMIN_ROUTE.days) params.set("days", String(route.days));
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** The offset the list endpoints take, derived from the page in the URL. */
export function routeOffset(route: AdminRoute): number {
  return (route.page - 1) * ADMIN_PAGE_SIZE;
}

const FILTER_KEYS = ["search", "status", "action", "filter"] as const;

/**
 * Merge an update into the current route.
 *
 * Two rules the callers would otherwise have to remember at every call site:
 *
 * - switching tabs starts clean, because carrying "page 4" or a group id into
 *   a list that has neither is how you land on an empty screen with no
 *   explanation;
 * - changing what is being filtered returns to page 1, because page 4 of the
 *   old result set is rarely a page of the new one.
 */
export function applyAdminRoutePatch(route: AdminRoute, patch: Partial<AdminRoute>): AdminRoute {
  if (patch.tab !== undefined && patch.tab !== route.tab) {
    return { ...DEFAULT_ADMIN_ROUTE, ...patch, tab: patch.tab };
  }

  const next = { ...route, ...patch };
  const filterChanged = FILTER_KEYS.some((key) => patch[key] !== undefined && patch[key] !== route[key]);

  if (filterChanged && patch.page === undefined) {
    next.page = 1;
  }

  return next;
}
