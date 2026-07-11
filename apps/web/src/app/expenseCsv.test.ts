import { describe, expect, test } from "vitest";
import type { ExpenseSummary } from "./apiClient";
import { buildExpenseCsv, csvFileName } from "./expenseCsv";

const names: Record<string, string> = {
  member_a: "小明",
  member_b: "小華",
};

const memberName = (id: string | null | undefined) => (id ? (names[id] ?? "") : "");

function makeExpense(overrides: Partial<ExpenseSummary>): ExpenseSummary {
  return {
    id: "expense_1",
    group_id: "group_1",
    title: "晚餐",
    kind: "expense",
    category: "food",
    amount_minor: 120050,
    currency: "TWD",
    expense_date: "2026-07-10",
    version: 1,
    client_request_id: "req_1",
    expense_payments: [{ payer_member_id: "member_a", amount_minor: 120050, currency: "TWD" }],
    expense_shares: [
      { member_id: "member_a", share_type: "equal", amount_minor: 60025 },
      { member_id: "member_b", share_type: "equal", amount_minor: 60025 },
    ],
    ...overrides,
  };
}

describe("buildExpenseCsv", () => {
  test("emits BOM, header, and one row per expense with resolved names", () => {
    const csv = buildExpenseCsv([makeExpense({})], memberName);

    expect(csv.startsWith("﻿")).toBe(true);
    const lines = csv.slice(1).trimEnd().split("\r\n");
    expect(lines[0]).toBe("日期,標題,類型,分類,金額,幣別,付款人,分攤對象,備註");
    expect(lines[1]).toBe("2026-07-10,晚餐,支出,food,1200.5,TWD,小明,小明、小華,");
  });

  test("transfer rows show the recipient and no category", () => {
    const csv = buildExpenseCsv(
      [
        makeExpense({
          kind: "transfer",
          title: "清償轉帳",
          category: "other",
          amount_minor: 50000,
          transfer_to_member_id: "member_b",
          expense_shares: [],
        }),
      ],
      memberName,
    );

    const row = csv.slice(1).trimEnd().split("\r\n")[1];
    expect(row).toBe("2026-07-10,清償轉帳,清償,,500,TWD,小明,小華,");
  });

  test("escapes fields containing commas, quotes, and newlines", () => {
    const csv = buildExpenseCsv(
      [makeExpense({ title: 'a,"b"', note: "line1\nline2" })],
      memberName,
    );

    const body = csv.slice(1);
    expect(body).toContain('"a,""b"""');
    expect(body).toContain('"line1\nline2"');
  });

  test("falls back to the created_at date when expense_date is absent", () => {
    const csv = buildExpenseCsv(
      [makeExpense({ expense_date: undefined, created_at: "2026-07-09T15:30:00.000Z" })],
      memberName,
    );

    expect(csv).toContain("2026-07-09,晚餐");
  });
});

describe("csvFileName", () => {
  test("sanitizes unsafe filename characters", () => {
    expect(csvFileName('日本行 2026/07: "旅費"', "2026-07-11")).toBe("日本行_2026_07_旅費-帳目-2026-07-11.csv");
  });

  test("falls back when the name is all unsafe characters", () => {
    expect(csvFileName("///", "2026-07-11")).toBe("equo-帳目-2026-07-11.csv");
  });
});
