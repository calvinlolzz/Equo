import { describe, expect, test } from "vitest";
import { getExpenseRecordRows } from "./expenseRecords";
import type { ExpenseSummary } from "./apiClient";

const expenses: ExpenseSummary[] = [
  {
    id: "expense_1",
    group_id: "group_1",
    title: "Dinner",
    kind: "expense",
    category: "food",
    amount_minor: 88000,
    currency: "TWD",
    expense_date: "2026-07-01",
    created_at: "2026-07-01T14:46:38",
    version: 2,
    client_request_id: "req_1",
  },
];

describe("getExpenseRecordRows", () => {
  test("formats expenses into Pizo-style record rows", () => {
    expect(getExpenseRecordRows(expenses)).toEqual([
      {
        id: "expense_1",
        title: "Dinner",
        categoryLabel: "餐飲",
        dateLabel: "7/1",
        timeLabel: "下午2:46:38",
        amountMinor: 88000,
        metaLabel: "expense 版本 v2",
        detailLabel: "7/1 Dinner TWD",
      },
    ]);
  });

  test("falls back safely when category, date, and time are missing", () => {
    expect(
      getExpenseRecordRows([
        {
          ...expenses[0],
          category: undefined,
          expense_date: undefined,
          created_at: undefined,
        },
      ]),
    ).toMatchObject([{ categoryLabel: "一般", dateLabel: "--", timeLabel: "" }]);
  });
});
