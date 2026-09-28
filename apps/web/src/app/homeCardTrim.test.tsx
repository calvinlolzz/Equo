// @vitest-environment jsdom
import { configure, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { ExpenseSummary } from "./apiClient";
import { fakeApi, group, groupDetail, renderApp, signIn, stubBrowser } from "./appTestHarness";
import { UI_TEXT } from "./uiText";

configure({ asyncUtilTimeout: 4_000 });
vi.setConfig({ testTimeout: 15_000 });

const app = UI_TEXT.app;

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const ALICE = {
  id: "member_alice",
  group_id: "group_1",
  user_id: "user_alice",
  display_name: "Alice",
  role: "owner" as const,
  status: "active" as const,
};
const BOB = { ...ALICE, id: "member_bob", user_id: "user_bob", display_name: "Bob", role: "member" as const };

function expenseRow(overrides: Partial<ExpenseSummary> = {}): ExpenseSummary {
  return {
    id: "expense_1",
    group_id: "group_1",
    title: "拉麵",
    kind: "expense",
    category: "food",
    amount_minor: 96_000,
    currency: "TWD",
    expense_date: "2026-09-04",
    created_at: "2026-09-04T10:00:00.000Z",
    version: 1,
    client_request_id: "seed_1",
    expense_payments: [{ payer_member_id: "member_alice", amount_minor: 96_000, currency: "TWD" }],
    expense_shares: [{ member_id: "member_alice", share_type: "fixed", amount_minor: 96_000 }],
    ...overrides,
  };
}

/** Bob owes Alice, so the 債務關係 card has something to say. */
function detail(overrides: Parameters<typeof groupDetail>[0] = {}) {
  return groupDetail({
    members: [ALICE, BOB],
    balances: [
      { memberId: "member_alice", balance: { amount_minor: 4_355, currency: "TWD" } },
      { memberId: "member_bob", balance: { amount_minor: -4_355, currency: "TWD" } },
    ],
    ...overrides,
  });
}

function homeCard(): HTMLElement {
  const card = document.getElementById("group-home");
  if (!card) throw new Error("the home card is not on screen");
  return card;
}

async function land(options: { mobile?: boolean; detail?: ReturnType<typeof groupDetail> } = {}) {
  stubBrowser({ mobile: options.mobile ?? true });
  signIn();
  fakeApi([
    { route: "GET /groups", body: { groups: [group()] } },
    { route: "GET /groups/group_1", body: options.detail ?? detail() },
  ]);
  renderApp();
  await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));
  await waitFor(() => expect(homeCard()).toBeTruthy());
}

describe("the hero donut is gone", () => {
  test("the debt figure is stated once, by the card that explains it", async () => {
    await land();
    // The balance card's own glowing amount - Alice is owed $43.55.
    await screen.findByText("$43.55");

    // The donut printed the same amount as the balance card, with only a
    // name for context - two numbers for one fact, and the vaguer one came
    // first. Bob's row prints "應付 $43.55" (a different string), so the only
    // "$43.55" left on screen is the balance card's.
    expect(screen.getAllByText("$43.55")).toHaveLength(1);
    expect(document.querySelector(".hero-donut")).toBeNull();
  });

  test("a settled group still says so, in the card that is left", async () => {
    await land({
      detail: detail({
        balances: [
          { memberId: "member_alice", balance: { amount_minor: 0, currency: "TWD" } },
          { memberId: "member_bob", balance: { amount_minor: 0, currency: "TWD" } },
        ],
      }),
    });
    expect(await screen.findByText(app.settled)).toBeTruthy();
  });
});

describe("the currency code on a record row", () => {
  test("is not printed when it is the group's own", async () => {
    await land({ detail: detail({ expenses: [expenseRow()], expense_count: 1, spend_total_minor: 96_000 }) });
    // 最近記錄 shows its rows inline - no tap required (Fix 5).
    const row = await screen.findByText("拉麵");
    const amount = row.closest(".expense-record-row")?.querySelector(".expense-record-amount");
    expect(amount?.textContent).toContain("$960");
    expect(amount?.querySelector("small")).toBeNull();
  });

  test("is printed when it is not, because $ means both TWD and USD", async () => {
    await land({
      detail: detail({
        expenses: [expenseRow({ currency: "USD" })],
        expense_count: 1,
        spend_total_minor: 96_000,
      }),
    });
    const row = await screen.findByText("拉麵");
    const amount = row.closest(".expense-record-row")?.querySelector(".expense-record-amount");
    expect(amount?.querySelector("small")?.textContent).toBe("USD");
  });
});

describe("近期活動", () => {
  test("is not on the page at all when there is none", async () => {
    await land();
    // Wait for the sections below the card, so "not there" means gone rather
    // than not rendered yet.
    await waitFor(() => expect(document.getElementById("group-records")).toBeTruthy());

    expect(screen.queryByRole("region", { name: app.recentActivity })).toBeNull();
    // Not merely the empty copy hidden inside a section that still has a
    // heading and a 查看全部 above it.
    expect(screen.queryByText(app.noActivity)).toBeNull();
    expect(screen.queryByText(app.recentActivity)).toBeNull();
  });

  test("comes back the moment there is something to show", async () => {
    stubBrowser({ mobile: true });
    signIn();
    window.localStorage.setItem(
      "equo.clean.cloud_activities",
      JSON.stringify({
        group_1: [{ id: "act_1", text: "新增支出: 拉麵", createdAt: "2026-09-05T12:00:00.000Z" }],
      }),
    );
    fakeApi([
      { route: "GET /groups", body: { groups: [group()] } },
      { route: "GET /groups/group_1", body: detail() },
    ]);
    renderApp();
    await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));

    expect(await screen.findByText("新增支出: 拉麵")).toBeTruthy();
    expect(screen.getByText(app.recentActivity)).toBeTruthy();
  });
});

describe("the group's name", () => {
  test("is not repeated by the card when the phone's top bar already has it", async () => {
    await land({ mobile: true });
    expect(within(screen.getByRole("banner")).getByText("東京旅行")).toBeTruthy();
    expect(homeCard().textContent).not.toContain("東京旅行");
  });

  test("stays on the card on a wide layout, where the top bar shows the brand", async () => {
    await land({ mobile: false });
    expect(within(screen.getByRole("banner")).getByText("Equo")).toBeTruthy();
    expect(within(homeCard()).getByRole("heading", { name: "東京旅行" })).toBeTruthy();
  });
});

describe("the card's people row", () => {
  test("加人 replaces the old member-quick-actions row and opens the same menu", async () => {
    await land();
    // The three-slot quick-actions row is gone entirely.
    expect(homeCard().querySelectorAll(".member-quick-action")).toHaveLength(0);

    // 新增成員／邀請成員 are folded into one "加人" row at the end of the
    // member list, which opens the existing memberActions sheet (both
    // options live there already - see App.tsx's onAddVirtualMember).
    const add = within(homeCard()).getByRole("button", { name: app.addMember });
    fireEvent.click(add);
    expect(await screen.findByText(app.addVirtualMember)).toBeTruthy();
  });

  test("掃描收據 moved to 最近記錄's title row - it's a recording action, not member management", async () => {
    await land();
    expect(within(homeCard()).queryByRole("button", { name: app.scanReceipt })).toBeNull();

    const scanButton = await screen.findByRole("button", { name: app.scanReceipt });
    expect(scanButton.closest("#group-records")).toBeTruthy();
  });
});
