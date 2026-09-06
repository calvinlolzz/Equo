// @vitest-environment jsdom
import { configure, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fakeApi, group, groupDetail, renderApp, signIn, stubBrowser } from "./appTestHarness";
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

/** Bob owes Alice $43.55, so the home card offers 清償債務. */
function detailWithDebt() {
  return groupDetail({
    members: [
      {
        id: "member_alice",
        group_id: "group_1",
        user_id: "user_alice",
        display_name: "Alice",
        role: "owner",
        status: "active",
      },
      {
        id: "member_bob",
        group_id: "group_1",
        user_id: "user_bob",
        display_name: "Bob",
        role: "member",
        status: "active",
      },
    ],
    balances: [
      { memberId: "member_alice", balance: { amount_minor: 4_355, currency: "TWD" } },
      { memberId: "member_bob", balance: { amount_minor: -4_355, currency: "TWD" } },
    ],
  });
}

async function landOnDebt() {
  signIn();
  fakeApi([
    { route: "GET /groups", body: { groups: [group()] } },
    { route: "GET /groups/group_1", body: detailWithDebt() },
  ]);
  renderApp();
  await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));
  return screen.findByRole("button", { name: app.clearDebt });
}

/** Did anything get written to the ledger? */
function wroteAnExpense(): boolean {
  const mock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } };
  return mock.mock.calls.some((call) => {
    const [url, init] = call as [string, RequestInit | undefined];
    return typeof url === "string" && url.includes("/expenses") && init?.method === "POST";
  });
}

describe("清償債務", () => {
  test("asks before it writes - one tap on the home card is not consent", async () => {
    (await landOnDebt()).click();

    const confirm = await screen.findByRole("dialog", { name: app.settleConfirmTitle });
    expect(confirm).toBeTruthy();
    // Nothing has hit the ledger yet.
    expect(wroteAnExpense()).toBe(false);
  });

  test("names both people and the amount, because 清償 means 'I have been paid'", async () => {
    (await landOnDebt()).click();

    const confirm = await screen.findByRole("dialog", { name: app.settleConfirmTitle });
    const body = within(confirm).getByText(/Bob/);
    expect(body.textContent).toContain("Alice");
    expect(body.textContent).toContain("43.55");
    // The placeholders were filled in, not printed.
    expect(body.textContent).not.toContain("{from}");
    expect(body.textContent).not.toContain("{amount}");
  });

  test("backing out leaves the ledger alone", async () => {
    (await landOnDebt()).click();

    const confirm = await screen.findByRole("dialog", { name: app.settleConfirmTitle });
    within(confirm).getByRole("button", { name: app.settleConfirmCancel }).click();

    await waitFor(() => expect(screen.queryByRole("dialog", { name: app.settleConfirmTitle })).toBeNull());
    expect(wroteAnExpense()).toBe(false);
  });

  test("confirming writes the settlement", async () => {
    (await landOnDebt()).click();

    const confirm = await screen.findByRole("dialog", { name: app.settleConfirmTitle });
    within(confirm).getByRole("button", { name: app.settleConfirmAction }).click();

    await waitFor(() => expect(wroteAnExpense()).toBe(true));
    // And the question goes away rather than sitting there over the result.
    await waitFor(() => expect(screen.queryByRole("dialog", { name: app.settleConfirmTitle })).toBeNull());
  });
});
