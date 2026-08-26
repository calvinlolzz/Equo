import { describe, expect, test } from "vitest";
import { validateCreateExpenseRequest } from "../contracts/validation";
import type { GroupDetail } from "./apiClient";
import {
  draftToExpense,
  expenseKindToApiKind,
  settlementTransferToDraft,
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
    ).toEqual({ id: "group_1", name: "Tokyo Trip", currency: "TWD", coverImageUrl: undefined });
  });

  test("maps cover_image_url when present", () => {
    expect(
      toGroup({
        id: "group_1",
        name: "Tokyo Trip",
        currency: "TWD",
        owner_member_id: "member_1",
        cover_image_url: "https://cdn.equo.local/cover.jpg",
      }),
    ).toEqual({
      id: "group_1",
      name: "Tokyo Trip",
      currency: "TWD",
      coverImageUrl: "https://cdn.equo.local/cover.jpg",
    });
  });

  test("maps a null cover_image_url to undefined", () => {
    expect(
      toGroup({
        id: "group_1",
        name: "Tokyo Trip",
        currency: "TWD",
        owner_member_id: "member_1",
        cover_image_url: null,
      }).coverImageUrl,
    ).toBeUndefined();
  });
});

describe("toMembers", () => {
  test("maps display_name to name, derives virtual from user_id, keeps role", () => {
    const members = toMembers([
      { id: "m1", group_id: "g1", user_id: "u1", display_name: "Alice", role: "owner", status: "active" },
      { id: "m2", group_id: "g1", user_id: null, display_name: "Bob's Tab", role: "member", status: "active" },
    ]);

    expect(members).toEqual([
      { id: "m1", name: "Alice", role: "owner", virtual: false, userId: "u1" },
      { id: "m2", name: "Bob's Tab", role: "member", virtual: true, userId: null },
    ]);
  });

  test("drops removed members", () => {
    const members = toMembers([
      { id: "m1", group_id: "g1", user_id: "u1", display_name: "Alice", role: "owner", status: "active" },
      { id: "m2", group_id: "g1", user_id: "u2", display_name: "Removed", role: "member", status: "removed" },
    ]);

    expect(members).toEqual([{ id: "m1", name: "Alice", role: "owner", virtual: false, userId: "u1" }]);
  });

  test("maps userId from user_id so App.tsx can resolve the current user among joined-group members", () => {
    const members = toMembers([
      { id: "m1", group_id: "g1", user_id: "u1", display_name: "Alice", role: "member", status: "active" },
    ]);

    expect(members[0].userId).toBe("u1");
  });

  test("maps avatar_url to avatarUrl when present", () => {
    const members = toMembers([
      {
        id: "m1",
        group_id: "g1",
        user_id: "u1",
        display_name: "Alice",
        role: "member",
        status: "active",
        avatar_url: "https://cdn.equo.local/avatars/u1/photo.jpg",
      },
    ]);

    expect(members[0].avatarUrl).toBe("https://cdn.equo.local/avatars/u1/photo.jpg");
  });

  test("maps a missing or null avatar_url to undefined (virtual members, or a real member with no avatar set)", () => {
    const members = toMembers([
      { id: "m1", group_id: "g1", user_id: "u1", display_name: "Alice", role: "member", status: "active", avatar_url: null },
      { id: "m2", group_id: "g1", user_id: null, display_name: "Bob's Tab", role: "member", status: "active" },
    ]);

    expect(members[0].avatarUrl).toBeUndefined();
    expect(members[1].avatarUrl).toBeUndefined();
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
      expenseDate: "2026-06-30",
      payerId: "member_1",
      payments: [{ payerId: "member_1", amountMinor: 1000 }],
      shareMemberIds: ["member_1", "member_2"],
      kind: "expense",
      category: "food",
      note: "with friends",
      imageUrl: undefined,
      imageUrls: [],
      shareAmountsMinor: { member_1: 500, member_2: 500 },
    });
  });

  test("maps every expense_payments entry for a multi-payer expense, keeping payerId as the first payer", () => {
    const expense = toExpense({
      id: "expense_multi",
      group_id: "group_1",
      title: "Hotel",
      kind: "expense",
      amount_minor: 1000,
      currency: "TWD",
      expense_date: "2026-06-30",
      version: 1,
      client_request_id: "req_multi",
      expense_payments: [
        { payer_member_id: "member_1", amount_minor: 600, currency: "TWD" },
        { payer_member_id: "member_2", amount_minor: 400, currency: "TWD" },
      ],
      expense_shares: [
        { member_id: "member_1", share_type: "fixed", amount_minor: 500 },
        { member_id: "member_2", share_type: "fixed", amount_minor: 500 },
      ],
    });

    expect(expense.payerId).toBe("member_1");
    expect(expense.payments).toEqual([
      { payerId: "member_1", amountMinor: 600 },
      { payerId: "member_2", amountMinor: 400 },
    ]);
  });

  test("maps kind income to local kind income with the beneficiary payments", () => {
    const expense = toExpense({
      id: "income_1",
      group_id: "group_1",
      title: "Refund",
      kind: "income",
      amount_minor: 900,
      currency: "TWD",
      expense_date: "2026-06-30",
      version: 1,
      client_request_id: "req_income",
      expense_payments: [
        { payer_member_id: "member_2", amount_minor: 450, currency: "TWD" },
        { payer_member_id: "member_3", amount_minor: 450, currency: "TWD" },
      ],
      expense_shares: [{ member_id: "member_1", share_type: "fixed", amount_minor: 900 }],
    });

    expect(expense.kind).toBe("income");
    expect(expense.shareMemberIds).toEqual(["member_1"]);
    expect(expense.shareAmountsMinor).toEqual({ member_1: 900 });
    expect(expense.payments).toEqual([
      { payerId: "member_2", amountMinor: 450 },
      { payerId: "member_3", amountMinor: 450 },
    ]);
  });

  test("maps share_type percent to shareType/sharePercents while keeping exact amounts", () => {
    const expense = toExpense({
      id: "expense_pct",
      group_id: "group_1",
      title: "Rent",
      kind: "expense",
      amount_minor: 1000,
      currency: "TWD",
      expense_date: "2026-06-30",
      version: 1,
      client_request_id: "req_pct",
      expense_payments: [{ payer_member_id: "member_1", amount_minor: 1000, currency: "TWD" }],
      expense_shares: [
        { member_id: "member_1", share_type: "percent", share_value: 70, amount_minor: 700 },
        { member_id: "member_2", share_type: "percent", share_value: 30, amount_minor: 300 },
      ],
    });

    expect(expense.shareType).toBe("percent");
    expect(expense.sharePercents).toEqual({ member_1: 70, member_2: 30 });
    expect(expense.shareAmountsMinor).toEqual({ member_1: 700, member_2: 300 });
  });

  test("maps image_url to imageUrl when present", () => {
    const expense = toExpense({
      id: "expense_1",
      group_id: "group_1",
      title: "Dinner",
      kind: "expense",
      category: "food",
      amount_minor: 1000,
      currency: "TWD",
      expense_date: "2026-06-30",
      image_url: "https://cdn.equo.local/expense.jpg",
      version: 1,
      client_request_id: "req_1",
      expense_payments: [{ payer_member_id: "member_1", amount_minor: 1000, currency: "TWD" }],
      expense_shares: [{ member_id: "member_1", share_type: "fixed", amount_minor: 1000 }],
    });

    expect(expense.imageUrl).toBe("https://cdn.equo.local/expense.jpg");
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
      balances: [{ memberId: "member_1", balance: { amount_minor: 0, currency: "TWD" } }],
      expense_count: 1,
      spend_total_minor: 1000,
      spend_by_day: [{ day: "2026-06-30", total_minor: 1000 }],
      spend_by_category: [{ category: "food", total_minor: 1000 }],
      member_day_shares: [{ day: "2026-06-30", member_id: "member_1", share_minor: 1000 }],
    };

    const ui = toGroupUiData(detail);

    expect(ui.group).toEqual({ id: "group_1", name: "Tokyo Trip", currency: "TWD", coverImageUrl: undefined });
    expect(ui.members).toEqual([{ id: "member_1", name: "Alice", role: "owner", virtual: false, userId: "u1" }]);
    expect(ui.expenses).toHaveLength(1);
    expect(ui.expenses[0].title).toBe("Dinner");
    expect(ui.balances).toEqual([{ memberId: "member_1", balance: { amount_minor: 0, currency: "TWD" } }]);
    expect(ui.aggregates).toEqual({
      expenseCount: 1,
      spendTotalMinor: 1000,
      spendByDay: [{ day: "2026-06-30", totalMinor: 1000 }],
      spendByCategory: [{ category: "food", totalMinor: 1000 }],
      memberDayShares: [{ day: "2026-06-30", memberId: "member_1", shareMinor: 1000 }],
    });
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

  test("builds one expense_payments entry per payer for a multi-payer draft", () => {
    const draft: ExpenseDraft = {
      ...baseDraft,
      shareMemberIds: ["member_1", "member_2"],
      payments: [
        { payerId: "member_1", amountMinor: 600 },
        { payerId: "member_2", amountMinor: 400 },
      ],
    };

    const request = toCreateExpenseRequest(draft, "TWD");

    expect(request.expense_payments).toEqual([
      { payer_member_id: "member_1", amount_minor: 600, currency: "TWD" },
      { payer_member_id: "member_2", amount_minor: 400, currency: "TWD" },
    ]);
    expect(validateCreateExpenseRequest(request)).toEqual({ ok: true, issues: [] });
  });

  test("drops zero-amount payer rows so every payment stays a positive integer", () => {
    const draft: ExpenseDraft = {
      ...baseDraft,
      shareMemberIds: ["member_1", "member_2"],
      payments: [
        { payerId: "member_1", amountMinor: 1000 },
        { payerId: "member_2", amountMinor: 0 },
      ],
    };

    const request = toCreateExpenseRequest(draft, "TWD");

    expect(request.expense_payments).toEqual([{ payer_member_id: "member_1", amount_minor: 1000, currency: "TWD" }]);
    expect(validateCreateExpenseRequest(request)).toEqual({ ok: true, issues: [] });
  });

  test("percent shares send share_type percent + share_value AND exact amount_minor that reconciles", () => {
    const draft: ExpenseDraft = {
      ...baseDraft,
      shareMemberIds: ["member_1", "member_2", "member_3"],
      shareType: "percent",
      sharePercents: { member_1: 33.33, member_2: 33.33, member_3: 33.34 },
    };

    const request = toCreateExpenseRequest(draft, "TWD");

    expect(request.expense_shares.map((share) => share.share_type)).toEqual(["percent", "percent", "percent"]);
    expect(request.expense_shares.map((share) => share.share_value)).toEqual([33.33, 33.33, 33.34]);
    const shareTotal = request.expense_shares.reduce((sum, share) => sum + share.amount_minor, 0);
    expect(shareTotal).toBe(1000);
    expect(validateCreateExpenseRequest(request)).toEqual({ ok: true, issues: [] });
  });

  test("income drafts encode beneficiary payments plus a single full-amount collector share", () => {
    const draft: ExpenseDraft = {
      ...baseDraft,
      kind: "income",
      title: "Refund",
      amountMinor: 900,
      payerId: "member_1",
      shareMemberIds: ["member_2", "member_3"],
    };

    const request = toCreateExpenseRequest(draft, "TWD");

    expect(request.kind).toBe("income");
    expect(request.expense_payments).toEqual([
      { payer_member_id: "member_2", amount_minor: 450, currency: "TWD" },
      { payer_member_id: "member_3", amount_minor: 450, currency: "TWD" },
    ]);
    expect(request.expense_shares).toEqual([{ member_id: "member_1", share_type: "fixed", amount_minor: 900 }]);
    expect(validateCreateExpenseRequest(request)).toEqual({ ok: true, issues: [] });
  });

  test("income drafts honor a custom beneficiary split", () => {
    const draft: ExpenseDraft = {
      ...baseDraft,
      kind: "income",
      amountMinor: 900,
      payerId: "member_1",
      shareMemberIds: ["member_2", "member_3"],
      shareAmountsMinor: { member_2: 600, member_3: 300 },
    };

    const request = toCreateExpenseRequest(draft, "TWD");

    expect(request.expense_payments).toEqual([
      { payer_member_id: "member_2", amount_minor: 600, currency: "TWD" },
      { payer_member_id: "member_3", amount_minor: 300, currency: "TWD" },
    ]);
    expect(validateCreateExpenseRequest(request)).toEqual({ ok: true, issues: [] });
  });

  test("transfer drafts build the same wire shape as the settle flow", () => {
    const draft: ExpenseDraft = {
      ...baseDraft,
      kind: "transfer",
      title: "轉帳",
      amountMinor: 500,
      payerId: "member_1",
      transferToMemberId: "member_2",
      shareMemberIds: ["member_2"],
      category: "general",
    };

    const request = toCreateExpenseRequest(draft, "TWD");

    expect(request.kind).toBe("transfer");
    expect(request.transfer_to_member_id).toBe("member_2");
    expect(request.expense_payments).toEqual([{ payer_member_id: "member_1", amount_minor: 500, currency: "TWD" }]);
    expect(request.expense_shares).toEqual([{ member_id: "member_2", share_type: "fixed", amount_minor: 500 }]);
    expect(validateCreateExpenseRequest(request)).toEqual({ ok: true, issues: [] });
  });

  test("passes every receipt through as image_urls", () => {
    const withImages = toCreateExpenseRequest(
      { ...baseDraft, imageUrls: ["https://cdn.equo.local/a.jpg", "https://cdn.equo.local/b.jpg"] },
      "TWD",
    );
    expect(withImages.image_urls).toEqual(["https://cdn.equo.local/a.jpg", "https://cdn.equo.local/b.jpg"]);
  });

  test("sends an empty image_urls rather than omitting it, so removing the last receipt saves", () => {
    // Absent means "this payload is not talking about receipts" server-side and
    // falls back to the legacy single column - so an omitted key here would make
    // deleting the last photo silently do nothing.
    const request = toCreateExpenseRequest(baseDraft, "TWD");
    expect(request.image_urls).toEqual([]);
    expect("image_urls" in request).toBe(true);
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

describe("draftToExpense", () => {
  const baseDraft: ExpenseDraft = {
    title: "Lunch",
    amountMinor: 1000,
    createdAt: "2026-07-04T10:30:00.000Z",
    payerId: "member_1",
    shareMemberIds: ["member_1", "member_2"],
    category: "food",
  };

  test("builds a local Expense from the draft plus createExpense's response, no server round-trip needed", () => {
    const response = { id: "expense_1", title: "Lunch", amount_minor: 1000, currency: "TWD" };

    const expense = draftToExpense(baseDraft, response);

    expect(expense).toEqual({
      id: "expense_1",
      title: "Lunch",
      amountMinor: 1000,
      currency: "TWD",
      createdAt: "2026-07-04T10:30:00.000Z",
      payerId: "member_1",
      payments: [{ payerId: "member_1", amountMinor: 1000 }],
      shareMemberIds: ["member_1", "member_2"],
      kind: "expense",
      category: "food",
      note: undefined,
      imageUrl: undefined,
      imageUrls: [],
      shareAmountsMinor: { member_1: 500, member_2: 500 },
    });
  });

  test("uses draft.shareAmountsMinor for a custom split instead of an equal one", () => {
    const draft: ExpenseDraft = { ...baseDraft, shareAmountsMinor: { member_1: 700, member_2: 300 } };
    const response = { id: "expense_1", title: "Lunch", amount_minor: 1000, currency: "TWD" };

    const expense = draftToExpense(draft, response);

    expect(expense.shareAmountsMinor).toEqual({ member_1: 700, member_2: 300 });
  });

  test("passes note and imageUrl through from the draft when present", () => {
    const draft: ExpenseDraft = { ...baseDraft, note: "extra", imageUrls: ["https://cdn.equo.local/expense.jpg"] };
    const response = { id: "expense_1", title: "Lunch", amount_minor: 1000, currency: "TWD" };

    const expense = draftToExpense(draft, response);

    expect(expense.note).toBe("extra");
    expect(expense.imageUrl).toBe("https://cdn.equo.local/expense.jpg");
  });

  test("defaults kind to expense, accepts an explicit kind override for settlements", () => {
    const response = { id: "expense_1", title: "Lunch", amount_minor: 1000, currency: "TWD" };
    expect(draftToExpense(baseDraft, response).kind).toBe("expense");
    expect(draftToExpense(baseDraft, response, "settlement").kind).toBe("settlement");
  });

  test("round-trips the same shape toExpense would produce from a refetched server row", () => {
    const response = { id: "expense_1", title: "Lunch", amount_minor: 1000, currency: "TWD" };
    const local = draftToExpense(baseDraft, response);

    const refetched = toExpense({
      id: "expense_1",
      group_id: "group_1",
      title: "Lunch",
      kind: "expense",
      category: "food",
      amount_minor: 1000,
      currency: "TWD",
      created_at: baseDraft.createdAt,
      version: 1,
      client_request_id: "req_1",
      expense_payments: [{ payer_member_id: "member_1", amount_minor: 1000, currency: "TWD" }],
      expense_shares: [
        { member_id: "member_1", share_type: "fixed", amount_minor: 500 },
        { member_id: "member_2", share_type: "fixed", amount_minor: 500 },
      ],
    });

    expect(local).toEqual(refetched);
  });
});

/**
 * Full round-trip per kind: draft -> toCreateExpenseRequest -> (simulated
 * server row echoing the request) -> toExpense, compared against the local
 * echo draftToExpense builds without a refetch. If these ever diverge, the
 * optimistic UI would flicker to a different shape after a resync.
 */
describe("draft round-trips through the wire format", () => {
  function refetchFromRequest(draft: ExpenseDraft, id: string) {
    const request = toCreateExpenseRequest(draft, "TWD");
    expect(validateCreateExpenseRequest(request)).toEqual({ ok: true, issues: [] });
    const local = draftToExpense(draft, { id, title: request.title, amount_minor: request.amount_minor, currency: request.currency });
    const refetched = toExpense({
      id,
      group_id: "group_1",
      title: request.title,
      kind: request.kind,
      category: request.category,
      amount_minor: request.amount_minor,
      currency: request.currency,
      created_at: draft.createdAt,
      note: request.note ?? null,
      transfer_to_member_id: request.transfer_to_member_id ?? null,
      image_url: request.image_url ?? null,
      version: 1,
      client_request_id: request.client_request_id,
      expense_payments: request.expense_payments,
      expense_shares: request.expense_shares,
    });
    return { local, refetched };
  }

  test("multi-payer expense", () => {
    const draft: ExpenseDraft = {
      title: "Hotel",
      amountMinor: 1000,
      createdAt: "2026-07-04T10:30:00.000Z",
      payerId: "member_1",
      shareMemberIds: ["member_1", "member_2"],
      category: "lodging",
      payments: [
        { payerId: "member_1", amountMinor: 600 },
        { payerId: "member_2", amountMinor: 400 },
      ],
    };

    const { local, refetched } = refetchFromRequest(draft, "expense_rt_multi");
    expect(local).toEqual(refetched);
    expect(local.payments).toHaveLength(2);
    expect(local.kind).toBe("expense");
  });

  test("percent-split expense", () => {
    const draft: ExpenseDraft = {
      title: "Rent",
      amountMinor: 1000,
      createdAt: "2026-07-04T10:30:00.000Z",
      payerId: "member_1",
      shareMemberIds: ["member_1", "member_2", "member_3"],
      category: "general",
      shareType: "percent",
      sharePercents: { member_1: 33.33, member_2: 33.33, member_3: 33.34 },
    };

    const { local, refetched } = refetchFromRequest(draft, "expense_rt_pct");
    expect(local).toEqual(refetched);
    expect(local.shareType).toBe("percent");
    expect(local.sharePercents).toEqual({ member_1: 33.33, member_2: 33.33, member_3: 33.34 });
  });

  test("income", () => {
    const draft: ExpenseDraft = {
      title: "Refund",
      amountMinor: 900,
      createdAt: "2026-07-04T10:30:00.000Z",
      payerId: "member_1",
      shareMemberIds: ["member_2", "member_3"],
      category: "general",
      kind: "income",
    };

    const { local, refetched } = refetchFromRequest(draft, "expense_rt_income");
    expect(local).toEqual(refetched);
    expect(local.kind).toBe("income");
    expect(local.payments).toEqual([
      { payerId: "member_2", amountMinor: 450 },
      { payerId: "member_3", amountMinor: 450 },
    ]);
    expect(local.shareMemberIds).toEqual(["member_1"]);
    expect(local.shareAmountsMinor).toEqual({ member_1: 900 });
  });

  test("transfer", () => {
    const draft: ExpenseDraft = {
      title: "轉帳",
      amountMinor: 500,
      createdAt: "2026-07-04T10:30:00.000Z",
      payerId: "member_1",
      shareMemberIds: ["member_2"],
      category: "general",
      kind: "transfer",
      transferToMemberId: "member_2",
    };

    const { local, refetched } = refetchFromRequest(draft, "expense_rt_transfer");
    expect(local).toEqual(refetched);
    expect(local.kind).toBe("settlement");
    expect(local.transferToMemberId).toBe("member_2");
    expect(local.payments).toEqual([{ payerId: "member_1", amountMinor: 500 }]);
    expect(local.shareAmountsMinor).toEqual({ member_2: 500 });
  });
});

describe("settlementTransferToDraft", () => {
  test("builds a draft shaped like toSettlementTransferRequest, so draftToExpense recovers a settlement's shareMemberIds/payerId", () => {
    const draft = settlementTransferToDraft("member_1", "member_2", 500);

    expect(draft.payerId).toBe("member_1");
    expect(draft.shareMemberIds).toEqual(["member_2"]);
    expect(draft.amountMinor).toBe(500);
    expect(draft.shareAmountsMinor).toEqual({ member_2: 500 });

    const response = { id: "expense_settle_1", title: draft.title, amount_minor: 500, currency: "TWD" };
    const expense = draftToExpense(draft, response, "settlement");

    expect(expense.kind).toBe("settlement");
    expect(expense.payerId).toBe("member_1");
    expect(expense.shareMemberIds).toEqual(["member_2"]);
    expect(expense.amountMinor).toBe(500);
  });
});

describe("expenseKindToApiKind", () => {
  test("translates the one word the app and the column disagree on", () => {
    // A 清償 is "settlement" in the UI and "transfer" in expenses.kind. Sending
    // the app's word to a server-side filter matched NOTHING - which is what
    // the records panel's 結算 filter did: an empty list for a group that had
    // four settlements in it.
    expect(expenseKindToApiKind("settlement")).toBe("transfer");
  });

  test("leaves the kinds that already agree alone", () => {
    expect(expenseKindToApiKind("expense")).toBe("expense");
    expect(expenseKindToApiKind("income")).toBe("income");
  });

  test("round-trips with toExpense, so a filtered row maps back to what was asked for", () => {
    const mapped = toExpense({
      id: "expense_1",
      group_id: "group_1",
      title: "清償轉帳",
      kind: expenseKindToApiKind("settlement"),
      amount_minor: 50_000,
      currency: "TWD",
      version: 1,
      client_request_id: "req_1",
    });

    expect(mapped.kind).toBe("settlement");
  });
});
