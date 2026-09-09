// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AdminApp } from "./AdminApp";
import { SESSION_KEY } from "./appTestHarness";
import { EXPORT_MAX_ROWS, EXPORT_PAGE_SIZE } from "./adminPanelKit";
import { ADMIN_LIST_MAX_LIMIT } from "../server/handlers/admin";

/**
 * Two things about pulling a table out of the console as a CSV.
 *
 * It was not audited. Exporting ONE person's data wrote a user.export row;
 * exporting five thousand people's was three GET loops in the browser and left
 * nothing behind at all. Same data, more of it, no record.
 *
 * And it was slow in a way nobody could see: the server capped a list page at
 * 100 against a 5,000-row export, so one button meant fifty sequential round
 * trips to Singapore.
 */

type AdminRoutes = Record<string, unknown>;

const me = { user: { id: "user_admin", email: "admin@example.com", display_name: "Admin" }, role: "owner" };
const recently = new Date(Date.now() - 60 * 60 * 1000).toISOString();

const baseRoutes: AdminRoutes = {
  "GET /admin/me": me,
  "GET /admin/health": {
    backup: { last_success_at: recently, detail: {} },
    rate_limit: { active_buckets: 0, blocked_24h: 0 },
    errors: { last_24h: 0, last_7d: 0, latest_at: null, open_groups: 0 },
    feedback: { open: 0 },
  },
  "POST /admin/exports": { logged: true },
};

/** Answers every page with the same rows, so the walk runs until the cap. */
const manyUsers = (perPage: number, total: number) => ({
  total,
  users: Array.from({ length: perPage }, (_, index) => ({
    id: `user_${index}`,
    email: `u${index}@example.com`,
    display_name: `U${index}`,
    avatar_url: null,
    created_at: "2026-07-01T00:00:00.000Z",
    last_seen_at: "2026-07-29T00:00:00.000Z",
    disabled_at: null,
    group_count: 1,
    expense_count: 3,
  })),
});

function fakeAdminApi(routes: AdminRoutes, options: { failExportLog?: boolean } = {}) {
  const calls: Array<{ method: string; path: string; url: string; body: unknown }> = [];

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const full = String(url).replace(/^\/api\/v1/, "");
      const path = full.split("?")[0];
      calls.push({
        method,
        path,
        url: full,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });

      if (options.failExportLog && path === "/admin/exports") throw new Error("audit write failed");

      const body = routes[`${method} ${path}`];
      if (body === undefined) throw new Error(`No fake route for "${method} ${path}"`);
      return { ok: true, status: 200, json: async () => body } as Response;
    }),
  );

  return {
    calls,
    of: (method: string, path: string) => calls.filter((call) => call.method === method && call.path === path),
  };
}

/** Captures whatever downloadCsv hands the browser. */
function captureDownload() {
  const captured: Array<{ fileName: string; blob: Blob }> = [];
  let pending: Blob | null = null;

  vi.stubGlobal("URL", {
    ...URL,
    createObjectURL: (blob: Blob) => {
      pending = blob;
      return "blob:fake";
    },
    revokeObjectURL: () => {},
  });
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    if (pending) captured.push({ fileName: this.download, blob: pending });
    pending = null;
  });

  return captured;
}

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

describe("a bulk export leaves a record", () => {
  test("what it says: which table, how many left, how many matched", async () => {
    const api = fakeAdminApi({ ...baseRoutes, "GET /admin/users": manyUsers(20, 20) });
    const downloads = captureDownload();
    renderAdmin("?tab=users");
    await screen.findByRole("region", { name: "使用者查詢" });

    fireEvent.click(screen.getByRole("button", { name: "匯出 CSV" }));

    await waitFor(() => expect(downloads).toHaveLength(1));
    await waitFor(() => expect(api.of("POST", "/admin/exports")).toHaveLength(1));
    expect(api.of("POST", "/admin/exports")[0].body).toEqual({
      kind: "users",
      rows: 20,
      total: 20,
      search: "",
    });
  });

  test("the search that produced it is part of the record", async () => {
    const api = fakeAdminApi({ ...baseRoutes, "GET /admin/users": manyUsers(1, 1) });
    captureDownload();
    renderAdmin("?tab=users&q=alice");
    await screen.findByRole("region", { name: "使用者查詢" });

    fireEvent.click(screen.getByRole("button", { name: "匯出 CSV" }));

    // Without it a row says "somebody took the users table" and cannot say
    // which slice of it.
    await waitFor(() => expect(api.of("POST", "/admin/exports")[0]?.body).toMatchObject({ search: "alice" }));
  });

  test("a truncated export records both numbers, not just the one it got", async () => {
    const api = fakeAdminApi({ ...baseRoutes, "GET /admin/users": manyUsers(100, 12_345) });
    const downloads = captureDownload();
    renderAdmin("?tab=users");
    await screen.findByRole("region", { name: "使用者查詢" });

    fireEvent.click(screen.getByRole("button", { name: "匯出 CSV" }));
    await waitFor(() => expect(downloads).toHaveLength(1));

    await waitFor(() => expect(api.of("POST", "/admin/exports")).toHaveLength(1));
    const logged = api.of("POST", "/admin/exports")[0].body as { rows: number; total: number };
    // "匯出了 1,000 列" and "符合的有 12,345 列" are different facts and the row
    // carries both; the function derives `truncated` from the pair.
    expect(logged.total).toBe(12_345);
    expect(logged.rows).toBeLessThan(logged.total);
  });

  test("a failed audit write does not report the download as broken", async () => {
    // The file is on the operator's disk by the time this runs. Turning a
    // failed note into a red banner would report the wrong thing as broken.
    const api = fakeAdminApi({ ...baseRoutes, "GET /admin/users": manyUsers(3, 3) }, { failExportLog: true });
    const downloads = captureDownload();
    renderAdmin("?tab=users");
    await screen.findByRole("region", { name: "使用者查詢" });

    fireEvent.click(screen.getByRole("button", { name: "匯出 CSV" }));

    await waitFor(() => expect(downloads).toHaveLength(1));
    await waitFor(() => expect(api.of("POST", "/admin/exports")).toHaveLength(1));
    expect(screen.queryByText("匯出失敗，請稍後再試。")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  test("the log is written after the download, not instead of it", async () => {
    const api = fakeAdminApi({ ...baseRoutes, "GET /admin/users": manyUsers(3, 3) });
    const downloads = captureDownload();
    renderAdmin("?tab=users");
    await screen.findByRole("region", { name: "使用者查詢" });

    fireEvent.click(screen.getByRole("button", { name: "匯出 CSV" }));
    await waitFor(() => expect(api.of("POST", "/admin/exports")).toHaveLength(1));

    expect(downloads).toHaveLength(1);
  });
});

describe("an export does not take fifty round trips", () => {
  test("it asks for the biggest page the server will give", () => {
    // Silently clamped on the server, so asking for more than the cap does not
    // fail - it just quietly does five times the round trips it thinks it is.
    expect(EXPORT_PAGE_SIZE).toBeLessThanOrEqual(ADMIN_LIST_MAX_LIMIT);
    expect(EXPORT_PAGE_SIZE).toBe(ADMIN_LIST_MAX_LIMIT);
  });

  test("which puts the worst case in single digits", () => {
    expect(Math.ceil(EXPORT_MAX_ROWS / EXPORT_PAGE_SIZE)).toBeLessThanOrEqual(10);
  });

  test("and the requests really do carry that limit", async () => {
    const api = fakeAdminApi({ ...baseRoutes, "GET /admin/users": manyUsers(100, 12_345) });
    const downloads = captureDownload();
    renderAdmin("?tab=users");
    await screen.findByRole("region", { name: "使用者查詢" });

    fireEvent.click(screen.getByRole("button", { name: "匯出 CSV" }));
    await waitFor(() => expect(downloads).toHaveLength(1));

    const exportCalls = api.of("GET", "/admin/users").filter((call) => call.url.includes(`limit=${EXPORT_PAGE_SIZE}`));
    expect(exportCalls.length).toBeGreaterThan(0);
    // 5,000 / 500. At the old page size this was fifty.
    expect(exportCalls.length).toBeLessThanOrEqual(10);
  });
});
