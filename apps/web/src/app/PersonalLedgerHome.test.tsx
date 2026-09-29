// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { PersonalLedgerHome, type PersonalLedgerHomeProps } from "./PersonalLedgerHome";
import { currentMonthKey } from "./personalLedger";
import type { Expense, Group } from "./appTypes";
import { UI_TEXT } from "./uiText";

const ledgerText = UI_TEXT.personalLedger;

const group: Group = { id: "ledger_1", name: "我的帳本", currency: "TWD", kind: "personal" };

function ownExpense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "exp_1",
    title: "早餐",
    amountMinor: 8500,
    currency: "TWD",
    createdAt: `${currentMonthKey()}-05T03:00:00.000Z`,
    expenseDate: `${currentMonthKey()}-05`,
    payerId: "member_self",
    shareMemberIds: ["member_self"],
    kind: "expense",
    category: "food",
    ...overrides,
  };
}

function renderHome(overrides: Partial<PersonalLedgerHomeProps> = {}) {
  const props: PersonalLedgerHomeProps = {
    isMobileLayout: false,
    group,
    displayName: ledgerText.name,
    install: { state: "unavailable", promptInstall: vi.fn(), dismiss: vi.fn() } as unknown as PersonalLedgerHomeProps["install"],
    showSkeleton: false,
    hasLoadedDetail: true,
    expenses: [ownExpense()],
    expenseCount: 1,
    monthlyBudgetMinor: null,
    coverage: "complete",
    onOpenDialog: vi.fn(),
    onScanReceipt: vi.fn(),
    onOpenExpenseComposer: vi.fn(),
    onOpenExpenseDetail: vi.fn(),
    onCreateGroup: vi.fn(),
    onJoinGroup: vi.fn(),
    ...overrides,
  };
  render(<PersonalLedgerHome {...props} />);
  return props;
}

afterEach(cleanup);

describe("PersonalLedgerHome stands on its own", () => {
  // [MV]
  test("headline, income and net count only own entries", () => {
    renderHome({
      expenses: [ownExpense({ amountMinor: 8500 }), ownExpense({ id: "exp_2", kind: "income", amountMinor: 20000 })],
    });

    const card = document.querySelector(".ledger-month-card")!;
    expect(card.querySelector(".home-balance-amount")?.textContent).toBe("$85");
    expect(card.querySelector(".amount-income")?.textContent).toBe("$200");
    expect(card.querySelector(".ledger-month-stats")?.textContent).toContain("+$115");
  });

  // [MV]
  test("never renders a group-shares element", () => {
    renderHome();

    expect(document.body.textContent).not.toMatch(/群組分攤|Group shares/);
    expect(document.querySelector("#ledger-group-shares, .ledger-share-row, .ledger-month-split")).toBeNull();
  });

  // [MV]
  test("budget bar measures own spend only", () => {
    renderHome({ expenses: [ownExpense({ amountMinor: 8500 })], monthlyBudgetMinor: 10000 });

    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("85");
  });

  // [MV]
  test("an own-empty ledger shows the empty state as soon as detail has loaded", () => {
    renderHome({ expenses: [], hasLoadedDetail: true });

    expect(screen.getByText(ledgerText.emptyTitle)).toBeTruthy();
  });

  test("the region is labelled 帳本首頁", () => {
    renderHome();

    expect(screen.getByRole("region", { name: ledgerText.homeLabel })).toBeTruthy();
  });

  // [MV]
  test("最近記錄 shows only the latest 3, inline, with 查看全部 opening the full list", () => {
    const props = renderHome({
      expenses: Array.from({ length: 5 }, (_, i) => ownExpense({ id: `exp_${i}`, title: `品項 ${i}` })),
      expenseCount: 5,
    });

    expect(document.querySelectorAll(".expense-record-row")).toHaveLength(3);

    screen.getByText(UI_TEXT.app.viewAll).click();
    expect(props.onOpenDialog).toHaveBeenCalledWith("recordsPanel");
  });

  // [MV]
  test("only rows recorded from LINE carry the LINE badge", () => {
    renderHome({
      expenses: [ownExpense({ id: "exp_line", title: "午餐", source: "line" }), ownExpense({ id: "exp_app", title: "早餐" })],
      expenseCount: 2,
    });

    const rows = Array.from(document.querySelectorAll(".expense-record-row"));
    expect(rows).toHaveLength(2);
    const badged = rows.filter((row) => row.querySelector(".record-line-badge"));
    expect(badged).toHaveLength(1);
    expect(badged[0].textContent).toContain("午餐");
    expect(badged[0].querySelector(".record-line-badge")?.textContent).toBe(UI_TEXT.lineLink.recordBadge);
  });
});
