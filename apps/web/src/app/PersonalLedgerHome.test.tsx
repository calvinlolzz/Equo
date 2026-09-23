// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { PersonalLedgerHome, type PersonalLedgerHomeProps } from "./PersonalLedgerHome";
import { currentMonthKey, type GroupShareMonth, type PersonalShares } from "./personalLedger";
import type { Expense, Group } from "./appTypes";
import { UI_TEXT } from "./uiText";
import { EN } from "./i18n/en";
import { ZH_HANT } from "./i18n/zhHant";

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

function groupShare(overrides: Partial<GroupShareMonth> = {}): GroupShareMonth {
  return {
    groupId: "group_1",
    name: "Tokyo Trip",
    currency: "TWD",
    archived: false,
    shareMinor: 3000,
    expenseCount: 1,
    byCategory: [{ category: "food", totalMinor: 3000 }],
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
    groupShares: null,
    groupSharesStatus: "loading",
    openableGroupIds: [],
    onOpenGroup: vi.fn(),
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

/** Expands the 本月群組分攤 disclosure by clicking its own toggle button. */
function openSharesDisclosure() {
  fireEvent.click(screen.getByText(ledgerText.sharesTitle).closest("button")!);
}

afterEach(cleanup);

describe("PersonalLedgerHome's group-shares fold", () => {
  test("the headline equals own + share and the split line renders", () => {
    const shares: PersonalShares = {
      month: currentMonthKey(),
      groups: [groupShare({ groupId: "group_1", currency: "TWD", shareMinor: 3000 })],
    };
    renderHome({ groupShares: shares, groupSharesStatus: "ready", openableGroupIds: ["group_1"] });

    // own 8500 + group 3000 = 11500 minor -> $115 (formatAmount divides by 100)
    expect(within(document.querySelector(".ledger-month-card")!).getByText("$115")).toBeTruthy();
    expect(
      screen.getByText(`${ledgerText.ownPart} $85 · ${ledgerText.groupPart} $30`),
    ).toBeTruthy();
  });

  test("a foreign-currency row carries 不同幣別，未計入", () => {
    const shares: PersonalShares = {
      month: currentMonthKey(),
      groups: [groupShare({ groupId: "group_jp", currency: "JPY", shareMinor: 99999 })],
    };
    renderHome({ groupShares: shares, groupSharesStatus: "ready", openableGroupIds: ["group_jp"] });

    openSharesDisclosure();

    expect(screen.getByText((_, el) => el?.textContent === `1 ${ledgerText.sharesEntryCount} · ${ledgerText.sharesOtherCurrency}`)).toBeTruthy();
    // Not summed into the headline - stays own-only.
    expect(within(document.querySelector(".ledger-month-card")!).getByText("$85")).toBeTruthy();
  });

  test("a non-openable row is not a button", () => {
    const shares: PersonalShares = {
      month: currentMonthKey(),
      groups: [groupShare({ groupId: "group_gone", name: "Old Trip", currency: "TWD", shareMinor: 3000 })],
    };
    renderHome({ groupShares: shares, groupSharesStatus: "ready", openableGroupIds: [] });

    openSharesDisclosure();

    const row = screen.getByText("Old Trip").closest(".ledger-share-row");
    expect(row?.tagName).toBe("DIV");
  });

  // [MV]
  test("tapping an openable row calls onOpenGroup", () => {
    const shares: PersonalShares = {
      month: currentMonthKey(),
      groups: [groupShare({ groupId: "group_open", name: "Open Trip", currency: "TWD", shareMinor: 3000 })],
    };
    const onOpenGroup = vi.fn();
    renderHome({ groupShares: shares, groupSharesStatus: "ready", openableGroupIds: ["group_open"], onOpenGroup });

    openSharesDisclosure();
    const row = screen.getByText("Open Trip").closest(".ledger-share-row")!;
    expect(row.tagName).toBe("BUTTON");
    fireEvent.click(row);

    expect(onOpenGroup).toHaveBeenCalledWith("group_open");
  });

  // [MV]
  test("the empty state is suppressed when shares exist and there are no own rows", () => {
    const shares: PersonalShares = {
      month: currentMonthKey(),
      groups: [groupShare({ groupId: "group_1", currency: "TWD", shareMinor: 3000 })],
    };
    renderHome({ expenses: [], groupShares: shares, groupSharesStatus: "ready", openableGroupIds: ["group_1"] });

    expect(screen.queryByText(ledgerText.emptyTitle)).toBeNull();
    expect(screen.getByText(ledgerText.sharesTitle)).toBeTruthy();
  });

  test("unavailable shows sharesUnavailable", () => {
    renderHome({ groupShares: null, groupSharesStatus: "unavailable" });

    expect(screen.getByText(ledgerText.sharesUnavailable)).toBeTruthy();
  });

  test("loading shows sharesLoading", () => {
    renderHome({ groupShares: null, groupSharesStatus: "loading" });

    expect(screen.getByText(ledgerText.sharesLoading)).toBeTruthy();
  });

  // [MV: drop the uncountedGroups branch from the summary composition]
  test("a TWD ledger with only a JPY share: the disclosure summary shows no $0 and mentions the other currency", () => {
    const shares: PersonalShares = {
      month: currentMonthKey(),
      groups: [groupShare({ groupId: "group_jp", currency: "JPY", shareMinor: 99999 })],
    };
    renderHome({ groupShares: shares, groupSharesStatus: "ready", openableGroupIds: ["group_jp"] });

    const summary = document.querySelector(".home-disclosure-summary")?.textContent ?? "";
    expect(summary).not.toContain("$0");
    expect(summary).toContain(ledgerText.sharesOtherCurrencyCountPrefix.trim());
    expect(summary).toContain("1");
  });

  // [MV: drop the groupSharesStatus !== "loading" guard from `empty`]
  test("while groupSharesStatus is still loading and there are no own rows, the card renders instead of the empty state", () => {
    renderHome({ expenses: [], groupShares: null, groupSharesStatus: "loading" });

    expect(screen.queryByText(ledgerText.emptyTitle)).toBeNull();
    expect(document.querySelector(".ledger-month-card")).toBeTruthy();
    expect(screen.getByText(ledgerText.sharesLoading)).toBeTruthy();
  });

  test("the empty state still shows once shares are ready with nothing, or unavailable", () => {
    renderHome({ expenses: [], groupShares: null, groupSharesStatus: "unavailable" });
    expect(screen.getByText(ledgerText.emptyTitle)).toBeTruthy();

    cleanup();
    const readyEmpty: PersonalShares = { month: currentMonthKey(), groups: [] };
    renderHome({ expenses: [], groupShares: readyEmpty, groupSharesStatus: "ready" });
    expect(screen.getByText(ledgerText.emptyTitle)).toBeTruthy();
  });

  test("EN has distinct singular forms for the shares counts; ZH's singular equals its plural (no such distinction in Chinese)", () => {
    expect(EN.personalLedger.sharesGroupCountOne).toBe("group");
    expect(EN.personalLedger.sharesGroupCount).toBe("groups");
    expect(EN.personalLedger.sharesEntryCountOne).toBe("entry");
    expect(EN.personalLedger.sharesEntryCount).toBe("entries");
    expect(ZH_HANT.personalLedger.sharesGroupCountOne).toBe(ZH_HANT.personalLedger.sharesGroupCount);
    expect(ZH_HANT.personalLedger.sharesEntryCountOne).toBe(ZH_HANT.personalLedger.sharesEntryCount);
  });
});
