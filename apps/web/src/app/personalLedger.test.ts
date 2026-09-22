import { describe, expect, test } from "vitest";
import type { Expense } from "./appTypes";
import {
  currentMonthKey,
  groupDisplayName,
  isPersonalGroup,
  ledgerMonthCoverage,
  ledgerMonthKey,
  orderGroupsForRail,
  summarizeLedgerMonth,
} from "./personalLedger";
import { UI_TEXT } from "./uiText";

function expense(overrides: Partial<Expense> = {}): Expense {
  return {
    id: "exp_1",
    title: "咖啡",
    amountMinor: 10000,
    currency: "TWD",
    createdAt: "2026-09-10T03:00:00.000Z",
    expenseDate: "2026-09-10",
    payerId: "member_1",
    shareMemberIds: ["member_1"],
    kind: "expense",
    category: "food",
    ...overrides,
  };
}

describe("isPersonalGroup", () => {
  test("true only for kind personal", () => {
    expect(isPersonalGroup({ kind: "personal" })).toBe(true);
    expect(isPersonalGroup({ kind: "shared" })).toBe(false);
    expect(isPersonalGroup({})).toBe(false);
    expect(isPersonalGroup(null)).toBe(false);
    expect(isPersonalGroup(undefined)).toBe(false);
  });
});

describe("groupDisplayName", () => {
  test("shows the translated label for a personal ledger, the stored name otherwise", () => {
    expect(groupDisplayName({ kind: "personal", name: "我的帳本（somebody@example.com）" })).toBe(
      UI_TEXT.personalLedger.name,
    );
    expect(groupDisplayName({ kind: "shared", name: "東京旅行" })).toBe("東京旅行");
    expect(groupDisplayName({ name: "東京旅行" })).toBe("東京旅行");
  });
});

describe("orderGroupsForRail", () => {
  test("pulls the personal ledger to the front, keeps the rest in server order", () => {
    const groups = [
      { id: "g_shared_1", kind: "shared" as const },
      { id: "g_ledger", kind: "personal" as const },
      { id: "g_shared_2", kind: "shared" as const },
    ];
    expect(orderGroupsForRail(groups).map((g) => g.id)).toEqual(["g_ledger", "g_shared_1", "g_shared_2"]);
  });

  test("no personal ledger: order is unchanged", () => {
    const groups = [{ id: "g_1", kind: "shared" as const }, { id: "g_2", kind: "shared" as const }];
    expect(orderGroupsForRail(groups).map((g) => g.id)).toEqual(["g_1", "g_2"]);
  });
});

describe("currentMonthKey", () => {
  test("local YYYY-MM, zero-padded", () => {
    expect(currentMonthKey(new Date(2026, 0, 15))).toBe("2026-01");
    expect(currentMonthKey(new Date(2026, 10, 3))).toBe("2026-11");
  });
});

describe("ledgerMonthKey", () => {
  test("prefers expenseDate", () => {
    expect(ledgerMonthKey({ expenseDate: "2026-03-05", createdAt: "2026-04-01T00:00:00.000Z" })).toBe("2026-03");
  });

  test("falls back to the local month of createdAt when expenseDate is absent (optimistic rows)", () => {
    expect(ledgerMonthKey({ createdAt: new Date(2026, 8, 20).toISOString() })).toBe("2026-09");
  });
});

describe("summarizeLedgerMonth", () => {
  test("splits expense and income, nets them, and buckets expenses by category", () => {
    const expenses = [
      expense({ id: "e1", kind: "expense", category: "food", amountMinor: 10000 }),
      expense({ id: "e2", kind: "expense", category: "food", amountMinor: 5000 }),
      expense({ id: "e3", kind: "expense", category: "transport", amountMinor: 3000 }),
      expense({ id: "e4", kind: "income", category: "salary", amountMinor: 50000 }),
    ];

    const summary = summarizeLedgerMonth(expenses, "2026-09", "TWD");

    expect(summary).toEqual({
      expenseMinor: 18000,
      incomeMinor: 50000,
      netMinor: 32000,
      byCategory: [
        { category: "food", totalMinor: 15000 },
        { category: "transport", totalMinor: 3000 },
      ],
    });
  });

  // [MV]
  test("excludes settlements from both totals and the category breakdown", () => {
    const expenses = [
      expense({ id: "e1", kind: "expense", category: "food", amountMinor: 10000 }),
      expense({ id: "e2", kind: "settlement", category: "food", amountMinor: 99999 }),
    ];

    const summary = summarizeLedgerMonth(expenses, "2026-09", "TWD");

    expect(summary.expenseMinor).toBe(10000);
    expect(summary.incomeMinor).toBe(0);
    expect(summary.byCategory).toEqual([{ category: "food", totalMinor: 10000 }]);
  });

  // [MV]
  test("excludes rows from a different month", () => {
    const expenses = [
      expense({ id: "e1", expenseDate: "2026-09-01", amountMinor: 10000 }),
      expense({ id: "e2", expenseDate: "2026-08-31", amountMinor: 20000 }),
    ];

    const summary = summarizeLedgerMonth(expenses, "2026-09", "TWD");

    expect(summary.expenseMinor).toBe(10000);
  });

  // [MV]
  test("excludes rows in a foreign currency", () => {
    const expenses = [
      expense({ id: "e1", currency: "TWD", amountMinor: 10000 }),
      expense({ id: "e2", currency: "JPY", amountMinor: 999999 }),
    ];

    const summary = summarizeLedgerMonth(expenses, "2026-09", "TWD");

    expect(summary.expenseMinor).toBe(10000);
  });

  test("an expense with no category falls back to general", () => {
    const expenses = [expense({ id: "e1", category: undefined, amountMinor: 10000 })];
    expect(summarizeLedgerMonth(expenses, "2026-09", "TWD").byCategory).toEqual([
      { category: "general", totalMinor: 10000 },
    ]);
  });
});

describe("ledgerMonthCoverage", () => {
  test("complete when every expense has loaded", () => {
    expect(ledgerMonthCoverage([expense({ id: "e1" })], 1, "2026-09")).toBe("complete");
  });

  test("complete when the oldest loaded row is already from an earlier month", () => {
    const expenses = [
      expense({ id: "e1", expenseDate: "2026-09-05" }),
      expense({ id: "e2", expenseDate: "2026-08-20" }),
    ];
    expect(ledgerMonthCoverage(expenses, 10, "2026-09")).toBe("complete");
  });

  test("partial when there is more history and the oldest loaded row is still this month", () => {
    const expenses = [expense({ id: "e1", expenseDate: "2026-09-05" })];
    expect(ledgerMonthCoverage(expenses, 10, "2026-09")).toBe("partial");
  });
});
