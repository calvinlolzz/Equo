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

/**
 * Fresh enough that the health card never reports a stale backup. A fixed
 * timestamp here would start failing the "nothing to do" tests the moment it
 * aged past the 36-hour threshold - which is exactly what happened.
 */
const recently = new Date(Date.now() - 60 * 60 * 1000).toISOString();

const baseRoutes: AdminRoutes = {
  "GET /admin/me": me,
  "GET /admin/overview": overview,
  "GET /admin/storage": { object_count: 0, total_bytes: 0, orphan_count: 0, orphan_bytes: 0 },
  "GET /admin/health": {
    backup: { last_success_at: recently, detail: {} },
    rate_limit: { active_buckets: 0, blocked_24h: 0 },
    errors: { last_24h: 0, last_7d: 0, latest_at: null, open_groups: 0 },
    feedback: { open: 0 },
  },
  "GET /admin/trends": { days: 30, points: [] },
  "GET /admin/settings/auto-nudge": {
    enabled: false,
    overdue_days: 14,
    cooldown_days: 7,
    updated_at: null,
    updated_by_email: null,
  },
  "GET /admin/scan-usage": {
    days: 30,
    summary: {
      scans: 40,
      recognised: 30,
      unrecognised: 6,
      failed: 4,
      users: 3,
      cost_micros: 114_000,
      p50_ms: 4400,
      p95_ms: 11800,
      latest_at: "2026-08-24T01:00:00.000Z",
    },
    by_day: [{ day: "2026-08-24", scans: 40, failed: 4, cost_micros: 114_000 }],
    by_model: [
      { model: "claude-haiku-4-5", provider: "anthropic", scans: 40, failed: 4, cost_micros: 114_000, p50_ms: 4400 },
    ],
    top_users: [{ user_id: "user_alice", email: "alice@example.com", scans: 25, failed: 1, cost_micros: 71_000 }],
    recent_failures: [
      {
        created_at: "2026-08-24T01:00:00.000Z",
        model: "claude-haiku-4-5",
        failure_reason: "upstream returned 429",
        email: "alice@example.com",
      },
    ],
  },
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

/**
 * Answers the console's own confirm dialog (AdminConfirm.tsx), which replaced
 * window.confirm and window.prompt everywhere.
 *
 * `typed` is for the guards that make you write the email out — the confirm
 * button stays disabled until it matches, so a wrong answer is refused here
 * rather than accepted and reported as an error afterwards.
 */
async function answerConfirm(typed?: string) {
  const dialog = await screen.findByRole("alertdialog");
  if (typed !== undefined) {
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: typed } });
  }
  const buttons = within(dialog).getAllByRole("button");
  // [取消, 確定] - the affirmative one is last.
  fireEvent.click(buttons[buttons.length - 1]);
  return dialog;
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

describe("the inbox on the overview", () => {
  const busyHealth = {
    backup: { last_success_at: recently, detail: {} },
    rate_limit: { active_buckets: 0, blocked_24h: 0 },
    errors: { last_24h: 12, last_7d: 40, latest_at: null, open_groups: 2 },
    feedback: { open: 1 },
  };

  test("says there is nothing to do when there is nothing to do", async () => {
    fakeAdminApi(baseRoutes);
    renderAdmin();

    expect(await screen.findByText("沒有待處理的事。")).toBeTruthy();
  });

  test("lists the backlog and jumps to the tab already filtered", async () => {
    fakeAdminApi({ ...baseRoutes, "GET /admin/health": busyHealth });
    renderAdmin();

    fireEvent.click(await screen.findByRole("button", { name: /未處理錯誤/ }));

    // Filtered on arrival: landing on the unfiltered list would mean doing the
    // filtering again by hand.
    await waitFor(() => expect(window.location.search).toBe("?tab=errors&status=open"));
  });

  test("clearing the last item empties its badge immediately", async () => {
    // The counts come from one health read taken at mount; without a re-read
    // after the mutation, the badge keeps saying 1 until the page is reloaded.
    let healthReads = 0;
    const routes: AdminRoutes = {
      ...baseRoutes,
      "GET /admin/feedback": {
        total: 1,
        feedback: [
          {
            id: "fb_1",
            user_email: "alice@example.com",
            type: "problem",
            message: "壞掉了",
            status: "new",
            created_at: "2026-07-30T02:00:00.000Z",
          },
        ],
      },
      "POST /admin/feedback/fb_1/status": { id: "fb_1", status: "done" },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const full = String(url).replace(/^\/api\/v1/, "");
        const path = full.split("?")[0];

        if (method === "GET" && path === "/admin/health") {
          healthReads += 1;
          // One open item to start with, none once it has been dealt with.
          const open = healthReads === 1 ? 1 : 0;
          return {
            ok: true,
            status: 200,
            json: async () => ({
              backup: { last_success_at: recently, detail: {} },
              rate_limit: { active_buckets: 0, blocked_24h: 0 },
              errors: { last_24h: 0, last_7d: 0, latest_at: null, open_groups: 0 },
              feedback: { open },
            }),
          } as Response;
        }

        const body = routes[`${method} ${path}`];
        if (body === undefined) throw new Error(`No fake route for "${method} ${path}"`);
        return { ok: true, status: 200, json: async () => body } as Response;
      }),
    );

    renderAdmin("?tab=feedback");

    const nav = await screen.findByRole("navigation", { name: "後台功能" });
    const feedbackTab = within(nav).getByRole("button", { name: /回饋/ });
    expect(await within(feedbackTab).findByText("1")).toBeTruthy();

    fireEvent.click(await screen.findByRole("button", { name: "完成" }));

    await waitFor(() => expect(within(feedbackTab).queryByText("1")).toBeNull());
  });

  test("puts the backlog on the sidebar tabs too", async () => {
    fakeAdminApi({ ...baseRoutes, "GET /admin/health": busyHealth });
    renderAdmin();

    const nav = await screen.findByRole("navigation", { name: "後台功能" });
    const errorsTab = within(nav).getByRole("button", { name: /錯誤/ });

    expect(within(errorsTab).getByText("2")).toBeTruthy();
  });
});

describe("the command palette", () => {
  test("opens on ⌘K and offers the tabs before anything is typed", async () => {
    fakeAdminApi(baseRoutes);
    renderAdmin();
    await screen.findByRole("region", { name: "總覽" });

    fireEvent.keyDown(window, { key: "k", metaKey: true });

    const palette = await screen.findByRole("dialog", { name: "快速搜尋" });
    expect(within(palette).getByRole("option", { name: "稽核" })).toBeTruthy();
  });

  test("picking a result lands on that user's page, not just their tab", async () => {
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
    renderAdmin();
    await screen.findByRole("region", { name: "總覽" });

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const palette = await screen.findByRole("dialog", { name: "快速搜尋" });
    fireEvent.change(within(palette).getByLabelText("快速搜尋"), { target: { value: "alice" } });

    fireEvent.click(await within(palette).findByRole("option", { name: /Alice/ }));

    await waitFor(() => expect(window.location.search).toBe("?tab=users&user=user_alice"));
    expect(screen.queryByRole("dialog", { name: "快速搜尋" })).toBeNull();
  });

  test("Enter runs the highlighted row", async () => {
    fakeAdminApi(baseRoutes);
    renderAdmin();
    await screen.findByRole("region", { name: "總覽" });

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const palette = await screen.findByRole("dialog", { name: "快速搜尋" });
    // Down once from 總覽 = 使用者.
    fireEvent.keyDown(palette, { key: "ArrowDown" });
    fireEvent.keyDown(palette, { key: "Enter" });

    await waitFor(() => expect(window.location.search).toBe("?tab=users"));
  });

  test("Escape closes it without navigating anywhere", async () => {
    fakeAdminApi(baseRoutes);
    renderAdmin();
    await screen.findByRole("region", { name: "總覽" });

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const palette = await screen.findByRole("dialog", { name: "快速搜尋" });
    fireEvent.keyDown(palette, { key: "Escape" });

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "快速搜尋" })).toBeNull());
    expect(window.location.search).toBe("");
  });

  test("a single character does not go to the server", async () => {
    const urls = fakeAdminApi(baseRoutes);
    renderAdmin();
    await screen.findByRole("region", { name: "總覽" });

    fireEvent.keyDown(window, { key: "k", metaKey: true });
    const palette = await screen.findByRole("dialog", { name: "快速搜尋" });
    fireEvent.change(within(palette).getByLabelText("快速搜尋"), { target: { value: "a" } });

    // Says so, rather than claiming nothing matched a search that never ran.
    expect(await within(palette).findByText("再多輸入一個字開始搜尋")).toBeTruthy();
    expect(urls.some((url) => url.includes("/admin/users?search=a"))).toBe(false);
  });
});

describe("the settings tab", () => {
  const models = [
    { id: "claude-haiku-4-5", provider: "anthropic", note: "付費・最便宜", available: true },
    { id: "claude-sonnet-5", provider: "anthropic", note: "付費・較準", available: true },
    { id: "gemini-3.6-flash", provider: "google", note: "免費層", available: false },
  ];

  const settings = {
    enabled: true,
    model: "claude-haiku-4-5",
    updated_at: null,
    updated_by_email: null,
    configured: true,
    models,
  };

  test("saves the kill switch and the model in one request", async () => {
    const urls = fakeAdminApi({
      ...baseRoutes,
      "GET /admin/settings/receipt-scan": settings,
      "PUT /admin/settings/receipt-scan": { ...settings, enabled: false, model: "claude-sonnet-5" },
    });
    renderAdmin("?tab=settings");

    const model = await screen.findByLabelText("辨識模型");
    fireEvent.change(model, { target: { value: "claude-sonnet-5" } });
    fireEvent.click(screen.getByRole("checkbox", { name: "啟用收據辨識" }));
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => expect(urls).toContain("PUT /admin/settings/receipt-scan"));
    await screen.findByText(/已關閉收據辨識/);
  });

  test("lists 循環支出 rules that switched themselves off, with the reason", async () => {
    // The heartbeat tile already says "N 條規則失敗"; what was missing is which
    // rule, whose group, and why - which is what makes it actionable.
    fakeAdminApi({
      ...baseRoutes,
      "GET /admin/health": {
        ...(baseRoutes["GET /admin/health"] as Record<string, unknown>),
        recurring: {
          rules: 3,
          active: 2,
          broken: 1,
          broken_rules: [
            {
              id: "rule_1",
              title: "每月房租",
              group_id: "group_1",
              group_name: "室友",
              last_error: "INVALID_MEMBER:某位成員已離開群組",
              last_run_at: "2026-08-25T00:00:00.000Z",
              active: false,
            },
          ],
        },
      },
    });
    renderAdmin();

    expect(await screen.findByText("已停用的循環支出")).toBeTruthy();
    expect(screen.getByText("每月房租")).toBeTruthy();
    expect(screen.getByText("INVALID_MEMBER:某位成員已離開群組")).toBeTruthy();
    expect(screen.getByText("循環支出規則已停用")).toBeTruthy();
  });

  test("a good day shows no 循環支出 section at all", async () => {
    fakeAdminApi(baseRoutes);
    renderAdmin();

    // Wait for the overview to settle before asserting on an absence.
    await screen.findByText("系統狀態");
    expect(screen.queryByText("已停用的循環支出")).toBeNull();
  });

  test("自動催繳 is off until somebody turns it on", async () => {
    fakeAdminApi({ ...baseRoutes, "GET /admin/settings/receipt-scan": settings });
    renderAdmin("?tab=settings");

    const toggle = (await screen.findByRole("checkbox", { name: "啟用自動催繳" })) as HTMLInputElement;

    expect(toggle.checked).toBe(false);
    expect(screen.getByText(/尚未變更過，目前為預設值（關閉）/)).toBeTruthy();
  });

  test("turning it on sends both windows, not just the switch", async () => {
    const urls = fakeAdminApi({
      ...baseRoutes,
      "GET /admin/settings/receipt-scan": settings,
      "PUT /admin/settings/auto-nudge": {
        enabled: true,
        overdue_days: 14,
        cooldown_days: 7,
        updated_at: "2026-08-26T00:00:00.000Z",
        updated_by_email: "admin@example.com",
      },
    });
    renderAdmin("?tab=settings");

    fireEvent.click(await screen.findByRole("checkbox", { name: "啟用自動催繳" }));
    fireEvent.click(screen.getByRole("button", { name: "儲存自動催繳設定" }));

    await waitFor(() => expect(urls).toContain("PUT /admin/settings/auto-nudge"));
    await screen.findByText(/已開啟：欠款超過 14 天/);
  });

  test("shows what recognition actually did and what it cost", async () => {
    fakeAdminApi({ ...baseRoutes, "GET /admin/settings/receipt-scan": settings });
    renderAdmin("?tab=settings");

    // The switch is here because the feature costs money per call; the numbers
    // that justify flipping it have to be on the same screen.
    // Wait on a tile, not the heading: the heading is part of the loading state
    // too, so awaiting it races the fetch and only loses on a slow machine.
    expect(await screen.findByText("3 位使用者")).toBeTruthy();
    expect(screen.getByText("辨識用量")).toBeTruthy();
    // Sub-cent spend stays legible instead of rounding to "$0.00".
    expect(screen.getAllByText("$0.114").length).toBeGreaterThan(0);
    expect(screen.getAllByText("4.4 s").length).toBeGreaterThan(0);
    expect(screen.getByText("4 次呼叫失敗")).toBeTruthy();
    // Who is spending it — the only way to notice one runaway client.
    expect(screen.getAllByText("alice@example.com").length).toBeGreaterThan(0);
    expect(screen.getByText("upstream returned 429")).toBeTruthy();
  });

  test("a missing usage ledger does not take the kill switch down with it", async () => {
    const routes: AdminRoutes = { ...baseRoutes, "GET /admin/settings/receipt-scan": settings };

    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const path = String(url).replace(/^\/api\/v1/, "").split("?")[0];
        // A console deployed ahead of the migration: this one endpoint 500s
        // while every other request on the page answers normally.
        if (path === "/admin/scan-usage") throw new Error("function does not exist");
        const body = routes[`GET ${path}`];
        if (body === undefined) throw new Error(`No fake route for "GET ${path}"`);
        return { ok: true, status: 200, json: async () => body } as Response;
      }),
    );
    renderAdmin("?tab=settings");

    expect(await screen.findByText(/receipt_scan_logs migration/)).toBeTruthy();
    // The control that stops the spend still works, which is the point.
    expect(screen.getByLabelText("辨識模型")).toBeTruthy();
  });

  test("nothing to save until something actually changed", async () => {
    fakeAdminApi({ ...baseRoutes, "GET /admin/settings/receipt-scan": settings });
    renderAdmin("?tab=settings");

    const save = await screen.findByRole("button", { name: "儲存" });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    // Toggling away and back leaves the form clean again, rather than arming a
    // Save that would write the value already stored.
    fireEvent.click(screen.getByRole("checkbox", { name: "啟用收據辨識" }));
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("checkbox", { name: "啟用收據辨識" }));
    expect((save as HTMLButtonElement).disabled).toBe(true);
  });

  test("says so when the selected model's provider has no key", async () => {
    fakeAdminApi({
      ...baseRoutes,
      "GET /admin/settings/receipt-scan": {
        ...settings,
        model: "claude-haiku-4-5",
        models: models.map((entry) => ({ ...entry, available: false })),
      },
    });
    renderAdmin("?tab=settings");

    // Names the env var for THAT provider - the fix differs per provider.
    expect(await screen.findByText(/ANTHROPIC_API_KEY/)).toBeTruthy();
  });

  test("warns about Google's terms when the free tier is selected", async () => {
    fakeAdminApi({
      ...baseRoutes,
      "GET /admin/settings/receipt-scan": {
        ...settings,
        model: "gemini-3.6-flash",
        models: models.map((entry) => ({ ...entry, available: true })),
      },
    });
    renderAdmin("?tab=settings");

    // Receipts are the users' personal data, and the free tier's terms say
    // Google trains on it and humans may read it. That has to be in front of
    // whoever flips the switch, not in a README.
    expect(await screen.findByText(/會用你送出的內容訓練/)).toBeTruthy();
    // The key IS set in this fixture, so the missing-key error must not also
    // appear - two red boxes would make it unclear which one to act on.
    expect(screen.queryByText(/GEMINI_API_KEY/)).toBeNull();
  });

  test("marks a model whose provider has no key, rather than hiding it", async () => {
    fakeAdminApi({ ...baseRoutes, "GET /admin/settings/receipt-scan": settings });
    renderAdmin("?tab=settings");

    const picker = (await screen.findByLabelText("辨識模型")) as HTMLSelectElement;
    const gemini = [...picker.options].find((option) => option.value === "gemini-3.6-flash");
    expect(gemini?.textContent).toContain("未設定金鑰");
  });

  test("explains a missing migration rather than showing an empty panel", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const path = String(url).replace(/^\/api\/v1/, "").split("?")[0];
        if (path === "/admin/settings/receipt-scan") {
          return { ok: false, status: 500, json: async () => ({ error: { code: "INTERNAL_ERROR" } }) } as Response;
        }
        const body = (baseRoutes as Record<string, unknown>)[`${method} ${path}`];
        return { ok: true, status: 200, json: async () => body } as Response;
      }),
    );
    renderAdmin("?tab=settings");

    expect(await screen.findByText(/app_settings migration/)).toBeTruthy();
  });
});

/**
 * The support actions. These are the console's first writes against the ledger
 * itself, so what is worth pinning down is not that a button renders but that
 * the request it sends is the narrow one: only changed fields, and only for
 * roles that are allowed to send it at all.
 */
const groupMembers = [
  {
    id: "member_alice",
    user_id: "user_alice",
    display_name: "Alice",
    email: "alice@example.com",
    avatar_url: null,
    role: "owner",
    status: "active",
    joined_at: "2026-07-01T00:00:00.000Z",
    expense_count: 3,
    balance_minor: 4000,
  },
  {
    id: "member_bob",
    user_id: "user_bob",
    display_name: "Bob",
    email: "bob@example.com",
    avatar_url: null,
    role: "member",
    status: "active",
    joined_at: "2026-07-02T00:00:00.000Z",
    expense_count: 1,
    balance_minor: -4000,
  },
  {
    id: "member_ghost",
    user_id: null,
    display_name: "小明",
    email: null,
    avatar_url: null,
    role: "member",
    status: "active",
    joined_at: "2026-07-03T00:00:00.000Z",
    expense_count: 0,
    balance_minor: 0,
  },
];

const groupExpense = {
  id: "expense_1",
  title: "拉麵",
  kind: "expense",
  category: "food",
  amount_minor: 4000,
  currency: "TWD",
  expense_date: "2026-07-20",
  note: null,
  image_url: null,
  receipt_image_url: null,
  created_at: "2026-07-20T02:00:00.000Z",
  deleted_at: null,
  version: 1,
  created_by_name: "Alice",
  transfer_to_name: null,
  payers: [{ member_id: "member_alice", display_name: "Alice", amount_minor: 4000, currency: "TWD" }],
  shares: [
    { member_id: "member_alice", display_name: "Alice", share_type: "equal", share_value: null, amount_minor: 2000 },
    { member_id: "member_bob", display_name: "Bob", share_type: "equal", share_value: null, amount_minor: 2000 },
  ],
};

const groupDetailRoutes: AdminRoutes = {
  ...baseRoutes,
  "GET /admin/groups/group_1": {
    group: {
      id: "group_1",
      name: "東京旅行",
      currency: "TWD",
      created_at: "2026-07-01T00:00:00.000Z",
      archived_at: null,
      deleted_at: null,
      member_count: 3,
      expense_count: 1,
      deleted_expense_count: 0,
      spend_total_minor: 4000,
      last_expense_at: "2026-07-20T02:00:00.000Z",
      owner_display_name: "Alice",
      cover_image_url: null,
    },
    members: groupMembers,
    invites: [],
  },
  "GET /admin/groups/group_1/expenses": { total: 1, expenses: [groupExpense] },
  "POST /admin/groups/group_1/transfer-owner": {
    ok: true,
    group_id: "group_1",
    owner_member_id: "member_bob",
    owner_user_id: "user_bob",
    owner_display_name: "Bob",
  },
  "PATCH /admin/groups/group_1/expenses/expense_1": {
    id: "expense_1",
    title: "拉麵",
    category: "transport",
    expense_date: "2026-07-20",
    note: null,
    deleted_at: null,
    version: 2,
  },
  "POST /admin/groups/group_1/expenses/expense_1/delete": {
    id: "expense_1",
    title: "拉麵",
    category: "food",
    expense_date: "2026-07-20",
    note: null,
    deleted_at: "2026-08-05T00:00:00.000Z",
    version: 2,
  },
};

describe("support actions", () => {
  test("owner transfer offers only claimed members who are not already the owner", async () => {
    fakeAdminApi(groupDetailRoutes);
    renderAdmin("?tab=groups&group=group_1");

    const select = (await screen.findByLabelText("轉移擁有者")) as HTMLSelectElement;
    const options = within(select).getAllByRole("option").map((option) => option.textContent);

    // Alice is the current owner and 小明 has never been claimed by a login.
    expect(options).toEqual(["選擇新的擁有者…", "Bob"]);
  });

  test("transferring posts the member id and re-reads the group", async () => {
    const urls = fakeAdminApi(groupDetailRoutes);
    renderAdmin("?tab=groups&group=group_1");

    const select = await screen.findByLabelText("轉移擁有者");
    fireEvent.change(select, { target: { value: "member_bob" } });
    fireEvent.click(screen.getByRole("button", { name: "轉移" }));
    await answerConfirm();

    await waitFor(() =>
      expect(urls.filter((url) => url === "POST /admin/groups/group_1/transfer-owner")).toHaveLength(1),
    );
    // A second detail read, so the roster on screen reflects the new owner.
    await waitFor(() =>
      expect(urls.filter((url) => url === "GET /admin/groups/group_1")).toHaveLength(2),
    );
  });

  test("editing an expense sends only the field that changed", async () => {
    let sent: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const path = String(url).replace(/^\/api\/v1/, "").split("?")[0];
        if (method === "PATCH") sent = JSON.parse(String(init?.body));
        const body = groupDetailRoutes[`${method} ${path}`];
        if (body === undefined) throw new Error(`No fake route for "${method} ${path}"`);
        return { ok: true, status: 200, json: async () => body } as Response;
      }),
    );

    renderAdmin("?tab=groups&group=group_1");

    fireEvent.click(await screen.findByText("拉麵"));
    fireEvent.click(await screen.findByRole("button", { name: "修改內容" }));
    fireEvent.change(screen.getByLabelText("分類"), { target: { value: "transport" } });
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));

    // Title, date and note were untouched, so they stay out of the patch - the
    // audit log's diff is only honest if the request is.
    await waitFor(() => expect(sent).toEqual({ category: "transport" }));
  });

  test("the money fields are not editable from the console", async () => {
    fakeAdminApi(groupDetailRoutes);
    renderAdmin("?tab=groups&group=group_1");

    fireEvent.click(await screen.findByText("拉麵"));
    fireEvent.click(await screen.findByRole("button", { name: "修改內容" }));

    expect(screen.queryByLabelText("金額")).toBeNull();
    expect(screen.getByText(/金額、付款人與分攤無法在後台修改/)).toBeTruthy();
  });

  test("a support-role account gets no write controls at all", async () => {
    fakeAdminApi({ ...groupDetailRoutes, "GET /admin/me": { ...me, role: "support" } });
    renderAdmin("?tab=groups&group=group_1");

    await screen.findByText("拉麵");
    expect(screen.queryByLabelText("轉移擁有者")).toBeNull();

    fireEvent.click(screen.getByText("拉麵"));
    expect(await screen.findByRole("dialog", { name: "帳目明細" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "修改內容" })).toBeNull();
    expect(screen.queryByRole("button", { name: "刪除這筆" })).toBeNull();
  });
});

describe("addressing a notification", () => {
  const notifyRoutes: AdminRoutes = {
    ...baseRoutes,
    "POST /admin/notifications": { ok: true, recipients: 1 },
  };

  test("the recipient is chosen from a dropdown, not typed", async () => {
    let sent: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const path = String(url).replace(/^\/api\/v1/, "").split("?")[0];
        if (path === "/admin/notifications") sent = JSON.parse(String(init?.body));
        const body = notifyRoutes[`${method} ${path}`];
        if (body === undefined) throw new Error(`No fake route for "${method} ${path}"`);
        return { ok: true, status: 200, json: async () => body } as Response;
      }),
    );

    renderAdmin("?tab=notifications");
    await screen.findByRole("region", { name: "發送通知" });

    fireEvent.change(screen.getByLabelText("發送對象"), { target: { value: "user" } });

    // No id field and no search box: the whole list is in the select.
    const picker = (await screen.findByLabelText("收件人")) as HTMLSelectElement;
    expect(screen.queryByPlaceholderText("用 email 或名稱搜尋")).toBeNull();
    await waitFor(() =>
      expect(within(picker).getAllByRole("option").map((option) => option.textContent)).toEqual([
        "選擇收件人…",
        "Alice（alice@example.com）",
      ]),
    );

    fireEvent.change(picker, { target: { value: "user_alice" } });
    fireEvent.change(screen.getByLabelText("標題"), { target: { value: "測試" } });
    fireEvent.change(screen.getByLabelText("內容"), { target: { value: "內容" } });
    fireEvent.click(screen.getByRole("button", { name: "送出通知" }));
    await answerConfirm();

    await waitFor(() =>
      expect(sent).toEqual({ audience: "user", target: "user_alice", title: "測試", body: "內容" }),
    );
  });

  test("the group dropdown lists groups, and switching drops the previous pick", async () => {
    fakeAdminApi(notifyRoutes);
    renderAdmin("?tab=notifications");
    await screen.findByRole("region", { name: "發送通知" });

    fireEvent.change(screen.getByLabelText("發送對象"), { target: { value: "user" } });
    const userPicker = (await screen.findByLabelText("收件人")) as HTMLSelectElement;
    await waitFor(() => expect(within(userPicker).getAllByRole("option")).toHaveLength(2));
    fireEvent.change(userPicker, { target: { value: "user_alice" } });
    expect(userPicker.value).toBe("user_alice");

    fireEvent.change(screen.getByLabelText("發送對象"), { target: { value: "group" } });

    // A fresh, empty group select - not Alice's id carried across as a group id.
    const groupPicker = (await screen.findByLabelText("收件群組")) as HTMLSelectElement;
    expect(groupPicker.value).toBe("");
    await waitFor(() =>
      expect(within(groupPicker).getAllByRole("option").map((option) => option.textContent)).toEqual([
        "選擇收件群組…",
        "東京旅行（2 位成員）",
      ]),
    );
  });

  test("a broadcast asks for no target at all", async () => {
    fakeAdminApi(notifyRoutes);
    renderAdmin("?tab=notifications");
    await screen.findByRole("region", { name: "發送通知" });

    expect(screen.queryByLabelText("收件人")).toBeNull();
    expect(screen.getByRole("button", { name: "送出通知" })).toBeTruthy();
  });
});

describe("notifying one person from their page", () => {
  const userDetail = {
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
  };

  const routes: AdminRoutes = {
    ...baseRoutes,
    "GET /admin/users/user_alice": userDetail,
    "POST /admin/notifications": { ok: true, recipients: 1 },
  };

  test("the shortcut opens the compose form already addressed to them", async () => {
    fakeAdminApi(routes);
    renderAdmin("?tab=users&user=user_alice");
    await screen.findByRole("region", { name: "使用者詳情" });

    // findBy, not getBy: the section renders while the detail is still loading,
    // and the button only exists once it has arrived.
    fireEvent.click(await screen.findByRole("button", { name: "發通知給這個人" }));

    await screen.findByRole("region", { name: "發送通知" });
    // Addressed, and nothing to pick again.
    expect((screen.getByLabelText("發送對象") as HTMLSelectElement).value).toBe("user");
    await waitFor(() => expect((screen.getByLabelText("收件人") as HTMLSelectElement).value).toBe("user_alice"));
  });

  test("the address is in the URL, so the half-written message survives a reload", async () => {
    fakeAdminApi(routes);
    renderAdmin("?tab=users&user=user_alice");
    await screen.findByRole("region", { name: "使用者詳情" });

    // findBy, not getBy: the section renders while the detail is still loading,
    // and the button only exists once it has arrived.
    fireEvent.click(await screen.findByRole("button", { name: "發通知給這個人" }));
    await screen.findByRole("region", { name: "發送通知" });

    expect(window.location.search).toBe("?tab=notifications&user=user_alice");
  });

  test("it sends to that person, not to everybody", async () => {
    let sent: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const path = String(url).replace(/^\/api\/v1/, "").split("?")[0];
        if (path === "/admin/notifications") sent = JSON.parse(String(init?.body));
        const body = routes[`${method} ${path}`];
        if (body === undefined) throw new Error(`No fake route for "${method} ${path}"`);
        return { ok: true, status: 200, json: async () => body } as Response;
      }),
    );

    renderAdmin("?tab=notifications&user=user_alice");
    await screen.findByRole("region", { name: "發送通知" });

    fireEvent.change(screen.getByLabelText("標題"), { target: { value: "關於你的回報" } });
    fireEvent.change(screen.getByLabelText("內容"), { target: { value: "已經修好了" } });
    fireEvent.click(screen.getByRole("button", { name: "送出通知" }));
    await answerConfirm();

    await waitFor(() =>
      expect(sent).toEqual({
        audience: "user",
        target: "user_alice",
        title: "關於你的回報",
        body: "已經修好了",
      }),
    );
  });

  test("a support account gets no shortcut, because it cannot send", async () => {
    fakeAdminApi({ ...routes, "GET /admin/me": { ...me, role: "support" } });
    renderAdmin("?tab=users&user=user_alice");
    await screen.findByRole("region", { name: "使用者詳情" });
    // Wait for the detail to land, or this would pass simply because nothing
    // has rendered yet.
    await screen.findByText("alice@example.com");

    expect(screen.queryByRole("button", { name: "發通知給這個人" })).toBeNull();
  });
});

describe("notifying a whole group from its page", () => {
  const routes: AdminRoutes = {
    ...groupDetailRoutes,
    "POST /admin/notifications": { ok: true, recipients: 3 },
  };

  test("the shortcut opens the compose form addressed to that group", async () => {
    fakeAdminApi(routes);
    renderAdmin("?tab=groups&group=group_1");
    await screen.findByText("拉麵");

    fireEvent.click(screen.getByRole("button", { name: "發通知給這個群組" }));

    await screen.findByRole("region", { name: "發送通知" });
    expect(window.location.search).toBe("?tab=notifications&group=group_1");
    expect((screen.getByLabelText("發送對象") as HTMLSelectElement).value).toBe("group");
    await waitFor(() => expect((screen.getByLabelText("收件群組") as HTMLSelectElement).value).toBe("group_1"));
  });

  test("it sends to that group, not to everybody", async () => {
    let sent: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const path = String(url).replace(/^\/api\/v1/, "").split("?")[0];
        if (path === "/admin/notifications") sent = JSON.parse(String(init?.body));
        const body = routes[`${method} ${path}`];
        if (body === undefined) throw new Error(`No fake route for "${method} ${path}"`);
        return { ok: true, status: 200, json: async () => body } as Response;
      }),
    );

    renderAdmin("?tab=notifications&group=group_1");
    await screen.findByRole("region", { name: "發送通知" });
    await waitFor(() => expect((screen.getByLabelText("收件群組") as HTMLSelectElement).value).toBe("group_1"));

    fireEvent.change(screen.getByLabelText("標題"), { target: { value: "這個群組的帳目已修正" } });
    fireEvent.change(screen.getByLabelText("內容"), { target: { value: "請重新整理" } });
    fireEvent.click(screen.getByRole("button", { name: "送出通知" }));
    await answerConfirm();

    await waitFor(() =>
      expect(sent).toEqual({
        audience: "group",
        target: "group_1",
        title: "這個群組的帳目已修正",
        body: "請重新整理",
      }),
    );
  });

  test("a deleted group offers no shortcut, because its members have no group to read about", async () => {
    const deleted = groupDetailRoutes["GET /admin/groups/group_1"] as { group: Record<string, unknown> };
    fakeAdminApi({
      ...routes,
      "GET /admin/groups/group_1": {
        ...deleted,
        group: { ...deleted.group, deleted_at: "2026-08-01T00:00:00.000Z" },
      },
    });
    renderAdmin("?tab=groups&group=group_1");
    await screen.findByText("拉麵");

    expect(screen.queryByRole("button", { name: "發通知給這個群組" })).toBeNull();
  });

  test("a support account gets no shortcut, because it cannot send", async () => {
    fakeAdminApi({ ...routes, "GET /admin/me": { ...me, role: "support" } });
    renderAdmin("?tab=groups&group=group_1");
    await screen.findByText("拉麵");

    expect(screen.queryByRole("button", { name: "發通知給這個群組" })).toBeNull();
  });
});


/**
 * The retention table's honesty rules.
 *
 * The presentation IS the feature here. A cohort table that shows a confident
 * 33.3% over three people, or a 0 where a period simply has not happened yet,
 * is worse than no table - it invites conclusions the data cannot support.
 */
describe("the retention table", () => {
  const retentionRoutes = {
    ...baseRoutes,
    "GET /admin/retention": {
      period: "week",
      total_users: 8,
      never_active: 3,
      cohorts: [
        // Three periods elapsed for this one.
        { start: "2026-06-29", size: 2, retained: [2, 2, 1] },
        // Only one has elapsed for this one - the rest must render blank, not 0.
        { start: "2026-07-13", size: 12, retained: [7] },
      ],
    },
  };

  test("shows how many signed up and never recorded anything", async () => {
    // At a small sample this single number says more than the whole curve.
    fakeAdminApi(retentionRoutes);
    renderAdmin();

    expect(await screen.findByText(/3 位註冊後從來沒記過任何一筆/)).toBeTruthy();
  });

  test("cells carry counts, in order", async () => {
    fakeAdminApi(retentionRoutes);
    renderAdmin();

    const row = (await screen.findByText("2026-06-29")).closest("tr") as HTMLElement;
    const cells = [...row.querySelectorAll(".admin-retention-cell")].map((cell) => cell.textContent);

    // size 2, then 2 / 2 / 1 across three elapsed periods.
    expect(cells).toEqual(["2", "2", "1"]);
  });

  test("no percentage on a cohort too small for one to mean anything", async () => {
    // 1 of 2 is not "50%", it is one person.
    fakeAdminApi(retentionRoutes);
    renderAdmin();

    const row = (await screen.findByText("2026-06-29")).closest("tr") as HTMLElement;
    expect(within(row).queryByText(/%/)).toBeNull();
  });

  test("but a big enough cohort does get one", async () => {
    fakeAdminApi(retentionRoutes);
    renderAdmin();

    const row = (await screen.findByText("2026-07-13")).closest("tr") as HTMLElement;
    // 7 of 12.
    expect(within(row).getByText("58%")).toBeTruthy();
  });

  test("a period that has not happened yet is blank, not zero", async () => {
    // A 0 would read as everybody leaving rather than as no data.
    fakeAdminApi(retentionRoutes);
    renderAdmin();

    const row = (await screen.findByText("2026-07-13")).closest("tr") as HTMLElement;
    const future = row.querySelectorAll(".admin-retention-cell--future");
    expect(future.length).toBe(2);
    for (const cell of future) expect(cell.textContent).toBe("");
  });

  test("says out loud that it only measures recording", async () => {
    fakeAdminApi(retentionRoutes);
    renderAdmin();

    expect(await screen.findByText(/從不記帳、但每次都準時付錢的人/)).toBeTruthy();
  });
});

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

/**
 * An export that hits the 5,000-row cap.
 *
 * The fake answers every page with the same body regardless of offset, so the
 * walk collects a page at a time until the cap stops it - which is the shape
 * that matters here: `total` is far larger than what came back.
 */
const cappedUserRoutes = {
  ...baseRoutes,
  "GET /admin/users": {
    total: 12_345,
    users: Array.from({ length: 100 }, (_, index) => ({
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
  },
};

describe("an export that could not fit says so", () => {
  test("in the filename, which is the part that survives being mailed on", async () => {
    fakeAdminApi(cappedUserRoutes);
    const downloads = captureDownload();
    renderAdmin("?tab=users");
    await screen.findByRole("region", { name: "使用者查詢" });

    fireEvent.click(screen.getByRole("button", { name: "匯出 CSV" }));

    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].fileName).toContain("已截斷");
  });

  test("in the file, on a row of its own", async () => {
    fakeAdminApi(cappedUserRoutes);
    const downloads = captureDownload();
    renderAdmin("?tab=users");
    await screen.findByRole("region", { name: "使用者查詢" });

    fireEvent.click(screen.getByRole("button", { name: "匯出 CSV" }));
    await waitFor(() => expect(downloads).toHaveLength(1));

    const text = await downloads[0].blob.text();
    expect(text).toContain("已截斷");
    expect(text).toContain("12,345");
  });

  test("and on screen, while whoever pressed the button is still looking", async () => {
    fakeAdminApi(cappedUserRoutes);
    captureDownload();
    renderAdmin("?tab=users");
    await screen.findByRole("region", { name: "使用者查詢" });

    fireEvent.click(screen.getByRole("button", { name: "匯出 CSV" }));

    const notice = await screen.findByText(/已匯出前/);
    expect(notice.textContent).toContain("12,345");
  });

  test("while a complete export says none of it", async () => {
    // baseRoutes has one user and total: 1 - nothing was left behind.
    fakeAdminApi(baseRoutes);
    const downloads = captureDownload();
    renderAdmin("?tab=users");
    await screen.findByRole("region", { name: "使用者查詢" });

    fireEvent.click(screen.getByRole("button", { name: "匯出 CSV" }));

    await waitFor(() => expect(downloads).toHaveLength(1));
    expect(downloads[0].fileName).not.toContain("已截斷");
    expect(await downloads[0].blob.text()).not.toContain("已截斷");
    expect(screen.queryByText(/已匯出前/)).toBeNull();
  });
});

/** A user detail page with the merge search already answered. */
const mergeRoutes = {
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
  "POST /admin/users/user_alice/merge": { memberships_moved: 3, groups_reowned: 1 },
};

/** Opens 使用者詳情 → 合併到另一個帳號… → search → one candidate on screen. */
async function openMergeCandidate() {
  const urls = fakeAdminApi({
    ...mergeRoutes,
    "GET /admin/users": {
      total: 2,
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
        {
          id: "user_bob",
          email: "bob@example.com",
          display_name: "Bob",
          avatar_url: null,
          created_at: "2026-07-01T00:00:00.000Z",
          last_seen_at: "2026-07-29T00:00:00.000Z",
          disabled_at: null,
          group_count: 1,
          expense_count: 1,
        },
      ],
    },
  });

  renderAdmin("?tab=users&user=user_alice");
  await screen.findByRole("region", { name: "使用者詳情" });

  // The merge section is owner-only, and the role arrives with /admin/me a
  // tick after the panel itself.
  fireEvent.click(await screen.findByRole("button", { name: "合併到另一個帳號…" }));
  const panel = await screen.findByRole("region", { name: "合併帳號" });

  fireEvent.change(within(panel).getByPlaceholderText("用 email 或名稱搜尋要保留的帳號"), {
    target: { value: "bob" },
  });
  fireEvent.click(within(panel).getByRole("button", { name: "搜尋" }));

  const mergeButton = await within(panel).findByRole("button", { name: "合併到這個帳號" });
  const merged = () => urls.some((url) => url.includes("POST /admin/users/user_alice/merge"));
  return { panel, mergeButton, merged };
}

/**
 * Merging moves every membership and disables the source account, and there is
 * no unmerge. It used to be one click on window.confirm, while DELETING an
 * account - which leaves the ledger standing behind an anonymised member - has
 * always asked for the email to be typed. The risk was calibrated backwards.
 */
describe("merging two accounts", () => {
  test("asks for the target's email rather than a yes", async () => {
    const { mergeButton, merged } = await openMergeCandidate();

    fireEvent.click(mergeButton);

    const dialog = await screen.findByRole("alertdialog");
    // Not a yes/no: there is a box, and it names the account being merged INTO.
    expect(within(dialog).getByRole("textbox")).toBeTruthy();
    expect(dialog.textContent).toContain("bob@example.com");
    expect(merged()).toBe(false);
  });

  test("refuses a wrong email at the dialog, instead of accepting it and erroring after", async () => {
    const { mergeButton, merged } = await openMergeCandidate();
    fireEvent.click(mergeButton);
    const dialog = await screen.findByRole("alertdialog");

    // The source account's own email is the plausible wrong answer.
    fireEvent.change(within(dialog).getByRole("textbox"), { target: { value: "alice@example.com" } });

    const buttons = within(dialog).getAllByRole("button");
    expect((buttons[buttons.length - 1] as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(buttons[buttons.length - 1]);
    expect(merged()).toBe(false);
  });

  test("and it goes through once that email is typed", async () => {
    const { mergeButton, merged } = await openMergeCandidate();

    fireEvent.click(mergeButton);
    // Trimmed and case-insensitive, the same way the delete guard reads it.
    await answerConfirm("  BOB@example.com  ");

    await waitFor(() => expect(merged()).toBe(true));
  });

  test("backing out of the dialog merges nothing", async () => {
    const { mergeButton, merged } = await openMergeCandidate();
    fireEvent.click(mergeButton);
    const dialog = await screen.findByRole("alertdialog");

    fireEvent.click(within(dialog).getAllByRole("button")[0]);

    await waitFor(() => expect(screen.queryByRole("alertdialog")).toBeNull());
    expect(merged()).toBe(false);
  });
});
