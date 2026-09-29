// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
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
    viewingAs: false,
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

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

const OA_URL = "https://line.me/R/ti/p/@100ujhjj";

function stubUnlinkedLine() {
  const calls: string[] = [];
  vi.stubEnv("VITE_LINE_OA_URL", OA_URL);
  vi.stubGlobal("fetch", async (url: string) => {
    calls.push(String(url));
    return { ok: true, json: async () => ({ linked: false, linked_at: null }) } as Response;
  });
  return calls;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

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

  describe("the LINE hint", () => {
    // [MV]
    test("sits after the month card and before the category donut", async () => {
      stubUnlinkedLine();
      renderHome({ expenses: [ownExpense({ amountMinor: 8500 })], monthlyBudgetMinor: 10000 });

      const hint = await screen.findByRole("complementary", { name: UI_TEXT.lineLink.hintTitle });
      const home = document.querySelector("#group-home")!;
      expect(home.contains(hint)).toBe(true);
      const card = document.querySelector(".ledger-month-card")!;
      const donut = document.querySelector(".dialog-section-list")!;
      expect(card.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(hint.compareDocumentPosition(donut) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    // [MV]
    test("in the empty state it follows the empty-state actions", async () => {
      stubUnlinkedLine();
      renderHome({ expenses: [], expenseCount: 0 });

      const hint = await screen.findByRole("complementary", { name: UI_TEXT.lineLink.hintTitle });
      const actions = document.querySelector(".home-empty-actions")!;
      expect(actions.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });

    test("an admin in view-as neither sees it nor triggers the fetch", async () => {
      const calls = stubUnlinkedLine();
      renderHome({ viewingAs: true });
      await settle();

      expect(calls).toHaveLength(0);
      expect(document.querySelector(".line-hint")).toBeNull();
    });

    test("on a phone the install hint has the floor: no card, no fetch", async () => {
      const calls = stubUnlinkedLine();
      renderHome({
        isMobileLayout: true,
        install: { state: "manual", promptInstall: vi.fn(), dismiss: vi.fn() } as unknown as PersonalLedgerHomeProps["install"],
      });
      await settle();

      expect(calls).toHaveLength(0);
      expect(document.querySelector(".line-hint")).toBeNull();
    });

    test("with no add-friend URL nothing is fetched", async () => {
      const calls: string[] = [];
      vi.stubGlobal("fetch", async (url: string) => {
        calls.push(String(url));
        return { ok: true, json: async () => ({}) } as Response;
      });
      renderHome();
      await settle();

      expect(calls).toHaveLength(0);
    });
  });
});
