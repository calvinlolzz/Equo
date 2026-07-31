import { describe, expect, test } from "vitest";
import {
  ADMIN_PAGE_SIZE,
  adminRouteToSearch,
  applyAdminRoutePatch,
  DEFAULT_ADMIN_ROUTE,
  parseAdminRoute,
  routeOffset,
  type AdminRoute,
} from "./adminRoute";

function route(overrides: Partial<AdminRoute> = {}): AdminRoute {
  return { ...DEFAULT_ADMIN_ROUTE, ...overrides };
}

describe("parseAdminRoute", () => {
  test("an empty query is the default console view", () => {
    expect(parseAdminRoute("")).toEqual(DEFAULT_ADMIN_ROUTE);
    expect(parseAdminRoute("?")).toEqual(DEFAULT_ADMIN_ROUTE);
  });

  test("reads a full list state back out of the URL", () => {
    expect(parseAdminRoute("?tab=groups&q=tokyo&filter=archived&page=3")).toEqual(
      route({ tab: "groups", search: "tokyo", filter: "archived", page: 3 }),
    );
  });

  test("reads the drill-down ids", () => {
    expect(parseAdminRoute("?tab=users&user=user_1&group=group_2")).toMatchObject({
      tab: "users",
      userId: "user_1",
      groupId: "group_2",
    });
    expect(parseAdminRoute("?tab=errors&err=fp_1").fingerprint).toBe("fp_1");
  });

  test("a hand-edited value out of range falls back rather than rendering an impossible screen", () => {
    expect(parseAdminRoute("?tab=nonsense").tab).toBe("overview");
    expect(parseAdminRoute("?tab=groups&filter=nonsense").filter).toBe("all");
    expect(parseAdminRoute("?page=0").page).toBe(1);
    expect(parseAdminRoute("?page=-4").page).toBe(1);
    expect(parseAdminRoute("?page=abc").page).toBe(1);
    expect(parseAdminRoute("?page=2.7").page).toBe(2);
    expect(parseAdminRoute("?days=365").days).toBe(30);
  });

  test("the status vocabulary is per tab, so a feedback status cannot leak into the errors list", () => {
    expect(parseAdminRoute("?tab=feedback&status=reviewing").status).toBe("reviewing");
    expect(parseAdminRoute("?tab=errors&status=reviewing").status).toBe("all");
    expect(parseAdminRoute("?tab=errors&status=resolved").status).toBe("resolved");
    expect(parseAdminRoute("?tab=feedback&status=resolved").status).toBe("all");
  });

  test("trims the search term the same way the search box does", () => {
    expect(parseAdminRoute("?q=%20%20alice%20%20").search).toBe("alice");
  });
});

describe("adminRouteToSearch", () => {
  test("writes nothing for the default view, so /admin stays /admin", () => {
    expect(adminRouteToSearch(DEFAULT_ADMIN_ROUTE)).toBe("");
  });

  test("omits every field still at its default", () => {
    expect(adminRouteToSearch(route({ tab: "groups" }))).toBe("?tab=groups");
    expect(adminRouteToSearch(route({ tab: "audit", action: "group.delete" }))).toBe(
      "?tab=audit&action=group.delete",
    );
  });

  test("round-trips every field it writes", () => {
    const original = route({
      tab: "errors",
      search: "boom",
      status: "resolved",
      page: 4,
      fingerprint: "fp_1",
    });

    expect(parseAdminRoute(adminRouteToSearch(original))).toEqual(original);
  });

  test("round-trips a search term that needs escaping", () => {
    const original = route({ tab: "users", search: "a&b=c d" });

    expect(parseAdminRoute(adminRouteToSearch(original)).search).toBe("a&b=c d");
  });
});

describe("routeOffset", () => {
  test("turns the 1-based page in the URL into the offset the API takes", () => {
    expect(routeOffset(route({ page: 1 }))).toBe(0);
    expect(routeOffset(route({ page: 3 }))).toBe(2 * ADMIN_PAGE_SIZE);
  });
});

describe("applyAdminRoutePatch", () => {
  test("switching tabs starts clean instead of carrying the last list's state", () => {
    const current = route({ tab: "users", search: "alice", page: 5, userId: "user_1" });

    expect(applyAdminRoutePatch(current, { tab: "groups" })).toEqual(route({ tab: "groups" }));
  });

  test("re-selecting the current tab keeps the state it already has", () => {
    const current = route({ tab: "users", search: "alice", page: 5 });

    expect(applyAdminRoutePatch(current, { tab: "users" })).toEqual(current);
  });

  test("changing what is filtered returns to page 1", () => {
    const current = route({ tab: "groups", page: 7 });

    expect(applyAdminRoutePatch(current, { search: "tokyo" }).page).toBe(1);
    expect(applyAdminRoutePatch(current, { filter: "deleted" }).page).toBe(1);
    expect(applyAdminRoutePatch(route({ tab: "audit", page: 7 }), { action: "group.delete" }).page).toBe(1);
    expect(applyAdminRoutePatch(route({ tab: "feedback", page: 7 }), { status: "done" }).page).toBe(1);
  });

  test("paging does not reset itself", () => {
    const current = route({ tab: "groups", search: "tokyo", page: 2 });

    expect(applyAdminRoutePatch(current, { page: 3 }).page).toBe(3);
  });

  test("re-submitting the same search leaves the page alone", () => {
    const current = route({ tab: "groups", search: "tokyo", page: 3 });

    expect(applyAdminRoutePatch(current, { search: "tokyo" }).page).toBe(3);
  });

  test("opening a drill-down keeps the list state behind it", () => {
    const current = route({ tab: "users", search: "alice", page: 2 });
    const next = applyAdminRoutePatch(current, { userId: "user_1" });

    expect(next).toEqual(route({ tab: "users", search: "alice", page: 2, userId: "user_1" }));
  });
});
