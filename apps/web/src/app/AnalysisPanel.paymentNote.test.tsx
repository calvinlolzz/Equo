// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AnalysisPanel } from "./AnalysisPanel";
import type { Member } from "./appTypes";
import { UI_TEXT } from "./uiText";

/**
 * 收款資訊 on the settlement suggestions: the app can say who owes whom, and
 * this is the line that says where the money should actually go. It is shown on
 * the row where the reader is the payer and nowhere else.
 */

const members: Member[] = [
  { id: "me", name: "Alice", userId: "user_alice" },
  { id: "bob", name: "Bob", userId: "user_bob", paymentNote: "玉山 808 末五碼 12345" },
  { id: "carol", name: "Carol", userId: "user_carol" },
];

const twd = { amount_minor: 50_000, currency: "TWD" };

function renderPanel(overrides: Partial<Parameters<typeof AnalysisPanel>[0]> = {}) {
  const props = {
    totalExpenseMinor: 100_000,
    currency: "TWD",
    members,
    balances: new Map<string, number>([["me", -50_000], ["bob", 50_000]]),
    maxBalanceMinor: 50_000,
    debtAmountMinor: 50_000,
    settlementTransfers: [{ fromMemberId: "me", toMemberId: "bob", amount: twd }],
    settlementRecords: [],
    dateChips: [],
    spendByDay: [],
    selectedDateKey: "",
    pendingAction: null,
    currentMemberId: "me",
    onSelectDate: vi.fn(),
    onCopyPaymentNote: vi.fn(),
    onSettleTransfer: vi.fn(),
    spendTab: "group" as const,
    onSelectSpendTab: vi.fn(),
    spendBreakdown: {
      breakdown: null,
      periodKind: "month" as const,
      periodKey: null,
      loading: false,
      error: null,
      selectPeriodKind: vi.fn(),
      selectPeriodKey: vi.fn(),
      retry: vi.fn(),
    },
    ...overrides,
  };
  render(<AnalysisPanel {...props} />);
  return props;
}

afterEach(cleanup);

describe("收款資訊 on the settlement suggestions", () => {
  test("shows the payee's details on the row you have to pay", () => {
    renderPanel();

    expect(screen.getByText("玉山 808 末五碼 12345")).toBeTruthy();
  });

  test("copies the note, not the name or the amount", () => {
    const props = renderPanel();

    fireEvent.click(screen.getByRole("button", { name: UI_TEXT.paymentNote.copy }));

    expect(props.onCopyPaymentNote).toHaveBeenCalledWith("玉山 808 末五碼 12345");
  });

  test("says so when the payee has not filled theirs in", () => {
    // Silence is the wrong answer here: the payer needs to know to go and ask.
    renderPanel({ settlementTransfers: [{ fromMemberId: "me", toMemberId: "carol", amount: twd }] });

    expect(screen.getByText(UI_TEXT.paymentNote.missing)).toBeTruthy();
  });

  test("does not show it on a row where somebody else is paying", () => {
    // Bob's account details are not what Alice needs while reading a transfer
    // between two other people.
    renderPanel({ settlementTransfers: [{ fromMemberId: "carol", toMemberId: "bob", amount: twd }] });

    expect(screen.queryByText("玉山 808 末五碼 12345")).toBeNull();
    expect(screen.queryByText(UI_TEXT.paymentNote.missing)).toBeNull();
  });

  test("does not show it on a row where you are the one being paid", () => {
    // You do not need your own account number read back to you. Asserting the
    // 對方還沒填 line is absent too, not just the note text: the payee here is
    // the member with no note, so checking only the note would pass even if the
    // whole block rendered.
    renderPanel({ settlementTransfers: [{ fromMemberId: "bob", toMemberId: "me", amount: twd }] });

    expect(screen.queryByText("玉山 808 末五碼 12345")).toBeNull();
    expect(screen.queryByText(UI_TEXT.paymentNote.missing)).toBeNull();
  });
});
