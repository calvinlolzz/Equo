// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { AnalysisPanel } from "./AnalysisPanel";
import type { Member } from "./appTypes";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

const members: Member[] = [{ id: "me", name: "我", userId: "user_alice" }];

function renderPanel(overrides: Partial<Parameters<typeof AnalysisPanel>[0]> = {}) {
  const props = {
    totalExpenseMinor: 100_000,
    currency: "TWD",
    members,
    balances: new Map<string, number>([["me", 0]]),
    maxBalanceMinor: 1,
    debtAmountMinor: 0,
    settlementTransfers: [],
    settlementHistory: { records: [{ id: "s1", fromMemberId: "me", toMemberId: "me", amountMinor: 100, currency: "TWD", createdAt: "2026-09-01T00:00:00.000Z" }], loading: false, matchCount: 1, degraded: false },
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

describe("AnalysisPanel in a personal ledger", () => {
  test("hides the 個人／群組 tabs", () => {
    renderPanel({ personal: true });
    expect(screen.queryByRole("tablist", { name: text.analysis })).toBeNull();
  });

  test("keeps the total-spend tile but drops members and debt", () => {
    renderPanel({ personal: true });
    expect(screen.getByText(UI_TEXT.analysis.totalAmount)).toBeTruthy();
    expect(screen.queryByText(text.members)).toBeNull();
    expect(screen.queryByText(text.debt)).toBeNull();
  });

  // [MV]
  test("hides the member balances, settlement suggestions and settlement history sections", () => {
    renderPanel({ personal: true });
    expect(screen.queryByText(UI_TEXT.analysis.memberBalances)).toBeNull();
    expect(screen.queryByText(UI_TEXT.settlement.suggestionSectionTitle)).toBeNull();
    expect(screen.queryByText(text.settlementHistoryTitle)).toBeNull();
  });

  // [MV]
  test("a shared-group render (personal omitted) still shows every section", () => {
    renderPanel();
    expect(screen.getByRole("tablist", { name: text.analysis })).toBeTruthy();
    expect(screen.getByText(text.members)).toBeTruthy();
    expect(screen.getByText(text.debt)).toBeTruthy();
    expect(screen.getByText(UI_TEXT.analysis.memberBalances)).toBeTruthy();
    expect(screen.getByText(UI_TEXT.settlement.suggestionSectionTitle)).toBeTruthy();
    expect(screen.getByText(text.settlementHistoryTitle)).toBeTruthy();
  });
});
