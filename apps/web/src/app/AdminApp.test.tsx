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
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "儲存" }));

    await waitFor(() => expect(urls).toContain("PUT /admin/settings/receipt-scan"));
    await screen.findByText(/已關閉收據辨識/);
  });

  test("nothing to save until something actually changed", async () => {
    fakeAdminApi({ ...baseRoutes, "GET /admin/settings/receipt-scan": settings });
    renderAdmin("?tab=settings");

    const save = await screen.findByRole("button", { name: "儲存" });
    expect((save as HTMLButtonElement).disabled).toBe(true);

    // Toggling away and back leaves the form clean again, rather than arming a
    // Save that would write the value already stored.
    fireEvent.click(screen.getByRole("checkbox"));
    expect((save as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole("checkbox"));
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
    vi.stubGlobal("confirm", () => true);
    renderAdmin("?tab=groups&group=group_1");

    const select = await screen.findByLabelText("轉移擁有者");
    fireEvent.change(select, { target: { value: "member_bob" } });
    fireEvent.click(screen.getByRole("button", { name: "轉移" }));

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

  test("picking a recipient sends their id, without anyone typing a uuid", async () => {
    let sent: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const method = init?.method ?? "GET";
        const full = String(url).replace(/^\/api\/v1/, "");
        const path = full.split("?")[0];
        if (path === "/admin/notifications") sent = JSON.parse(String(init?.body));
        const body = notifyRoutes[`${method} ${path}`];
        if (body === undefined) throw new Error(`No fake route for "${method} ${path}"`);
        return { ok: true, status: 200, json: async () => body } as Response;
      }),
    );
    vi.stubGlobal("confirm", () => true);

    renderAdmin("?tab=notifications");
    await screen.findByRole("region", { name: "發送通知" });

    fireEvent.change(screen.getByLabelText("發送對象"), { target: { value: "user" } });

    // The id never appears as an input: it is searched for and picked.
    expect(screen.queryByLabelText("使用者 ID")).toBeNull();

    fireEvent.change(await screen.findByPlaceholderText("用 email 或名稱搜尋"), { target: { value: "alice" } });
    fireEvent.click(screen.getByRole("button", { name: "搜尋" }));
    fireEvent.click(await screen.findByRole("button", { name: "選這個" }));

    fireEvent.change(screen.getByLabelText("標題"), { target: { value: "測試" } });
    fireEvent.change(screen.getByLabelText("內容"), { target: { value: "內容" } });
    fireEvent.click(screen.getByRole("button", { name: "送出通知" }));

    await waitFor(() =>
      expect(sent).toEqual({ audience: "user", target: "user_alice", title: "測試", body: "內容" }),
    );
  });

  test("switching audience drops the target, so a user id is never sent as a group id", async () => {
    fakeAdminApi(notifyRoutes);
    renderAdmin("?tab=notifications");
    await screen.findByRole("region", { name: "發送通知" });

    fireEvent.change(screen.getByLabelText("發送對象"), { target: { value: "user" } });
    fireEvent.change(await screen.findByPlaceholderText("用 email 或名稱搜尋"), { target: { value: "alice" } });
    fireEvent.click(screen.getByRole("button", { name: "搜尋" }));
    fireEvent.click(await screen.findByRole("button", { name: "選這個" }));
    expect(screen.getByText("Alice")).toBeTruthy();

    fireEvent.change(screen.getByLabelText("發送對象"), { target: { value: "group" } });

    // Back to an empty search against groups, not Alice carried across.
    expect(await screen.findByPlaceholderText("用群組名稱搜尋")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "換一個" })).toBeNull();
  });

  test("Enter in the search box searches, it does not send the notification", async () => {
    const urls = fakeAdminApi(notifyRoutes);
    renderAdmin("?tab=notifications");
    await screen.findByRole("region", { name: "發送通知" });

    fireEvent.change(screen.getByLabelText("發送對象"), { target: { value: "user" } });
    const box = await screen.findByPlaceholderText("用 email 或名稱搜尋");
    fireEvent.change(box, { target: { value: "alice" } });
    fireEvent.keyDown(box, { key: "Enter" });

    // The search ran...
    await waitFor(() => expect(urls.some((url) => url.includes("/admin/users?search=alice"))).toBe(true));
    // ...and nothing was sent. A nested <form> here would have submitted the
    // outer one, i.e. broadcast a half-written notification.
    expect(urls.some((url) => url === "POST /admin/notifications")).toBe(false);
  });

  test("a broadcast asks for no target at all", async () => {
    fakeAdminApi(notifyRoutes);
    renderAdmin("?tab=notifications");
    await screen.findByRole("region", { name: "發送通知" });

    expect(screen.queryByPlaceholderText("用 email 或名稱搜尋")).toBeNull();
    expect(screen.getByRole("button", { name: "送出通知" })).toBeTruthy();
  });
});
