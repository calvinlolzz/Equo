import { describe, expect, test } from "vitest";
import { validateCreateExpenseRequest } from "../contracts/validation";
import type { GroupDetail } from "./apiClient";
import {
  toCreateExpenseRequest,
  toExpense,
  toGroup,
  toGroupUiData,
  toMembers,
  toSettlementTransferRequest,
} from "./cloudAdapters";
import type { ExpenseDraft } from "./ExpenseComposerSheet";

describe("toGroup", () => {
  test("maps id, name, currency", () => {
    expect(
      toGroup({ id: "group_1", name: "Tokyo Trip", currency: "TWD", owner_member_id: "member_1" }),
    ).toEqual({ id: "group_1", name: "Tokyo Trip", currency: "TWD" });
  });
});

describe("toMembers", () => {
  test("maps display_name to name, derives virtual from user_id, keeps role", () => {
    const members = toMembers([
      { id: "m1", group_id: "g1", user_id: "u1", display_name: "Alice", role: "owner", status: "active" },
      { id: "m2", group_id: "g1", user_id: null, display_name: "Bob's Tab", role: "member", status: "active" },
    ]);

    expect(members).toEqual([
      { id: "m1", name: "Alice", role: "owner", virtual: false },
      { id: "m2", name: "Bob's Tab", role: "member", virtual: true },
    ]);
  });

  test("drops removed members", () => {
    const members = toMembers([
      { id: "m1", group_id: "g1", user_id: "u1", display_name: "Alice", role: "owner", status: "active" },
      { id: "m2", group_id: "g1", user_id: "u2", display_name: "Removed", role: "member", status: "removed" },
    ]);

    expect(members).toEqual([{ id: "m1", name: "Alice", role: "owner", virtual: false }]);
  });
});

describe("toExpense", () => {
  test("maps an expense with payer, shares, and amounts", () => {
    const expense = toExpense({
      id: "expense_1",
      group_id: "group_1",
      title: "Dinner",
      kind: "expense",
      category: "food",
      amount_minor: 1000,
      currency: "TWD",
      expense_date: "2026-06-30",
      created_at: "2026-06-30T12:00:00.000Z",
      note: "with friends",
      version: 1,
      client_request_id: "req_1",
      expense_payments: [{ payer_member_id: "member_1", amount_minor: 1000, currency: "TWD" }],
      expense_shares: [
        { member_id: "member_1", share_type: "fixed", amount_minor: 500 },
        { member_id: "member_2", share_type: "fixed", amount_minor: 500 },
      ],
    });

    expect(expense).toEqual({
      id: "expense_1",
      title: "Dinner",
      amountMinor: 1000,
      currency: "TWD",
      createdAt: "2026-06-30T12:00:00.000Z",
      payerId: "member_1",
      shareMemberIds: ["member_1", "member_2"],
      kind: "expense",
      category: "food",
      note: "with friends",
      imageDataUrl: undefined,
      shareAmountsMinor: { member_1: 500, member_2: 500 },
    });
  });

  test("falls back to expense_date when created_at is missing", () => {
    const expense = toExpense({
      id: "expense_1",
      group_id: "group_1",
      title: "Dinner",
      kind: "expense",
      category: "food",
      amount_minor: 1000,
      currency: "TWD",
      expense_date: "2026-06-30",
      version: 1,
      client_request_id: "req_1",
      expense_payments: [{ payer_member_id: "member_1", amount_minor: 1000, currency: "TWD" }],
      expense_shares: [{ member_id: "member_1", share_type: "fixed", amount_minor: 1000 }],
    });

    expect(expense.createdAt).toBe("2026-06-30");
  });

  test("maps kind transfer to local kind settlement", () => {
    const expense = toExpense({
      id: "expense_2",
      group_id: "group_1",
      title: "Settle up",
      kind: "transfer",
      amount_minor: 500,
      currency: "TWD",
      transfer_to_member_id: "member_2",
      version: 1,
      client_request_id: "req_2",
      expense_payments: [{ payer_member_id: "member_1", amount_minor: 500, currency: "TWD" }],
      expense_shares: [{ member_id: "member_2", share_type: "fixed", amount_minor: 500 }],
    });

    expect(expense.kind).toBe("settlement");
    expect(expense.shareMemberIds).toEqual(["member_2"]);
  });

  test("handles missing payments/shares defensively", () => {
    const expense = toExpense({
      id: "expense_3",
      group_id: "group_1",
      title: "Odd",
      kind: "expense",
      amount_minor: 100,
      currency: "TWD",
      version: 1,
      client_request_id: "req_3",
    });

    expect(expense.payerId).toBe("");
    expect(expense.shareMemberIds).toEqual([]);
    expect(expense.shareAmountsMinor).toEqual({});
  });
});

describe("toGroupUiData", () => {
  test("adapts a full GroupDetail into group/members/expenses", () => {
    const detail: GroupDetail = {
      group: { id: "group_1", name: "Tokyo Trip", currency: "TWD", owner_member_id: "member_1" },
      members: [
        { id: "member_1", group_id: "group_1", user_id: "u1", display_name: "Alice", role: "owner", status: "active" },
      ],
      expenses: [
        {
          id: "expense_1",
          group_id: "group_1",
          title: "Dinner",
          kind: "expense",
          category: "food",
          amount_minor: 1000,
          currency: "TWD",
          expense_date: "2026-06-30",
          version: 1,
          client_request_id: "req_1",
          expense_payments: [{ payer_member_id: "member_1", amount_minor: 1000, currency: "TWD" }],
          expense_shares: [{ member_id: "member_1", share_type: "fixed", amount_minor: 1000 }],
        },
      ],
      balances: [],
    };

    const ui = toGroupUiData(detail);

    expect(ui.group).toEqual({ id: "group_1", name: "Tokyo Trip", currency: "TWD" });
    expect(ui.members).toEqual([{ id: "member_1", name: "Alice", role: "owner", virtual: false }]);
    expect(ui.expenses).toHaveLength(1);
    expect(ui.expenses[0].title).toBe("Dinner");
  });
});

describe("toCreateExpenseRequest", () => {
  const baseDraft: ExpenseDraft = {
    title: "Lunch",
    amountMinor: 1000,
    createdAt: "2026-07-04T10:30:00.000Z",
    payerId: "member_1",
    shareMemberIds: ["member_1", "member_2", "member_3"],
    category: "food",
  };

  test("builds an equal-split request that satisfies validation.ts", () => {
    const request = toCreateExpenseRequest(baseDraft, "TWD");

    expect(request.kind).toBe("expense");
    expect(request.currency).toBe("TWD");
    expect(request.expense_date).toBe("2026-07-04");
    expect(request.expense_payments).toEqual([{ payer_member_id: "member_1", amount_minor: 1000, currency: "TWD" }]);
    expect(request.expense_shares).toHaveLength(3);

    const shareTotal = request.expense_shares.reduce((sum, share) => sum + share.amount_minor, 0);
    expect(shareTotal).toBe(1000);

    expect(request.client_request_id).toBeTruthy();
    expect(validateCreateExpenseRequest(request)).toEqual({ ok: true, issues: [] });
  });

  test("uses draft.shareAmountsMinor for a custom split and still balances", () => {
    const draft: ExpenseDraft = {
      ...baseDraft,
      shareMemberIds: ["member_1", "member_2"],
      shareAmountsMinor: { member_1: 700, member_2: 300 },
    };

    const request = toCreateExpenseRequest(draft, "TWD");

    expect(request.expense_shares).toEqual([
      { member_id: "member_1", share_type: "fixed", amount_minor: 700 },
      { member_id: "member_2", share_type: "fixed", amount_minor: 300 },
    ]);
    expect(validateCreateExpenseRequest(request)).toEqual({ ok: true, issues: [] });
  });

  test("passes note through when present, omits it when absent", () => {
    const withNote = toCreateExpenseRequest({ ...baseDraft, note: "extra" }, "TWD");
    expect(withNote.note).toBe("extra");

    const withoutNote = toCreateExpenseRequest(baseDraft, "TWD");
    expect(withoutNote.note).toBeUndefined();
  });

  test("generates a fresh client_request_id per call", () => {
    const first = toCreateExpenseRequest(baseDraft, "TWD");
    const second = toCreateExpenseRequest(baseDraft, "TWD");
    expect(first.client_request_id).not.toBe(second.client_request_id);
  });
});

describe("toSettlementTransferRequest", () => {
  test("builds a transfer request that satisfies validation.ts", () => {
    const request = toSettlementTransferRequest("member_1", "member_2", 500, "TWD");

    expect(request.kind).toBe("transfer");
    expect(request.transfer_to_member_id).toBe("member_2");
    expect(request.expense_payments).toEqual([{ payer_member_id: "member_1", amount_minor: 500, currency: "TWD" }]);
    expect(request.expense_shares).toEqual([{ member_id: "member_2", share_type: "fixed", amount_minor: 500 }]);
    expect(validateCreateExpenseRequest(request)).toEqual({ ok: true, issues: [] });
  });

  test("round-trips back to a settlement expense via toExpense", () => {
    const request = toSettlementTransferRequest("member_1", "member_2", 500, "TWD");
    const expense = toExpense({
      id: "expense_settle_1",
      group_id: "group_1",
      title: request.title,
      kind: request.kind,
      amount_minor: request.amount_minor,
      currency: request.currency,
      transfer_to_member_id: request.transfer_to_member_id,
      version: 1,
      client_request_id: request.client_request_id,
      expense_payments: request.expense_payments,
      expense_shares: request.expense_shares,
    });

    expect(expense.kind).toBe("settlement");
    expect(expense.payerId).toBe("member_1");
    expect(expense.shareMemberIds).toEqual(["member_2"]);
    expect(expense.amountMinor).toBe(500);
  });
});
