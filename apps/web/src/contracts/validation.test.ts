import { describe, expect, test } from "vitest";
import type { CreateExpenseRequest } from "./schemas.js";
import { validateCreateExpenseRequest } from "./validation.js";

const balancedExpense: CreateExpenseRequest = {
  client_request_id: "req_001",
  title: "??",
  kind: "expense",
  category: "food",
  amount_minor: 1200,
  currency: "TWD",
  expense_date: "2026-06-30",
  expense_payments: [
    { payer_member_id: "alice", amount_minor: 1200, currency: "TWD" },
  ],
  expense_shares: [
    { member_id: "alice", share_type: "fixed", amount_minor: 600 },
    { member_id: "bob", share_type: "fixed", amount_minor: 600 },
  ],
};

describe("validateCreateExpenseRequest", () => {
  test("rejects an expense when payments do not match amount", () => {
    const result = validateCreateExpenseRequest({
      ...balancedExpense,
      expense_payments: [
        { payer_member_id: "alice", amount_minor: 1100, currency: "TWD" },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("PAYMENT_TOTAL_MISMATCH");
  });

  test("rejects an expense when shares do not match amount", () => {
    const result = validateCreateExpenseRequest({
      ...balancedExpense,
      expense_shares: [
        { member_id: "alice", share_type: "fixed", amount_minor: 400 },
        { member_id: "bob", share_type: "fixed", amount_minor: 400 },
      ],
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toContain("EXPENSE_SHARE_TOTAL_MISMATCH");
  });

  test("accepts a balanced expense request", () => {
    const result = validateCreateExpenseRequest(balancedExpense);

    expect(result).toEqual({ ok: true, issues: [] });
  });
});
