// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AdminApp } from "./AdminApp";
import { SESSION_KEY } from "./appTestHarness";
import { readAppFile } from "./cssDeclarations";

/**
 * Four complaints about a console that goes blank or goes stale.
 *
 * - every 下一頁 replaced the table with one line of 載入中…, on all seven list
 *   panels, at 20 rows a page;
 * - the overview returned that same line INSTEAD OF THE WHOLE SCREEN while its
 *   four counters loaded — including the inbox above them, which is drawn from
 *   a payload the shell already had;
 * - there was no refresh anywhere, so an operator watching an incident pressed
 *   F5 and threw away the SPA to re-read one table;
 * - and nothing a panel said out loud was in a live region, so an action that
 *   failed announced nothing.
 */

type AdminRoutes = Record<string, unknown>;

const me = { user: { id: "user_admin", email: "admin@example.com", display_name: "Admin" }, role: "owner" };
const recently = new Date(Date.now() - 60 * 60 * 1000).toISOString();

const user = (id: string, email: string) => ({
  id,
  email,
  display_name: email.split("@")[0],
  avatar_url: null,
  created_at: "2026-07-01T00:00:00.000Z",
  last_seen_at: "2026-07-29T00:00:00.000Z",
  disabled_at: null,
  group_count: 1,
  expense_count: 3,
});

const health = (openFeedback: number) => ({
  backup: { last_success_at: recently, detail: {} },
  rate_limit: { active_buckets: 0, blocked_24h: 0 },
  errors: { last_24h: 0, last_7d: 0, latest_at: null, open_groups: 0 },
  feedback: { open: openFeedback },
});

const baseRoutes: AdminRoutes = {
  "GET /admin/me": me,
  "GET /admin/overview": {
    user_count: 5,
    active_users_7d: 3,
    new_users_7d: 1,
    group_count: 2,
    active_groups_7d: 1,
    expense_count: 9,
    expenses_7d: 4,
  },
  "GET /admin/storage": { object_count: 0, total_bytes: 0, orphan_count: 0, orphan_bytes: 0 },
  "GET /admin/health": health(0),
  "GET /admin/trends": { days: 30, points: [] },
  "GET /admin/retention": { cohorts: [] },
  "GET /admin/users": { total: 2, users: [user("user_alice", "alice@example.com")] },
};

/**
 * A fetch that answers from a table, counts what was asked for, and can hold a
 * route open so "while it is loading" is a state a test can stand in.
 */
function fakeAdminApi(routes: AdminRoutes) {
  const calls: string[] = [];

  const api = {
    calls,
    countOf: (path: string) => calls.filter((entry) => entry.startsWith(`GET ${path}`)).length,
    /**
     * Paths whose response is held until the promise resolves, so "while it is
     * loading" is a state a test can stand in rather than a race.
     */
    gates: new Map<string, Promise<void>>(),
  };

  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      const full = String(url).replace(/^\/api\/v1/, "");
      const path = full.split("?")[0];
      calls.push(`${method} ${full}`);

      const gate = api.gates.get(path);
      if (gate) await gate;

      const body = routes[`${method} ${path}`];
      if (body === undefined) throw new Error(`No fake route for "${method} ${path}"`);
      return { ok: true, status: 200, json: async () => body } as Response;
    }),
  );

  return api;
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

describe("a list keeps its rows while the next page loads", () => {
  test("the table is still there, marked busy, mid-page-turn", async () => {
    const api = fakeAdminApi({ ...baseRoutes, "GET /admin/users": { total: 40, users: [user("user_alice", "alice@example.com")] } });
    renderAdmin("?tab=users");
    await screen.findByText("alice@example.com");

    // Hold the second page open so "loading" is somewhere a test can stand.
    let release = () => {};
    api.gates.set("/admin/users", new Promise<void>((resolve) => {
      release = resolve;
    }));

    fireEvent.click(screen.getByRole("button", { name: "下一頁" }));

    await waitFor(() => {
      const list = document.querySelector(".admin-list");
      expect(list?.getAttribute("aria-busy")).toBe("true");
    });
    // The rows that were already right are still on screen. This is the whole
    // fix: before it, the table was gone and 載入中… was in its place.
    expect(screen.getByText("alice@example.com")).toBeTruthy();
    expect(document.querySelector(".admin-list--reloading")).toBeTruthy();

    release();
    await waitFor(() => expect(document.querySelector(".admin-list--reloading")).toBeNull());
  });

  test("the first load, which has nothing to keep, still says so", async () => {
    const api = fakeAdminApi(baseRoutes);
    let release = () => {};
    api.gates.set("/admin/users", new Promise<void>((resolve) => {
      release = resolve;
    }));

    renderAdmin("?tab=users");

    expect(await screen.findByText("載入中…")).toBeTruthy();
    release();
    await screen.findByText("alice@example.com");
  });
});

describe("the overview does not hold the screen hostage", () => {
  test("the inbox renders while the counters are still in flight", async () => {
    const api = fakeAdminApi({ ...baseRoutes, "GET /admin/health": health(3) });
    let release = () => {};
    api.gates.set("/admin/overview", new Promise<void>((resolve) => {
      release = resolve;
    }));

    renderAdmin();

    // 今天要處理 comes from /admin/health, which the shell loads for the sidebar
    // badges — so it is in memory before this panel mounts and has no business
    // waiting on /admin/overview.
    expect(await screen.findByRole("region", { name: "今天要處理" })).toBeTruthy();
    // And the counters are present as themselves, not as an absence: same four
    // boxes, same labels, an em dash where the number will go. (Scoped to the
    // tiles — 使用者 is also the sidebar's nav item.)
    const tiles = document.querySelector(".admin-tiles") as HTMLElement;
    expect(tiles.getAttribute("aria-busy")).toBe("true");
    expect(within(tiles).getByText("使用者")).toBeTruthy();
    expect(within(tiles).getAllByText("—")).toHaveLength(4);

    release();
    await waitFor(() => expect(document.querySelector(".admin-tiles")?.getAttribute("aria-busy")).toBe("false"));
  });

  test("the placeholder labels are the labels the real tiles use", async () => {
    // OVERVIEW_TILE_LABELS is written out by hand because overviewTiles() needs
    // the payload that has not arrived. This is what keeps the two the same.
    const source = readAppFile("AdminApp.tsx");
    const declared = /const OVERVIEW_TILE_LABELS = \[([^\]]*)\]/.exec(source)?.[1] ?? "";
    const dashboard = readAppFile("adminDashboard.ts");
    const tiles = /export function overviewTiles[\s\S]*?\n}/.exec(dashboard)?.[0] ?? "";

    for (const label of declared.split(",").map((part) => part.trim().replace(/^"|"$/g, "")).filter(Boolean)) {
      expect(tiles).toContain(`label: "${label}"`);
    }
  });
});

describe("there is a way to see new rows without reloading the page", () => {
  test("重新整理 re-reads the panel and the badges", async () => {
    const api = fakeAdminApi(baseRoutes);
    renderAdmin("?tab=users");
    await screen.findByText("alice@example.com");

    const usersBefore = api.countOf("/admin/users");
    const healthBefore = api.countOf("/admin/health");

    fireEvent.click(screen.getByRole("button", { name: "重新整理" }));

    await waitFor(() => expect(api.countOf("/admin/users")).toBe(usersBefore + 1));
    expect(api.countOf("/admin/health")).toBe(healthBefore + 1);
  });

  test("it says how old what you are looking at is", async () => {
    fakeAdminApi(baseRoutes);
    renderAdmin();

    // hh:mm 更新, once the first health payload has landed.
    await waitFor(() => expect(screen.getByText(/^\d{2}:\d{2} 更新$/)).toBeTruthy());
  });

  test("the badges re-read themselves on a console left open", async () => {
    vi.useFakeTimers();
    try {
      const api = fakeAdminApi(baseRoutes);
      renderAdmin();
      await vi.waitFor(() => expect(api.countOf("/admin/health")).toBe(1));

      const before = api.countOf("/admin/health");
      await vi.advanceTimersByTimeAsync(60_000);
      expect(api.countOf("/admin/health")).toBe(before + 1);
    } finally {
      vi.useRealTimers();
    }
  });

  test("a hidden tab does not poll", async () => {
    vi.useFakeTimers();
    try {
      const api = fakeAdminApi(baseRoutes);
      renderAdmin();
      await vi.waitFor(() => expect(api.countOf("/admin/health")).toBe(1));

      // A background tab polling every minute is a request nobody will read.
      Object.defineProperty(document, "visibilityState", { value: "hidden", configurable: true });
      const before = api.countOf("/admin/health");
      await vi.advanceTimersByTimeAsync(180_000);
      expect(api.countOf("/admin/health")).toBe(before);
    } finally {
      Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
      vi.useRealTimers();
    }
  });
});

describe("what a panel says out loud is announced", () => {
  const PANELS = ["AdminApp.tsx", "AdminUserPanels.tsx", "AdminGroupPanels.tsx", "AdminInboxPanels.tsx", "AdminSettingsPanel.tsx"];

  test("no panel error is drawn without a live region", () => {
    for (const file of PANELS) {
      const source = readAppFile(file);
      // role="alert" rather than aria-live: an alert is announced when it is
      // INSERTED, which is how every one of these arrives.
      expect(source).not.toContain('<p className="admin-error">');
    }
  });

  test("nor a notice", () => {
    for (const file of PANELS) {
      const source = readAppFile(file);
      expect(source).not.toContain('<p className="admin-notice">');
      expect(source).not.toContain('<p className="admin-notice admin-notice--warn">');
    }
  });

  test("nor 載入中", () => {
    for (const file of PANELS) {
      const source = readAppFile(file);
      expect(source).not.toContain('<p className="admin-loading">載入中…</p>');
    }
  });

  test("a real error really does land in an alert", async () => {
    const { "GET /admin/users": _absent, ...withoutUsers } = baseRoutes;
    fakeAdminApi(withoutUsers);

    renderAdmin("?tab=users");

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("使用者列表載入失敗");
  });
});

describe("the reloading list is actually dimmed", () => {
  test("the class does something", () => {
    const css = readFileSync(join(__dirname, "AdminApp.css"), "utf8");
    expect(css).toContain(".admin-list--reloading");
    const block = /\.admin-list--reloading \{([^}]*)\}/.exec(css)?.[1] ?? "";
    expect(block).toContain("opacity");
    // Not just faded: a click landing on row 4 of the OLD page is why.
    expect(block).toContain("pointer-events: none");
  });
});
