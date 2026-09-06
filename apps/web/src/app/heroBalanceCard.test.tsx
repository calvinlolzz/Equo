// @vitest-environment jsdom
import { configure, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fakeApi, group, groupDetail, renderApp, signIn, stubBrowser } from "./appTestHarness";

configure({ asyncUtilTimeout: 4_000 });
vi.setConfig({ testTimeout: 15_000 });

beforeEach(() => stubBrowser({ mobile: true }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const PEOPLE = [
  { id: "member_alice", user_id: "user_alice", display_name: "Alice", role: "owner" as const, balance: 100 },
  { id: "member_bob", user_id: "user_bob", display_name: "Bob", role: "member" as const, balance: 200 },
  { id: "member_cara", user_id: "user_cara", display_name: "Cara", role: "member" as const, balance: 900_000 },
  { id: "member_dan", user_id: "user_dan", display_name: "Dan", role: "member" as const, balance: -300 },
];

/** Four members; Cara is wildly out of balance and Dan is nearly settled. */
function fourMemberDetail() {
  return groupDetail({
    members: PEOPLE.map((person) => ({
      id: person.id,
      group_id: "group_1",
      user_id: person.user_id,
      display_name: person.display_name,
      role: person.role,
      status: "active" as const,
    })),
    balances: PEOPLE.map((person) => ({
      memberId: person.id,
      balance: { amount_minor: person.balance, currency: "TWD" },
    })),
  });
}

/** The two-row balance list inside the home hero card. */
function balanceList(): HTMLElement {
  const card = document.getElementById("group-home");
  if (!card) throw new Error("the home card is not on screen");
  const list = card.querySelector<HTMLElement>(".hero-balance-list");
  if (!list) throw new Error("the home card has no balance list");
  return list;
}

async function landAs(userId: string, displayName: string) {
  signIn({ id: userId, displayName });
  fakeApi([
    { route: "GET /groups", body: { groups: [group()] } },
    { route: "GET /groups/group_1", body: fourMemberDetail() },
  ]);
  renderApp();
  await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));
  await waitFor(() => expect(balanceList().textContent).toBeTruthy());
}

describe("the home card's balance rows", () => {
  test("show you, wherever you sit in the group", async () => {
    // Dan is members[3] and nearly settled - neither of the two things the old
    // `members.slice(0, 2)` would have picked.
    await landAs("user_dan", "Dan");
    expect(within(balanceList()).getByText("Dan")).toBeTruthy();
  });

  test("give the second row to whoever is furthest from settled", async () => {
    await landAs("user_dan", "Dan");
    expect(within(balanceList()).getByText("Cara")).toBeTruthy();
    // Bob is members[1] and would have had the row purely for being early.
    expect(within(balanceList()).queryByText("Bob")).toBeNull();
  });

  test("stay two rows - this is a summary, not the member list", async () => {
    await landAs("user_alice", "Alice");
    expect(balanceList().querySelectorAll(".hero-balance-row")).toHaveLength(2);
  });

  test("never show you twice when you are also the biggest imbalance", async () => {
    await landAs("user_cara", "Cara");
    const rows = [...balanceList().querySelectorAll(".hero-balance-row")];
    expect(rows).toHaveLength(2);
    expect(rows.filter((row) => row.textContent?.includes("Cara"))).toHaveLength(1);
  });
});
