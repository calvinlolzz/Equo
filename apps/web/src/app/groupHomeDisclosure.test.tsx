// @vitest-environment jsdom
import { configure, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { ExpenseSummary } from "./apiClient";
import { type ApiRoute, fakeApi, group, groupDetail, renderApp, signIn, stubBrowser } from "./appTestHarness";
import { UI_TEXT } from "./uiText";

configure({ asyncUtilTimeout: 4_000 });
vi.setConfig({ testTimeout: 15_000 });

const app = UI_TEXT.app;

beforeEach(() => stubBrowser({ mobile: true }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

type Person = {
  id: string;
  user_id: string;
  display_name: string;
  role: "owner" | "member";
  balance: number;
};

/** A group detail built from a short-hand member/balance list, TWD throughout. */
function personDetail(people: Person[], overrides: Parameters<typeof groupDetail>[0] = {}) {
  return groupDetail({
    members: people.map((person) => ({
      id: person.id,
      group_id: "group_1",
      user_id: person.user_id,
      display_name: person.display_name,
      role: person.role,
      status: "active" as const,
    })),
    balances: people.map((person) => ({
      memberId: person.id,
      balance: { amount_minor: person.balance, currency: "TWD" },
    })),
    ...overrides,
  });
}

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

async function land(detail: ReturnType<typeof groupDetail>, extraRoutes: ApiRoute[] = []) {
  signIn();
  const api = fakeApi([
    { route: "GET /groups", body: { groups: [group()] } },
    { route: "GET /groups/group_1", body: detail },
    ...extraRoutes,
  ]);
  renderApp();
  await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));
  return api;
}

/** The collapsible row for one member, found by their name. */
function memberRow(name: string): HTMLElement {
  const row = screen.getByText(name).closest(".member-row");
  if (!row) throw new Error(`no member row for ${name}`);
  return row as HTMLElement;
}

function toggleRow(name: string) {
  const head = memberRow(name).querySelector<HTMLElement>(".member-row-head");
  if (!head) throw new Error(`no toggle head for ${name}`);
  fireEvent.click(head);
}

describe("a collapsed member row", () => {
  test("is a name and a number until you tap it", async () => {
    await land(
      personDetail([
        { id: "member_alice", user_id: "user_alice", display_name: "Alice", role: "owner", balance: 4355 },
        { id: "member_bob", user_id: "user_bob", display_name: "Bob", role: "member", balance: -4355 },
      ]),
    );
    await screen.findByText("Bob");

    // Collapsed: no actions, no status line.
    expect(within(memberRow("Bob")).queryByRole("button", { name: app.clearDebt })).toBeNull();
    expect(within(memberRow("Bob")).queryByRole("button", { name: `${app.nudgeAria}: Bob` })).toBeNull();
    expect(within(memberRow("Bob")).queryByText(app.member)).toBeNull();
    expect(memberRow("Bob").querySelector(".member-row-head")?.getAttribute("aria-expanded")).toBe("false");

    toggleRow("Bob");

    // Expanded: all three actions, plus the status line.
    expect(within(memberRow("Bob")).getByRole("button", { name: app.clearDebt })).toBeTruthy();
    expect(within(memberRow("Bob")).getByRole("button", { name: `${app.nudgeAria}: Bob` })).toBeTruthy();
    expect(within(memberRow("Bob")).getByRole("button", { name: app.viewAll })).toBeTruthy();
    expect(memberRow("Bob").querySelector(".member-row-head")?.getAttribute("aria-expanded")).toBe("true");
  });
});

describe("the member list", () => {
  test("keeps only one row open at a time", async () => {
    await land(
      personDetail([
        { id: "member_alice", user_id: "user_alice", display_name: "Alice", role: "owner", balance: 8000 },
        { id: "member_bob", user_id: "user_bob", display_name: "Bob", role: "member", balance: -5000 },
        { id: "member_cara", user_id: "user_cara", display_name: "Cara", role: "member", balance: -3000 },
      ]),
    );
    await screen.findByText("Bob");

    toggleRow("Bob");
    expect(memberRow("Bob").querySelector(".member-row-head")?.getAttribute("aria-expanded")).toBe("true");

    // Opening Cara's row closes Bob's - its actions go with it.
    toggleRow("Cara");
    expect(memberRow("Cara").querySelector(".member-row-head")?.getAttribute("aria-expanded")).toBe("true");
    expect(memberRow("Bob").querySelector(".member-row-head")?.getAttribute("aria-expanded")).toBe("false");
    expect(within(memberRow("Bob")).queryByRole("button", { name: app.clearDebt })).toBeNull();

    // Tapping the open row again closes it too.
    toggleRow("Cara");
    expect(memberRow("Cara").querySelector(".member-row-head")?.getAttribute("aria-expanded")).toBe("false");
  });
});

describe("the balance card says what it can prove", () => {
  test("everyone settled: one line, no bar, no amount", async () => {
    await land(
      personDetail([
        { id: "member_alice", user_id: "user_alice", display_name: "Alice", role: "owner", balance: 0 },
        { id: "member_bob", user_id: "user_bob", display_name: "Bob", role: "member", balance: 0 },
      ]),
    );
    expect(await screen.findByText(app.settled)).toBeTruthy();
    expect(document.querySelector(".home-balance-bar")).toBeNull();
    expect(document.querySelector(".home-balance-amount")).toBeNull();
  });

  test("one debtor: the amount, but no bar - a single segment proves nothing", async () => {
    await land(
      personDetail([
        { id: "member_alice", user_id: "user_alice", display_name: "Alice", role: "owner", balance: 4355 },
        { id: "member_bob", user_id: "user_bob", display_name: "Bob", role: "member", balance: -4355 },
      ]),
    );
    await screen.findByText("$43.55");
    expect(document.querySelector(".home-balance-bar")).toBeNull();
    expect(screen.getByText(`1 ${app.owedByCount}`)).toBeTruthy();
  });

  test("two debtors: a proportional bar", async () => {
    await land(
      personDetail([
        { id: "member_alice", user_id: "user_alice", display_name: "Alice", role: "owner", balance: 8000 },
        { id: "member_bob", user_id: "user_bob", display_name: "Bob", role: "member", balance: -5000 },
        { id: "member_cara", user_id: "user_cara", display_name: "Cara", role: "member", balance: -3000 },
      ]),
    );
    await screen.findByText("$80");
    const bar = document.querySelector(".home-balance-bar");
    if (!bar) throw new Error("no balance bar");
    expect(bar.querySelectorAll("i")).toHaveLength(2);
    // Bob owes 5000 of the 8000 total - his segment is 62.5% wide.
    expect((bar.children[0] as HTMLElement).style.width).toBe("62.5%");
  });
});

describe("提醒 N 位成員", () => {
  test("sends to everyone owing, folds a cooldown into success, and empties once done", async () => {
    const detail = personDetail([
      { id: "member_alice", user_id: "user_alice", display_name: "Alice", role: "owner", balance: 8000 },
      { id: "member_bob", user_id: "user_bob", display_name: "Bob", role: "member", balance: -5000 },
      { id: "member_cara", user_id: "user_cara", display_name: "Cara", role: "member", balance: -3000 },
    ]);
    const api = await land(detail, [
      { route: "POST /groups/group_1/members/member_bob/nudge", body: { nudge: { status: "sent" } } },
      {
        route: "POST /groups/group_1/members/member_cara/nudge",
        status: 409,
        body: { error: { code: "NUDGE_COOLDOWN", message: "too soon", request_id: "req_1" } },
      },
    ]);

    const bulk = await screen.findByRole("button", { name: `${app.nudge} 2 ${app.people}` });
    fireEvent.click(bulk);

    // Promise.allSettled - both requests go out, not just the first.
    await waitFor(() => {
      expect(api.calls).toContain("POST /groups/group_1/members/member_bob/nudge");
      expect(api.calls).toContain("POST /groups/group_1/members/member_cara/nudge");
    });
    // One success + one cooldown = the success toast, not a failure toast.
    // Scoped to the toast dock (role="status"): nudgeSentToast and an
    // expanded row's nudgeSent badge are the identical string "已提醒" in
    // Chinese, so an unscoped query would be correct here only by chance of
    // no row being open.
    const toast = await screen.findByRole("status");
    await waitFor(() => expect(within(toast).getByText(app.nudgeSentToast)).toBeTruthy());
    // Both are spent (sent, and already-reminded) - nobody left to offer.
    await waitFor(() => expect(screen.queryByRole("button", { name: new RegExp(`^${app.nudge} `) })).toBeNull());
  });

  test("does not appear when nobody can be reminded", async () => {
    await land(
      personDetail([
        { id: "member_alice", user_id: "user_alice", display_name: "Alice", role: "owner", balance: 0 },
        { id: "member_bob", user_id: "user_bob", display_name: "Bob", role: "member", balance: 0 },
      ]),
    );
    await screen.findByText("Bob");
    expect(screen.queryByRole("button", { name: new RegExp(`^${app.nudge} `) })).toBeNull();
  });
});

describe("the summary rows hide themselves when they have nothing", () => {
  const soloAlice: Person[] = [{ id: "member_alice", user_id: "user_alice", display_name: "Alice", role: "owner", balance: 0 }];

  test("這個月 needs at least 3 records", async () => {
    await land(
      personDetail(soloAlice, {
        expenses: [expenseRow(), expenseRow({ id: "expense_2" })],
        expense_count: 2,
      }),
    );
    await waitFor(() => expect(document.getElementById("group-records")).toBeTruthy());
    expect(document.getElementById("group-analysis")).toBeNull();
  });

  test("這個月 shows up at 3", async () => {
    await land(
      personDetail(soloAlice, {
        expenses: [expenseRow(), expenseRow({ id: "expense_2" }), expenseRow({ id: "expense_3" })],
        expense_count: 3,
      }),
    );
    await waitFor(() => expect(document.getElementById("group-analysis")).toBeTruthy());
  });

  test("動態 is gone entirely with nothing to show", async () => {
    // Not the brand-new-group fixture - that hides the whole disclosure row
    // set (see "a brand new group" below), which would make this test pass
    // for the wrong reason.
    await land(personDetail(soloAlice, { expenses: [expenseRow()], expense_count: 1, spend_total_minor: 96_000 }));
    // Wait for the card to have landed, so "not there" means gone rather
    // than not rendered yet. (Not by the 支出記錄 text - the group side nav
    // has its own nav item with that exact label.)
    await waitFor(() => expect(document.getElementById("group-records")).toBeTruthy());
    expect(screen.queryByRole("region", { name: app.recentActivity })).toBeNull();
  });

  // [MV]
  test("最近記錄 shows the latest 3 without a tap", async () => {
    await land(
      personDetail(soloAlice, {
        expenses: [expenseRow(), expenseRow({ id: "expense_2" }), expenseRow({ id: "expense_3" }), expenseRow({ id: "expense_4" })],
        expense_count: 4,
      }),
    );
    const section = await waitFor(() => {
      const node = document.getElementById("group-records");
      if (!node) throw new Error("no #group-records");
      return node;
    });
    expect(section.querySelectorAll(".expense-record-row")).toHaveLength(3);
    expect(section.querySelector(".home-disclosure-toggle")).toBeNull();
  });
});

describe("labelled amounts on the home disclosures", () => {
  const soloAlice: Person[] = [{ id: "member_alice", user_id: "user_alice", display_name: "Alice", role: "owner", balance: 0 }];

  // [MV]
  test("這個月's summary says whose spend it is", async () => {
    await land(
      personDetail(soloAlice, {
        expenses: [expenseRow(), expenseRow({ id: "expense_2" }), expenseRow({ id: "expense_3" })],
        expense_count: 3,
      }),
    );
    const section = await waitFor(() => {
      const node = document.getElementById("group-analysis");
      if (!node) throw new Error("no #group-analysis");
      return node;
    });
    const summary = section.querySelector(".home-disclosure-summary");
    expect(summary?.textContent).toContain(app.spendDayYourShare);
  });

  test("the title row's total is labelled 累計支出, not 總計", async () => {
    await land(personDetail(soloAlice, { expenses: [expenseRow()], expense_count: 1, spend_total_minor: 96_000 }));
    const card = document.getElementById("group-home");
    if (!card) throw new Error("no home card");
    const p = await waitFor(() => {
      const node = card.querySelector(".home-title-row p");
      if (!node) throw new Error("no title row");
      return node;
    });
    expect(p.textContent).toContain(UI_TEXT.records.totalSpend);
  });
});

describe("settled groups move the member list below records", () => {
  const settledPair: Person[] = [
    { id: "member_alice", user_id: "user_alice", display_name: "Alice", role: "owner", balance: 0 },
    { id: "member_bob", user_id: "user_bob", display_name: "Bob", role: "member", balance: 0 },
  ];
  const unsettledPair: Person[] = [
    { id: "member_alice", user_id: "user_alice", display_name: "Alice", role: "owner", balance: 4355 },
    { id: "member_bob", user_id: "user_bob", display_name: "Bob", role: "member", balance: -4355 },
  ];
  const threeExpenses = [expenseRow(), expenseRow({ id: "expense_2" }), expenseRow({ id: "expense_3" })];

  // [MV]
  test("settled: #group-records comes before #group-members, and the balance card is gone", async () => {
    await land(personDetail(settledPair, { expenses: threeExpenses, expense_count: 3 }));
    const records = await waitFor(() => {
      const node = document.getElementById("group-records");
      if (!node) throw new Error("no #group-records");
      return node;
    });
    const memberSection = document.getElementById("group-members");
    if (!memberSection) throw new Error("no #group-members");

    // DOCUMENT_POSITION_FOLLOWING (4): records comes BEFORE members.
    // eslint-disable-next-line no-bitwise
    expect(records.compareDocumentPosition(memberSection) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(document.querySelector(".home-balance-card")).toBeNull();
  });

  // [MV]
  test("unsettled: #group-members stays before #group-records, inside #group-home", async () => {
    await land(personDetail(unsettledPair, { expenses: threeExpenses, expense_count: 3 }));
    // Wait for the loaded, unsettled state specifically (the balance card's
    // debtor view) - not merely for #group-members to exist, which it also
    // does, briefly, in the settled position before balances arrive.
    await screen.findByText(`1 ${app.owedByCount}`);
    const memberSection = document.getElementById("group-members");
    if (!memberSection) throw new Error("no #group-members");
    const records = document.getElementById("group-records");
    if (!records) throw new Error("no #group-records");
    const card = document.getElementById("group-home");
    if (!card) throw new Error("no #group-home");

    // eslint-disable-next-line no-bitwise
    expect(memberSection.compareDocumentPosition(records) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(card.contains(memberSection)).toBe(true);
  });
});

describe("a brand new group", () => {
  test("offers two things and nothing else", async () => {
    // groupDetail()'s default is exactly this: one member (you), no expenses.
    await land(groupDetail());
    const card = document.getElementById("group-home");
    if (!card) throw new Error("no home card");

    // Scoped to the card: the bottom-nav FAB also carries this label.
    await within(card).findByRole("button", { name: app.addExpense });
    expect(within(card).getByRole("button", { name: app.inviteMembers })).toBeTruthy();

    expect(document.querySelector(".home-member-list")).toBeNull();
    expect(document.querySelector(".home-balance-card")).toBeNull();
    expect(document.getElementById("group-records")).toBeNull();
    expect(document.getElementById("group-analysis")).toBeNull();
    expect(screen.queryByRole("region", { name: app.recentActivity })).toBeNull();
  });
});
