// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AdminApp } from "./AdminApp";
import { SESSION_KEY } from "./appTestHarness";

/**
 * The console, mounted for real.
 *
 * These exist because the console's state now lives in the URL: a tab, a
 * search, a page and a drill-down are all things a reload or a Back press has
 * to reproduce, and none of that is visible to a unit test of the parsing
 * rules alone.
 */

type AdminRoutes = Record<string, unknown>;

/** A fetch that answers admin paths from a table and records the full URL. */
function fakeAdminApi(routes: AdminRoutes) {
  const urls: string[] = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const full = String(url).replace(/^\/api\/v1/, "");
      const path = full.split("?")[0];
      urls.push(`${method} ${full}`);

      const body = routes[`${method} ${path}`];

      if (body === undefined) {
        throw new Error(`No fake route for "${method} ${path}"`);
      }

      return { ok: true, status: 200, json: async () => body } as Response;
    }),
  );

  return urls;
}

const me = { user: { id: "user_admin", email: "admin@example.com", display_name: "Admin" }, role: "owner" };

const overview = {
  user_count: 5,
  active_users_7d: 3,
  new_users_7d: 1,
  group_count: 2,
  active_groups_7d: 1,
  expense_count: 9,
  expenses_7d: 4,
};

const errorGroup = {
  fingerprint: "fp_boom",
  source: "web",
  sample_message: "TypeError: cannot read x of undefined",
  last_page: "/group/group_1",
  occurrences: 42,
  user_count: 3,
  first_seen: "2026-07-20T02:00:00.000Z",
  last_seen: "2026-07-30T02:00:00.000Z",
  status: "open" as const,
  status_updated_at: null,
  status_updated_by: null,
};

const baseRoutes: AdminRoutes = {
  "GET /admin/me": me,
  "GET /admin/overview": overview,
  "GET /admin/storage": { object_count: 0, total_bytes: 0, orphan_count: 0, orphan_bytes: 0 },
  "GET /admin/health": {
    backup: { last_success_at: "2026-07-30T02:00:00.000Z", detail: {} },
    rate_limit: { active_buckets: 0, blocked_24h: 0 },
    errors: { last_24h: 0, last_7d: 0, latest_at: null },
    feedback: { open: 0 },
  },
  "GET /admin/trends": { days: 30, points: [] },
  "GET /admin/users": {
    total: 1,
    users: [
      {
        id: "user_alice",
        email: "alice@example.com",
        display_name: "Alice",
        avatar_url: null,
        created_at: "2026-07-01T00:00:00.000Z",
        last_seen_at: "2026-07-29T00:00:00.000Z",
        disabled_at: null,
        group_count: 1,
        expense_count: 3,
      },
    ],
  },
  "GET /admin/groups": {
    total: 1,
    groups: [
      {
        id: "group_1",
        name: "東京旅行",
        currency: "TWD",
        created_at: "2026-07-01T00:00:00.000Z",
        archived_at: null,
        deleted_at: null,
        member_count: 2,
        expense_count: 4,
        spend_total_minor: 12000,
        last_expense_at: "2026-07-29T00:00:00.000Z",
        owner_display_name: "Alice",
      },
    ],
  },
  "GET /admin/error-groups": { total: 1, groups: [errorGroup] },
  "GET /admin/errors": {
    total: 1,
    errors: [
      {
        id: "err_1",
        user_email: "alice@example.com",
        source: "web",
        message: "TypeError: cannot read x of undefined",
        context: "at renderGroup",
        page: "/group/group_1",
        created_at: "2026-07-30T02:00:00.000Z",
        fingerprint: "fp_boom",
      },
    ],
  },
  "POST /admin/error-groups/fp_boom/status": { fingerprint: "fp_boom", status: "resolved" },
};

function renderAdmin(search = "") {
  window.history.replaceState(null, "", `/admin${search}`);
  return render(<AdminApp />);
}

beforeEach(() => {
  window.localStorage.clear();
  window.localStorage.setItem(
    SESSION_KEY,
    JSON.stringify({
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      user: { id: "user_admin", email: "admin@example.com", displayName: "Admin" },
    }),
  );
  window.history.replaceState(null, "", "/admin");
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the console's address bar", () => {
  test("a pasted link opens the tab it names, not the overview", async () => {
    fakeAdminApi(baseRoutes);

    renderAdmin("?tab=groups");

    expect(await screen.findByRole("region", { name: "群組查詢" })).toBeTruthy();
  });

  test("switching tabs writes the URL, and Back returns to the previous one", async () => {
    fakeAdminApi(baseRoutes);
    renderAdmin();
    await screen.findByRole("region", { name: "總覽" });

    fireEvent.click(screen.getByRole("button", { name: "使用者" }));

    await screen.findByRole("region", { name: "使用者查詢" });
    expect(window.location.search).toBe("?tab=users");

    // popstate is not dispatched by jsdom's history.back() synchronously, so
    // drive the same path the browser would: restore the URL, then fire it.
    window.history.replaceState(null, "", "/admin");
    window.dispatchEvent(new PopStateEvent("popstate"));

    expect(await screen.findByRole("region", { name: "總覽" })).toBeTruthy();
  });

  test("a search is in the URL and in the request, so a reload reproduces the list", async () => {
    const urls = fakeAdminApi(baseRoutes);
    renderAdmin("?tab=users");
    await screen.findByRole("region", { name: "使用者查詢" });

    fireEvent.change(screen.getByLabelText("搜尋使用者"), { target: { value: "  alice  " } });
    fireEvent.click(screen.getByRole("button", { name: "搜尋" }));

    await waitFor(() => expect(window.location.search).toBe("?tab=users&q=alice"));
    await waitFor(() => expect(urls.some((url) => url.includes("/admin/users?search=alice"))).toBe(true));
  });

  test("opening a user's detail is addressable too", async () => {
    fakeAdminApi({
      ...baseRoutes,
      "GET /admin/users/user_alice": {
        user: {
          id: "user_alice",
          email: "alice@example.com",
          display_name: "Alice",
          avatar_url: null,
          created_at: "2026-07-01T00:00:00.000Z",
          last_seen_at: "2026-07-29T00:00:00.000Z",
          disabled_at: null,
          group_count: 0,
          expense_count: 0,
        },
        groups: [],
      },
    });
    renderAdmin("?tab=users");
    // The row, not just the panel: the table arrives a tick after the section.
    fireEvent.click(await screen.findByText("alice@example.com"));

    await screen.findByRole("region", { name: "使用者詳情" });
    expect(window.location.search).toBe("?tab=users&user=user_alice");
  });

  test("switching tabs does not carry the previous list's page into one that has no such page", async () => {
    fakeAdminApi(baseRoutes);
    renderAdmin("?tab=users&q=alice&page=3");
    await screen.findByRole("region", { name: "使用者查詢" });

    fireEvent.click(screen.getByRole("button", { name: "群組" }));

    await screen.findByRole("region", { name: "群組查詢" });
    expect(window.location.search).toBe("?tab=groups");
  });
});

describe("the errors tab", () => {
  test("shows one row per distinct error, with how often and to how many", async () => {
    fakeAdminApi(baseRoutes);
    renderAdmin("?tab=errors");

    const row = (await screen.findByText(errorGroup.sample_message)).closest("tr") as HTMLElement;

    expect(within(row).getByText("42")).toBeTruthy();
    expect(within(row).getByText("3")).toBeTruthy();
    expect(within(row).getByText("未處理")).toBeTruthy();
  });

  test("marking a group handled posts the status and reloads the list", async () => {
    const urls = fakeAdminApi(baseRoutes);
    renderAdmin("?tab=errors");
    await screen.findByText(errorGroup.sample_message);

    fireEvent.click(screen.getByRole("button", { name: "標記已處理" }));

    await waitFor(() =>
      expect(urls).toContain("POST /admin/error-groups/fp_boom/status"),
    );
    // The list is re-read afterwards rather than patched in place, so a group
    // that started happening again shows its new last_seen.
    await waitFor(() =>
      expect(urls.filter((url) => url.startsWith("GET /admin/error-groups")).length).toBeGreaterThan(1),
    );
  });

  test("the status filter travels in the URL and in the request", async () => {
    const urls = fakeAdminApi(baseRoutes);
    renderAdmin("?tab=errors");
    await screen.findByRole("region", { name: "錯誤日誌" });

    fireEvent.click(screen.getByRole("button", { name: "已處理" }));

    await waitFor(() => expect(window.location.search).toBe("?tab=errors&status=resolved"));
    await waitFor(() => expect(urls.some((url) => url.includes("status=resolved"))).toBe(true));
  });

  test("drilling into a group scopes the occurrence list to it, and the URL says which", async () => {
    const urls = fakeAdminApi(baseRoutes);
    renderAdmin("?tab=errors");
    await screen.findByText(errorGroup.sample_message);

    fireEvent.click(screen.getByRole("button", { name: "查看" }));

    await screen.findByRole("region", { name: "錯誤詳情" });
    expect(window.location.search).toBe("?tab=errors&err=fp_boom");
    await waitFor(() => expect(urls.some((url) => url.includes("fingerprint=fp_boom"))).toBe(true));
    // The per-occurrence detail the grouped list cannot show.
    expect(screen.getByText("at renderGroup")).toBeTruthy();
  });

  test("a pasted drill-down link opens the occurrences without loading the list first", async () => {
    const urls = fakeAdminApi(baseRoutes);
    renderAdmin("?tab=errors&err=fp_boom");

    await screen.findByRole("region", { name: "錯誤詳情" });
    expect(urls.some((url) => url.startsWith("GET /admin/error-groups"))).toBe(false);
  });
});
