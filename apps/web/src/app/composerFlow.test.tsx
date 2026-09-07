// @vitest-environment jsdom
import { configure, cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { fakeApi, group, groupDetail, renderApp, signIn, stubBrowser } from "./appTestHarness";
import { insideAtRule, readAppStylesheet, ruleFor } from "./cssDeclarations";
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

/**
 * 日期, drawn by the app rather than read off the native control.
 *
 * iOS Safari centres a datetime-local's value in its box and honours neither
 * `text-align` on the input nor on ::-webkit-date-and-time-value — both were
 * shipped, and the date stayed floating in the middle of a full-width field
 * while every other field started at the padding edge. So on a touch device the
 * text you read is ours; the input keeps the value, the label and the picker.
 */
describe("the 日期 field", () => {
  const composerCss = readAppStylesheet("app-composer.css");

  async function dateField() {
    await landAsBob();
    const composer = await openComposer();
    await toDetailsStep(composer);
    const input = within(composer).getByLabelText(app.date);
    const shell = input.closest(".composer-date-shell");
    if (!shell) throw new Error("the date input is not inside its shell");
    return { composer, input: input as HTMLInputElement, shell };
  }

  test("shows the value as our own text, beside the input rather than instead of it", async () => {
    const { input, shell } = await dateField();

    expect(shell.querySelector(".composer-date-display")?.textContent).toBeTruthy();
    // The input is still the field: it holds the value and answers to the label.
    expect(input.value).toBeTruthy();
    expect(input.type).toBe("datetime-local");
  });

  test("that text follows the value, so picking a date is not a no-op on screen", async () => {
    const { input, shell } = await dateField();
    const display = () => shell.querySelector(".composer-date-display")?.textContent;
    const before = display();

    fireEvent.change(input, { target: { value: "2027-01-03T21:05" } });

    await waitFor(() => expect(display()).not.toBe(before));
    expect(display()).toContain("2027");
    expect(display()).toContain("21:05");
  });

  test("is announced once - the input carries the label, the text is decoration", async () => {
    const { shell } = await dateField();
    expect(shell.querySelector(".composer-date-display")?.getAttribute("aria-hidden")).toBe("true");
  });

  test("keeps something on screen saying it can be tapped", async () => {
    // Hiding the native control also hid the calendar glyph a desktop browser
    // draws for free, and iOS never drew one.
    const { shell } = await dateField();
    expect(shell.querySelector(".composer-date-display svg")).toBeTruthy();
  });

  test("hides the native control outright rather than restyling its text", () => {
    // Three attempts: text-align on the input, text-align on
    // ::-webkit-date-and-time-value, then color: transparent. All shipped, all
    // ignored by iOS. Opacity composites the element and asks nothing of
    // whatever is drawn inside it.
    expect(ruleFor(composerCss, ".composer-date-shell input").opacity).toBe("0");
  });

  test("unconditionally - a media query is one more thing that can be the reason", () => {
    // The colour attempt lived inside (pointer: coarse), and the query was as
    // plausible a suspect as the property.
    expect(insideAtRule(composerCss, "pointer: coarse")).toBe("");
  });

  test("so the field's box moves to the shell, and only one element draws it", () => {
    const shell = ruleFor(composerCss, ".composer-date-shell");
    expect(shell.border).toBeTruthy();
    expect(shell.background).toBeTruthy();
    // A second (even transparent) border here made this field 2px taller than
    // the 分類 select beside it.
    expect(ruleFor(composerCss, ".composer-date-shell input").border).toBe("0");
  });

  test("and neither span is typeset as a field caption", () => {
    // `label span` in app-base is the caption rule - 13px, muted, 8px below it.
    // Both of these live inside a <label> and are the field, not its caption:
    // the overlay came out at caption size, and that caption margin is why it
    // measured 8px shorter than the box it is supposed to fill.
    for (const selector of [".composer-date-shell", ".composer-date-display"]) {
      const rule = ruleFor(composerCss, selector);
      expect(rule.margin).toBe("0");
      expect(rule["font-size"]).toBe("inherit");
    }
  });

  test("lets every tap through to the input underneath", () => {
    const display = ruleFor(composerCss, ".composer-date-display");
    expect(display.position).toBe("absolute");
    expect(display.inset).toBe("0");
    expect(display["pointer-events"]).toBe("none");
  });

  test("starts where the other fields' text starts", () => {
    // Same horizontal padding as the input it sits on top of; if that ever
    // drifts, our text and the native caret stop lining up.
    const inputPadding = ruleFor(readAppStylesheet("app-base.css"), "input").padding ?? "";
    const inset = inputPadding.split(/\s+/)[1];
    expect(inset).toBeTruthy();
    expect(ruleFor(composerCss, ".composer-date-display").padding).toBe(`0 ${inset}`);
  });

  test("and gives the real control back to a keyboard, which needs to watch itself type", () => {
    expect(ruleFor(composerCss, ".composer-date-shell input:focus").opacity).toBe("1");
    expect(ruleFor(composerCss, ".composer-date-shell input:focus ~ .composer-date-display").opacity).toBe("0");
  });
});
