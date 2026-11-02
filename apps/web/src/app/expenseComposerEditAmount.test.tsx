// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Expense, Member } from "./appTypes";
import { ExpenseComposerSheet } from "./ExpenseComposerSheet";
import { UI_TEXT } from "./uiText";

/**
 * Changing the amount of an entry that is being edited. The server always sends
 * the share amounts back, so the editor used to open every entry as a custom
 * split with today's numbers frozen: change the total and they no longer added
 * up, 儲存變更 went off, and a personal ledger (which shows no split editor)
 * gave the user no way out. Seen on a phone inside LINE.
 */
const text = UI_TEXT.app;

const PERSONAL: Member[] = [{ id: "me", name: "我" }];
const SHARED: Member[] = [
  { id: "member_a", name: "Alice" },
  { id: "member_b", name: "Bob" },
];

function expense(overrides: Partial<Expense>): Expense {
  return {
    id: "expense_1",
    title: "早餐",
    amountMinor: 10000,
    currency: "TWD",
    createdAt: "2026-11-02T01:00:00.000Z",
    payerId: "me",
    shareMemberIds: ["me"],
    shareAmountsMinor: { me: 10000 },
    kind: "expense",
    category: "food",
    ...overrides,
  };
}

function renderEdit(initialExpense: Expense, personal: boolean) {
  const onSubmit = vi.fn();
  render(
    <ExpenseComposerSheet
      members={personal ? PERSONAL : SHARED}
      currentMemberId={personal ? "me" : "member_a"}
      personal={personal}
      groupId="group_1"
      groupCurrency="TWD"
      currencyOptions={[{ code: "TWD", label: "台幣" }]}
      initialExpense={initialExpense}
      onClose={() => {}}
      onSubmit={onSubmit}
      fetchExchangeRates={async (base: string) => ({ base, date: "2026-11-02", rates: { TWD: 1 }, stale: false })}
    />,
  );
  return { onSubmit };
}

function saveButton(): HTMLButtonElement {
  return screen.getByRole("button", { name: text.saveChanges }) as HTMLButtonElement;
}

function setAmount(value: string) {
  fireEvent.change(screen.getByLabelText(text.amount), { target: { value } });
}

beforeEach(() => {
  window.localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("editing the amount in a personal ledger", () => {
  test("an expense can still be saved, and is written as one whole share", async () => {
    const { onSubmit } = renderEdit(expense({}), true);
    expect(saveButton().disabled).toBe(false);

    setAmount("120");
    expect(saveButton().disabled).toBe(false);

    fireEvent.click(saveButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const draft = onSubmit.mock.calls[0][0];
    expect(draft.amountMinor).toBe(12000);
    expect(draft.shareMemberIds).toEqual(["me"]);
    // No frozen 100 left over from the old amount.
    expect(draft.shareAmountsMinor).toBeUndefined();
  });

  test("an income can still be saved too (it reopens with its portions as amounts)", async () => {
    const income = expense({
      kind: "income",
      category: "salary",
      payments: [{ payerId: "me", amountMinor: 10000 }],
    });
    const { onSubmit } = renderEdit(income, true);

    setAmount("120");
    expect(saveButton().disabled).toBe(false);

    fireEvent.click(saveButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const draft = onSubmit.mock.calls[0][0];
    expect(draft.kind).toBe("income");
    expect(draft.amountMinor).toBe(12000);
    expect(draft.shareAmountsMinor).toBeUndefined();
  });
});

describe("editing the amount in a shared group", () => {
  test("an even split stays even: the shares follow the new amount", async () => {
    const even = expense({
      payerId: "member_a",
      shareMemberIds: ["member_a", "member_b"],
      shareAmountsMinor: { member_a: 5000, member_b: 5000 },
    });
    const { onSubmit } = renderEdit(even, false);

    setAmount("120");
    expect(saveButton().disabled).toBe(false);

    fireEvent.click(saveButton());
    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const draft = onSubmit.mock.calls[0][0];
    expect(draft.amountMinor).toBe(12000);
    expect(draft.shareAmountsMinor).toBeUndefined();
  });

  test("a custom split still has to add up to the new amount", () => {
    const custom = expense({
      payerId: "member_a",
      shareMemberIds: ["member_a", "member_b"],
      shareAmountsMinor: { member_a: 4000, member_b: 6000 },
    });
    renderEdit(custom, false);
    expect(saveButton().disabled).toBe(false);

    setAmount("120");
    expect(saveButton().disabled).toBe(true);
  });
});
