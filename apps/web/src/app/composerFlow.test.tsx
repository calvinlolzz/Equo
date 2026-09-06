// @vitest-environment jsdom
import { configure, cleanup, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fakeApi, group, groupDetail, renderApp, signIn, stubBrowser } from "./appTestHarness";
import { UI_TEXT } from "./uiText";

// Lazy chunks again - see the note in App.scan.test.tsx.
configure({ asyncUtilTimeout: 4_000 });
vi.setConfig({ testTimeout: 15_000 });

const app = UI_TEXT.app;
const split = UI_TEXT.splitSummary;

beforeEach(() => stubBrowser({ mobile: true }));

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * A group whose creator is NOT the person holding the phone.
 *
 * This is the shape the payer default used to get wrong: members[0] is Alice,
 * who made the group, and the session belongs to Bob.
 */
function twoMemberDetail() {
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
      { memberId: "member_alice", balance: { amount_minor: 0, currency: "TWD" } },
      { memberId: "member_bob", balance: { amount_minor: 0, currency: "TWD" } },
    ],
  });
}

async function landAsBob() {
  signIn({ id: "user_bob", displayName: "Bob" });
  fakeApi([
    { route: "GET /groups", body: { groups: [group()] } },
    { route: "GET /groups/group_1", body: twoMemberDetail() },
  ]);
  renderApp();
  await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));
}

async function openComposer() {
  screen.getByRole("button", { name: app.addExpense }).click();
  return screen.findByRole("dialog", { name: app.addExpense });
}

/**
 * Taps the amount keypad and waits for the number to land.
 *
 * The await matters: 下一步 is disabled until the amount is above zero, and a
 * click on a disabled button is silently nothing.
 */
async function tapKeypad(composer: HTMLElement, digits: string) {
  for (const digit of digits) within(composer).getByRole("button", { name: digit }).click();
  await waitFor(() => expect(within(composer).getByText(new RegExp(digits))).toBeTruthy());
}

/** Amount, then 下一步 - leaves the sheet on the 明細 step. */
async function toDetailsStep(composer: HTMLElement) {
  await tapKeypad(composer, "600");
  within(composer).getByRole("button", { name: app.stepNext }).click();
  await waitFor(() => expect(within(composer).getByText(`${app.stepWord} 2/2`)).toBeTruthy());
}

describe("the phone add-expense flow", () => {
  test("is two steps, not four - the last one saves", async () => {
    await landAsBob();
    const composer = await openComposer();

    expect(within(composer).getByText(`${app.stepWord} 1/2`)).toBeTruthy();

    await toDetailsStep(composer);

    // Step 2 is the end of the road: it offers a save, not another 下一步.
    expect(within(composer).queryByRole("button", { name: app.stepNext })).toBeNull();
    expect(within(composer).getByRole("button", { name: UI_TEXT.composerSubmit.addExpense })).toBeTruthy();
  });

  test("defaults the payer to whoever is recording it, not the group's creator", async () => {
    await landAsBob();
    const composer = await openComposer();

    await toDetailsStep(composer);

    // The summary that replaced the 付款人 step names Bob - the session - even
    // though Alice is members[0] and owns the group.
    await waitFor(() =>
      expect(within(composer).getByText(split.paidBy.replace("{name}", "Bob"), { exact: false })).toBeTruthy(),
    );
    expect(within(composer).queryByText(split.paidBy.replace("{name}", "Alice"), { exact: false })).toBeNull();
  });

  test("the summary says how it splits, so the deleted step's answer is still on screen", async () => {
    await landAsBob();
    const composer = await openComposer();

    await toDetailsStep(composer);

    await waitFor(() =>
      expect(
        within(composer).getByText(
          `${split.paidBy.replace("{name}", "Bob")} · ${split.equal.replace("{n}", "2")}`,
        ),
      ).toBeTruthy(),
    );
  });

  test("the payer and split editors are one tap away, behind the summary", async () => {
    await landAsBob();
    const composer = await openComposer();

    await toDetailsStep(composer);

    const opener = await within(composer).findByRole("button", { name: split.edit });
    // Collapsed to begin with: the whole point is that nobody has to look.
    expect(opener.getAttribute("aria-expanded")).toBe("false");
    expect(within(composer).queryByText(app.whoPays)).toBeNull();

    opener.click();

    await waitFor(() => expect(opener.getAttribute("aria-expanded")).toBe("true"));
    // Both deleted steps' contents, now on this one.
    expect(within(composer).getByText(app.whoPays)).toBeTruthy();
    expect(within(composer).getByText(app.payer)).toBeTruthy();
    expect(within(composer).getByRole("button", { name: app.splitByPercent })).toBeTruthy();
  });

  test("a saved entry carries the recorder as payer, all the way to the request", async () => {
    await landAsBob();
    const composer = await openComposer();

    await toDetailsStep(composer);

    const save = await within(composer).findByRole("button", { name: UI_TEXT.composerSubmit.addExpense });
    save.click();

    await waitFor(() => expect(fetchedExpenseBody()).not.toBeNull());
    const body = fetchedExpenseBody() as {
      expense_payments: Array<{ payer_member_id: string; amount_minor: number }>;
      expense_shares: Array<{ member_id: string }>;
    };
    // One payer, and it is Bob - not Alice, who created the group.
    expect(body.expense_payments.map((payment) => payment.payer_member_id)).toEqual(["member_bob"]);
    expect(body.expense_payments[0].amount_minor).toBe(60_000);
    // The split step's default survives its deletion: everybody, evenly.
    expect(body.expense_shares.map((share) => share.member_id)).toEqual(["member_alice", "member_bob"]);
  });
});

/** The body of the POST that created an expense, if one has been sent. */
function fetchedExpenseBody(): unknown {
  const mock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } };
  for (const call of mock.mock.calls) {
    const [url, init] = call as [string, RequestInit | undefined];
    if (typeof url === "string" && url.includes("/expenses") && init?.method === "POST") {
      return JSON.parse(String(init.body));
    }
  }
  return null;
}
