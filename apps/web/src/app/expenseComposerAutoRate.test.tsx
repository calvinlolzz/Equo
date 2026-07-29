// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { Expense, Member } from "./appTypes";
import { ExpenseComposerSheet } from "./ExpenseComposerSheet";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

const members: Member[] = [
  { id: "member_a", name: "Alice" },
  { id: "member_b", name: "Bob" },
];

const currencyOptions = [
  { code: "TWD", label: "台幣" },
  { code: "JPY", label: "日圓" },
  { code: "KRW", label: "韓元" },
];

/** 1 TWD = 4.7 JPY = 42.5 KRW, i.e. 1 JPY ≈ 0.212766 TWD. */
const rates = { TWD: 1, JPY: 4.7, KRW: 42.5 };

function renderSheet(props: Partial<Parameters<typeof ExpenseComposerSheet>[0]> = {}) {
  const onSubmit = vi.fn();
  const onDirtyChange = vi.fn();
  const fetchExchangeRates = vi.fn(async (base: string) => ({
    base,
    date: "2026-07-30",
    rates,
    stale: false,
  }));

  const view = render(
    <ExpenseComposerSheet
      members={members}
      groupId="group_1"
      groupCurrency="TWD"
      currencyOptions={currencyOptions}
      onClose={() => {}}
      onDirtyChange={onDirtyChange}
      onSubmit={onSubmit}
      fetchExchangeRates={fetchExchangeRates}
      {...props}
    />,
  );

  return { view, onSubmit, onDirtyChange, fetchExchangeRates };
}

function rateInput(): HTMLInputElement {
  return screen.getByLabelText(text.exchangeRateLabel) as HTMLInputElement;
}

function pickCurrency(code: string) {
  fireEvent.change(screen.getByLabelText(text.currency), { target: { value: code } });
}

beforeEach(() => {
  window.localStorage.clear();
  // The sheet's phone/desktop split reads matchMedia at mount.
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
  vi.restoreAllMocks();
});

describe("the composer's exchange rate", () => {
  test("is filled in from today's rates when a foreign currency is picked", async () => {
    renderSheet();
    pickCurrency("JPY");

    await waitFor(() => expect(rateInput().value).toBe("0.212766"));
    // The label says where the number came from, so nobody mistakes it for
    // something they typed last time.
    expect(screen.getByText(`${text.exchangeRateAuto} 07-30`)).toBeTruthy();
  });

  test("re-fetches for the new pair when the currency is switched again", async () => {
    renderSheet();
    pickCurrency("JPY");
    await waitFor(() => expect(rateInput().value).toBe("0.212766"));

    pickCurrency("KRW");
    await waitFor(() => expect(rateInput().value).toBe("0.0235294"));
  });

  test("does not mark the sheet dirty — an auto-filled rate is not the user's work", async () => {
    // A remembered JPY makes the rate row live from the first render, so the
    // only thing that changes is the value the sheet fills in by itself.
    window.localStorage.setItem("equo.clean.last_currency", JSON.stringify({ group_1: "JPY" }));
    const { onDirtyChange } = renderSheet();

    await waitFor(() => expect(rateInput().value).toBe("0.212766"));
    // Otherwise closing an untouched sheet would raise the discard confirm.
    expect(onDirtyChange.mock.calls.every(([dirty]) => dirty === false)).toBe(true);
  });

  test("never overwrites a rate the user typed", async () => {
    const { fetchExchangeRates } = renderSheet();
    pickCurrency("JPY");
    await waitFor(() => expect(rateInput().value).toBe("0.212766"));

    fireEvent.change(rateInput(), { target: { value: "0.25" } });
    await waitFor(() => expect(screen.queryByText(`${text.exchangeRateAuto} 07-30`)).toBeNull());

    expect(rateInput().value).toBe("0.25");
    expect(fetchExchangeRates).toHaveBeenCalledTimes(1);
  });

  test("leaves the field alone when the rates cannot be reached", async () => {
    const fetchExchangeRates = vi.fn(async () => {
      throw new Error("offline");
    });
    renderSheet({ fetchExchangeRates });

    pickCurrency("JPY");

    await waitFor(() => expect(fetchExchangeRates).toHaveBeenCalled());
    // The manual field is the fallback, and it still holds the neutral 1 the
    // sheet has always opened with.
    expect(rateInput().value).toBe("1");
  });

  test("keeps an existing expense's historical rate when editing", async () => {
    const expense: Expense = {
      id: "expense_1",
      title: "拉麵",
      amountMinor: 21000,
      currency: "TWD",
      createdAt: "2026-01-05T09:00:00.000Z",
      payerId: "member_a",
      shareMemberIds: ["member_a", "member_b"],
      kind: "expense",
      category: "food",
      sourceCurrency: "JPY",
      sourceAmountMinor: 100000,
      exchangeRate: 0.21,
    };
    const { fetchExchangeRates } = renderSheet({ initialExpense: expense });

    expect(rateInput().value).toBe("0.21");
    expect(fetchExchangeRates).not.toHaveBeenCalled();
  });

  test("a duplicate of that expense gets today's rate instead", async () => {
    const expense: Expense = {
      id: "expense_1",
      title: "拉麵",
      amountMinor: 21000,
      currency: "TWD",
      createdAt: "2026-01-05T09:00:00.000Z",
      payerId: "member_a",
      shareMemberIds: ["member_a", "member_b"],
      kind: "expense",
      category: "food",
      sourceCurrency: "JPY",
      sourceAmountMinor: 100000,
      exchangeRate: 0.21,
    };
    renderSheet({ initialExpense: expense, duplicating: true });

    await waitFor(() => expect(rateInput().value).toBe("0.212766"));
  });
});

describe("the remembered currency", () => {
  test("a new expense opens in the currency this group's last one used", async () => {
    const { onSubmit } = renderSheet();
    pickCurrency("JPY");
    fireEvent.change(screen.getByLabelText(text.amount), { target: { value: "1000" } });
    await waitFor(() => expect(rateInput().value).toBe("0.212766"));

    fireEvent.click(screen.getByRole("button", { name: UI_TEXT.composerSubmit.addExpense }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());

    cleanup();
    renderSheet();

    expect((screen.getByLabelText(text.currency) as HTMLSelectElement).value).toBe("JPY");
  });

  test("editing an old expense does not rewrite the default for new ones", async () => {
    const expense: Expense = {
      id: "expense_1",
      title: "拉麵",
      amountMinor: 21000,
      currency: "TWD",
      createdAt: "2026-01-05T09:00:00.000Z",
      payerId: "member_a",
      shareMemberIds: ["member_a", "member_b"],
      kind: "expense",
      category: "food",
      sourceCurrency: "KRW",
      sourceAmountMinor: 100000,
      exchangeRate: 0.024,
    };
    const { onSubmit } = renderSheet({ initialExpense: expense });

    fireEvent.click(screen.getByRole("button", { name: UI_TEXT.app.saveChanges }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());

    cleanup();
    renderSheet();

    expect((screen.getByLabelText(text.currency) as HTMLSelectElement).value).toBe("TWD");
  });

  test("the memory is per group, not global", async () => {
    const { onSubmit } = renderSheet();
    pickCurrency("JPY");
    fireEvent.change(screen.getByLabelText(text.amount), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: UI_TEXT.composerSubmit.addExpense }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());

    cleanup();
    renderSheet({ groupId: "group_2" });

    expect((screen.getByLabelText(text.currency) as HTMLSelectElement).value).toBe("TWD");
  });

  test("opening on a remembered currency is not itself unsaved work", async () => {
    const { onSubmit } = renderSheet();
    pickCurrency("JPY");
    fireEvent.change(screen.getByLabelText(text.amount), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: UI_TEXT.composerSubmit.addExpense }));
    await waitFor(() => expect(onSubmit).toHaveBeenCalled());

    cleanup();
    const { onDirtyChange } = renderSheet();
    await waitFor(() => expect(rateInput().value).toBe("0.212766"));

    expect(onDirtyChange.mock.calls.every(([dirty]) => dirty === false)).toBe(true);
  });
});
