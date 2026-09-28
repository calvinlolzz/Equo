// @vitest-environment jsdom
import { configure, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fakeApi, group, groupDetail, renderApp, signIn, stubBrowser } from "./appTestHarness";
import { UI_TEXT } from "./uiText";
import { readAppStylesheet, ruleFor } from "./cssDeclarations";

configure({ asyncUtilTimeout: 4_000 });
vi.setConfig({ testTimeout: 20_000 });

const app = UI_TEXT.app;

beforeEach(() => stubBrowser());

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/**
 * Alice (me) is owed $43.55; Bob owes it. Carol is square, so she is the row
 * that must NOT offer to settle.
 */
function detailWithDebt() {
  return groupDetail({
    members: [
      { id: "member_alice", group_id: "group_1", user_id: "user_alice", display_name: "Alice", role: "owner", status: "active" },
      { id: "member_bob", group_id: "group_1", user_id: "user_bob", display_name: "Bob", role: "member", status: "active" },
      { id: "member_carol", group_id: "group_1", user_id: null, display_name: "Carol", role: "member", status: "active" },
    ],
    balances: [
      { memberId: "member_alice", balance: { amount_minor: 4_355, currency: "TWD" } },
      { memberId: "member_bob", balance: { amount_minor: -4_355, currency: "TWD" } },
      { memberId: "member_carol", balance: { amount_minor: 0, currency: "TWD" } },
    ],
    expenses: [
      {
        id: "exp_1",
        group_id: "group_1",
        title: "居酒屋",
        kind: "expense",
        category: "food",
        amount_minor: 8_710,
        currency: "TWD",
        expense_date: "2026-09-01",
        note: null,
        image_urls: [],
        created_at: "2026-09-01T12:00:00.000Z",
        version: 1,
        client_request_id: "c1",
        // The API's own key names — `payers`/`shares` adapt to nothing, and an
        // expense with no share members opens an editor whose save button is
        // disabled, which is a very quiet way for a test to prove nothing.
        expense_payments: [{ payer_member_id: "member_alice", amount_minor: 8_710, currency: "TWD" }],
        expense_shares: [
          { member_id: "member_alice", share_type: "fixed", amount_minor: 4_355 },
          { member_id: "member_bob", share_type: "fixed", amount_minor: 4_355 },
        ],
      },
    ],
    expense_count: 1,
  });
}

async function landOnGroup() {
  signIn();
  fakeApi([
    { route: "GET /groups", body: { groups: [group()] } },
    { route: "GET /groups/group_1", body: detailWithDebt() },
    { route: "POST /groups/group_1/expenses", body: { expense: { id: "exp_new" } } },
    { route: "PUT /groups/group_1/expenses/exp_1", body: { expense: { id: "exp_1", title: "居酒屋", amount_minor: 9_900, currency: "TWD" } } },
  ]);
  renderApp();
  await waitFor(() => expect(window.location.pathname).toBe("/group/group_1"));
}

/** The body of the last POST to /expenses, which is how a settlement is written. */
function lastExpenseBody(): Record<string, unknown> | null {
  const mock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } };
  const posts = mock.mock.calls.filter((call) => {
    const [url, init] = call as [string, RequestInit | undefined];
    return typeof url === "string" && url.includes("/expenses") && (init?.method ?? "GET") === "POST";
  });
  const last = posts[posts.length - 1] as [string, RequestInit] | undefined;
  return last?.[1]?.body ? (JSON.parse(String(last[1].body)) as Record<string, unknown>) : null;
}

/** How many times an expense was replaced — an edit is a PUT, not a POST. */
function editCount(): number {
  const mock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } };
  return mock.mock.calls.filter((call) => {
    const [, init] = call as [string, RequestInit | undefined];
    return init?.method === "PUT";
  }).length;
}

async function openSettleConfirm() {
  await landOnGroup();
  // 清償債務 is behind Bob's member row now - collapsed by default.
  const bobName = await screen.findByText("Bob");
  fireEvent.click(bobName.closest(".member-row-head")!);
  fireEvent.click(await screen.findByRole("button", { name: app.clearDebt }));
  return screen.findByRole("dialog", { name: app.settleConfirmTitle });
}

describe("paying part of a debt", () => {
  test("the field opens on the whole amount, so agreeing is still one tap", async () => {
    const confirm = await openSettleConfirm();

    const amount = within(confirm).getByLabelText(app.settleConfirmAmountLabel) as HTMLInputElement;
    expect(amount.value).toBe("43.55");
  });

  test("a smaller number is what gets written", async () => {
    const confirm = await openSettleConfirm();

    fireEvent.change(within(confirm).getByLabelText(app.settleConfirmAmountLabel), { target: { value: "20" } });
    fireEvent.click(within(confirm).getByRole("button", { name: app.settleConfirmAction }));

    await waitFor(() => expect(lastExpenseBody()).toBeTruthy());
    // 「先給你 20」 — the case that previously meant the composer's 轉帳 mode
    // or nothing at all.
    expect(lastExpenseBody()?.amount_minor).toBe(2_000);
  });

  test("the sentence reads back what is in the field, not the suggestion", async () => {
    const confirm = await openSettleConfirm();

    fireEvent.change(within(confirm).getByLabelText(app.settleConfirmAmountLabel), { target: { value: "20" } });

    const body = within(confirm).getByText(/Bob/);
    expect(body.textContent).toContain("20");
    expect(body.textContent).not.toContain("43.55");
  });

  test("more than the balance is refused, and says why", async () => {
    const confirm = await openSettleConfirm();

    fireEvent.change(within(confirm).getByLabelText(app.settleConfirmAmountLabel), { target: { value: "100" } });

    expect((within(confirm).getByRole("button", { name: app.settleConfirmAction }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(confirm).getByRole("alert").textContent).toBe(app.settleConfirmTooMuch);
  });

  test("an empty field just disables the button — nobody is being told off mid-typing", async () => {
    const confirm = await openSettleConfirm();

    fireEvent.change(within(confirm).getByLabelText(app.settleConfirmAmountLabel), { target: { value: "" } });

    expect((within(confirm).getByRole("button", { name: app.settleConfirmAction }) as HTMLButtonElement).disabled).toBe(true);
    expect(within(confirm).queryByRole("alert")).toBeNull();
  });

  test("全額 puts it back", async () => {
    const confirm = await openSettleConfirm();

    fireEvent.change(within(confirm).getByLabelText(app.settleConfirmAmountLabel), { target: { value: "20" } });
    fireEvent.click(within(confirm).getByRole("button", { name: app.settleConfirmFull }));

    expect((within(confirm).getByLabelText(app.settleConfirmAmountLabel) as HTMLInputElement).value).toBe("43.55");
  });
});

describe("settling with one particular person", () => {
  async function openMembers() {
    await landOnGroup();
    // Phase 3: 群組成員 moved from the desktop rail into the ▾ menu beside the
    // group's name — open that first.
    fireEvent.click(await screen.findByRole("button", { name: app.groupManage }));
    fireEvent.click(await screen.findByRole("button", { name: app.members }));
    // The shared bottom sheet is labelled 群組首頁 whatever it is showing.
    // Scoped to it from here on: the home card behind it names Bob too, and
    // an unscoped query matches both.
    return screen.findByRole("dialog", { name: app.groupHome });
  }

  test("the row offers it when money can pass between the two of you", async () => {
    const sheet = await openMembers();

    expect(within(sheet).getByRole("button", { name: `${app.settleWithMember}: Bob` })).toBeTruthy();
  });

  test("but not to somebody who is square", async () => {
    const sheet = await openMembers();

    // Carol owes nothing and is owed nothing. A button here could only write a
    // settlement of zero.
    expect(within(sheet).queryByRole("button", { name: `${app.settleWithMember}: Carol` })).toBeNull();
  });

  test("nor to yourself", async () => {
    const sheet = await openMembers();

    expect(within(sheet).queryByRole("button", { name: `${app.settleWithMember}: Alice` })).toBeNull();
  });

  test("it goes through the same confirm, with the same partial payment", async () => {
    const sheet = await openMembers();

    fireEvent.click(within(sheet).getByRole("button", { name: `${app.settleWithMember}: Bob` }));

    const confirm = await screen.findByRole("dialog", { name: app.settleConfirmTitle });
    expect((within(confirm).getByLabelText(app.settleConfirmAmountLabel) as HTMLInputElement).value).toBe("43.55");

    fireEvent.change(within(confirm).getByLabelText(app.settleConfirmAmountLabel), { target: { value: "10" } });
    fireEvent.click(within(confirm).getByRole("button", { name: app.settleConfirmAction }));

    await waitFor(() => expect(lastExpenseBody()).toBeTruthy());
    expect(lastExpenseBody()?.amount_minor).toBe(1_000);
  });

  test("and the direction comes from the balances, not from who tapped", async () => {
    const sheet = await openMembers();

    fireEvent.click(within(sheet).getByRole("button", { name: `${app.settleWithMember}: Bob` }));
    const confirm = await screen.findByRole("dialog", { name: app.settleConfirmTitle });

    // Bob owes Alice, so Bob pays — even though Alice is the one holding the
    // phone and pressing the button.
    const body = within(confirm).getByText(/Bob/);
    expect(body.textContent).toMatch(/Bob[\s\S]*Alice/);
  });
});

describe("recording one thing after another", () => {
  test("a saved expense offers the next one", async () => {
    await landOnGroup();

    fireEvent.click(await screen.findByRole("button", { name: app.addExpense }));
    const amount = await screen.findByLabelText(app.amount);
    fireEvent.change(amount, { target: { value: "240" } });
    fireEvent.keyDown(amount, { key: "Enter" });

    // The toast the delete undo already used, carrying the way back in.
    expect(await screen.findByRole("button", { name: app.addAnother })).toBeTruthy();
  });

  test("and taking it reopens an empty composer", async () => {
    await landOnGroup();

    fireEvent.click(await screen.findByRole("button", { name: app.addExpense }));
    const amount = await screen.findByLabelText(app.amount);
    fireEvent.change(amount, { target: { value: "240" } });
    fireEvent.keyDown(amount, { key: "Enter" });

    fireEvent.click(await screen.findByRole("button", { name: app.addAnother }));

    // Open, and not carrying the last amount: the next thing is usually a
    // different thing. Repeating one is what 以此新增一筆 is for.
    const next = await screen.findByLabelText(app.amount);
    expect((next as HTMLInputElement).value).toBe("");
  });

  test("an edit does not offer it — there is no 'another' edit to make", async () => {
    await landOnGroup();

    // 最近記錄's rows are inline on home, not behind a tap - see GroupHome's
    // HomeRecordsSection.

    // Through the expense's own dialog. The records list has 編輯 too, but its
    // swipe actions are aria-hidden until the row is opened - deliberately, so
    // a screen reader is not offered two copies of the same two controls.
    fireEvent.click(await screen.findByRole("button", { name: /居酒屋/ }));
    fireEvent.click(await screen.findByRole("button", { name: app.editExpenseAction }));

    // Retitle rather than re-price: the fixture's shares are `fixed`, so
    // changing the total makes the custom split stop adding up and the save
    // button correctly goes dark. Editing the title leaves it valid and is
    // just as much of an edit.
    const title = await screen.findByLabelText(app.title);
    fireEvent.change(title, { target: { value: "居酒屋（二次會）" } });
    fireEvent.keyDown(title, { key: "Enter" });

    // Wait for the write itself. 「編輯支出」 as a text match would have found
    // the composer's own heading and passed without anything being saved.
    await waitFor(() => expect(editCount()).toBe(1));
    // The composer is gone, so the toast is what is on screen now...
    await waitFor(() => expect(screen.queryByLabelText(app.title)).toBeNull());
    // ...and it carries no offer of another one.
    expect(screen.queryByRole("button", { name: app.addAnother })).toBeNull();
  });

  test("nor does a settlement — that write does not go through the composer at all", async () => {
    const confirm = await openSettleConfirm();
    fireEvent.click(within(confirm).getByRole("button", { name: app.settleConfirmAction }));

    await waitFor(() => expect(lastExpenseBody()).toBeTruthy());
    expect(screen.queryByRole("button", { name: app.addAnother })).toBeNull();
  });
});

describe("a member row that grew a third action still fits", () => {
  const dialogs = readAppStylesheet("app-dialogs.css");
  const row = ruleFor(dialogs, ".member-dialog-row.has-member-actions");

  test("the row wraps rather than declaring a fixed number of columns", () => {
    // It was `grid-template-columns: 44px minmax(0,1fr) auto auto` — exactly
    // four. 清償 made a fifth child on a virtual member's row, and the fifth
    // child is the balance, which dropped to a line of its own with the name
    // crushed to 20px beside it.
    expect(row.display).toBe("flex");
    expect(row["flex-wrap"]).toBe("wrap");
    expect(row["grid-template-columns"]).toBeUndefined();
  });

  test("the name shrinks before the balance is pushed off the line", () => {
    // Measured at 390px: a basis of 84 overshot the 308px content box by four
    // pixels and wrapped the balance on EVERY row with actions. 64 keeps a
    // two-action row on one line and lets the name ellipsis do the work.
    const name = ruleFor(dialogs, ".member-dialog-row.has-member-actions > span:not(.member-avatar):not(.member-row-actions)");
    expect(name.flex).toBe("1 1 64px");
  });

  test("and the balance does not fight the name for the free space", () => {
    // A `margin-left: auto` here plus flex-grow on the name meant the name
    // took everything and the auto margin had nothing left to push with.
    const balance = ruleFor(dialogs, ".member-dialog-row.has-member-actions > b");
    expect(balance.flex).toBe("0 0 auto");
    expect(balance["margin-left"]).toBeUndefined();
  });
});
