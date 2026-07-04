import { describe, expect, test } from "vitest";
import type { SupabaseQueryClient } from "./supabaseGroupRepository.js";
import { createSupabaseExpenseRepository } from "./supabaseExpenseRepository.js";

function makeClient(): SupabaseQueryClient & { calls: Array<{ method: string; sql: string; params: unknown[] }> } {
  const calls: Array<{ method: string; sql: string; params: unknown[] }> = [];

  return {
    calls,
    async one(sql, params) {
      calls.push({ method: "one", sql, params });

      if (sql.includes("from public.group_members")) {
        return { id: "member_alice" } as never;
      }

      if (sql.includes("insert into public.expenses")) {
        return {
          id: "expense_1",
          group_id: params[0],
          title: params[2],
          kind: params[3],
          amount_minor: params[5],
          currency: params[6],
          version: 1,
          client_request_id: params[10],
        } as never;
      }

      throw new Error(`Unexpected one query: ${sql}`);
    },
    async maybeOne() {
      return null;
    },
    async exec(sql, params) {
      calls.push({ method: "exec", sql, params });
    },
  };
}

function makeListExpensesClient(overrides: {
  expenses: unknown[];
  payments: unknown[];
  shares: unknown[];
}): SupabaseQueryClient & { calls: Array<{ method: string; sql: string; params: unknown[] }> } {
  const calls: Array<{ method: string; sql: string; params: unknown[] }> = [];

  return {
    calls,
    async one(sql, params) {
      calls.push({ method: "one", sql, params });

      if (sql.includes("from public.expenses")) {
        return overrides.expenses as never;
      }

      if (sql.includes("from public.expense_payments")) {
        return overrides.payments as never;
      }

      if (sql.includes("from public.expense_shares")) {
        return overrides.shares as never;
      }

      throw new Error(`Unexpected one query: ${sql}`);
    },
    async maybeOne() {
      return null;
    },
    async exec(sql, params) {
      calls.push({ method: "exec", sql, params });
    },
  };
}

const context = {
  user: {
    id: "user_alice",
    google_sub: "google-alice",
    email: "alice@example.com",
    display_name: "Alice",
  },
};

const validRequest = {
  client_request_id: "req_expense",
  title: "??",
  kind: "expense" as const,
  category: "food",
  amount_minor: 1200,
  currency: "TWD",
  expense_date: "2026-06-30",
  expense_payments: [{ payer_member_id: "member_alice", amount_minor: 1200, currency: "TWD" }],
  expense_shares: [
    { member_id: "member_alice", share_type: "fixed" as const, amount_minor: 600 },
    { member_id: "member_bob", share_type: "fixed" as const, amount_minor: 600 },
  ],
};

describe("createSupabaseExpenseRepository", () => {
  test("writes expense, payments, and shares in order", async () => {
    const client = makeClient();
    const repository = createSupabaseExpenseRepository(client);

    await repository.createExpense(context, "group_1", validRequest);

    expect(client.calls.map((call) => call.sql)).toEqual([
      expect.stringContaining("from public.group_members"),
      expect.stringContaining("insert into public.expenses"),
      expect.stringContaining("insert into public.expense_payments"),
      expect.stringContaining("insert into public.expense_shares"),
      expect.stringContaining("insert into public.expense_shares"),
      expect.stringContaining("insert into public.client_requests"),
    ]);
  });

  test("rejects invalid expense totals before writing", async () => {
    const client = makeClient();
    const repository = createSupabaseExpenseRepository(client);

    await expect(
      repository.createExpense(context, "group_1", {
        ...validRequest,
        expense_payments: [{ payer_member_id: "member_alice", amount_minor: 1000, currency: "TWD" }],
      }),
    ).rejects.toThrow("PAYMENT_TOTAL_MISMATCH");
    expect(client.calls).toEqual([]);
  });

  test("records client_request_id after creating an expense", async () => {
    const client = makeClient();
    const repository = createSupabaseExpenseRepository(client);

    await repository.createExpense(context, "group_1", validRequest);

    expect(client.calls.at(-1)).toMatchObject({
      method: "exec",
      params: ["group_1", "req_expense", "expense_1"],
    });
  });

  test("threads an optional image_url through to the expenses insert", async () => {
    const client = makeClient();
    const repository = createSupabaseExpenseRepository(client);

    await repository.createExpense(context, "group_1", {
      ...validRequest,
      image_url: "https://example.supabase.co/storage/v1/object/public/equo-images/group_1/photo.jpg",
    });

    const insertCall = client.calls.find((call) => call.sql.includes("insert into public.expenses"));
    expect(insertCall?.params.at(-1)).toBe(
      "https://example.supabase.co/storage/v1/object/public/equo-images/group_1/photo.jpg",
    );
  });

  test("defaults image_url to null when not provided", async () => {
    const client = makeClient();
    const repository = createSupabaseExpenseRepository(client);

    await repository.createExpense(context, "group_1", validRequest);

    const insertCall = client.calls.find((call) => call.sql.includes("insert into public.expenses"));
    expect(insertCall?.params.at(-1)).toBeNull();
  });

  test("listExpenses returns note, transfer_to_member_id, payments, and shares batched for the whole group", async () => {
    const client = makeListExpensesClient({
      expenses: [
        {
          id: "expense_1",
          group_id: "group_1",
          title: "Dinner",
          kind: "expense",
          category: "food",
          amount_minor: 1200,
          currency: "TWD",
          expense_date: "2026-06-30",
          note: "Split unevenly, Bob paid",
          transfer_to_member_id: null,
          image_url: "https://example.supabase.co/storage/v1/object/public/equo-images/group_1/photo.jpg",
          created_at: "2026-06-30T00:00:00.000Z",
          version: 1,
          client_request_id: "expense_req_1",
        },
        {
          id: "expense_2",
          group_id: "group_1",
          title: "Payback",
          kind: "transfer",
          category: "transfer",
          amount_minor: 500,
          currency: "TWD",
          expense_date: "2026-07-01",
          note: null,
          transfer_to_member_id: "member_bob",
          created_at: "2026-07-01T00:00:00.000Z",
          version: 1,
          client_request_id: "expense_req_2",
        },
      ],
      payments: [
        { expense_id: "expense_1", payer_member_id: "member_bob", amount_minor: 1200, currency: "TWD" },
        { expense_id: "expense_2", payer_member_id: "member_alice", amount_minor: 500, currency: "TWD" },
      ],
      shares: [
        // Custom (fixed) split, and the payer (member_bob) is excluded from the shares entirely.
        { expense_id: "expense_1", member_id: "member_alice", share_type: "fixed", share_value: undefined, amount_minor: 800 },
        { expense_id: "expense_1", member_id: "member_carol", share_type: "fixed", share_value: undefined, amount_minor: 400 },
      ],
    });
    const repository = createSupabaseExpenseRepository(client);

    const expenses = await repository.listExpenses("group_1");

    expect(client.calls.map((call) => call.sql)).toEqual([
      expect.stringContaining("from public.expenses"),
      expect.stringContaining("from public.expense_payments"),
      expect.stringContaining("from public.expense_shares"),
    ]);
    expect(client.calls[1]?.params).toEqual([["expense_1", "expense_2"]]);
    expect(client.calls[2]?.params).toEqual([["expense_1", "expense_2"]]);

    expect(expenses[0]).toMatchObject({
      id: "expense_1",
      note: "Split unevenly, Bob paid",
      transfer_to_member_id: null,
      image_url: "https://example.supabase.co/storage/v1/object/public/equo-images/group_1/photo.jpg",
      expense_payments: [{ payer_member_id: "member_bob", amount_minor: 1200, currency: "TWD" }],
      expense_shares: [
        { member_id: "member_alice", share_type: "fixed", amount_minor: 800 },
        { member_id: "member_carol", share_type: "fixed", amount_minor: 400 },
      ],
    });
    // The payer (member_bob) does not appear in expense_shares for expense_1.
    expect(
      expenses[0]?.expense_shares?.some((share) => share.member_id === "member_bob"),
    ).toBe(false);

    expect(expenses[1]).toMatchObject({
      id: "expense_2",
      note: null,
      transfer_to_member_id: "member_bob",
      expense_payments: [{ payer_member_id: "member_alice", amount_minor: 500, currency: "TWD" }],
      expense_shares: [],
    });
  });

  test("listExpenses skips payments/shares queries when the group has no expenses", async () => {
    const client = makeListExpensesClient({ expenses: [], payments: [], shares: [] });
    const repository = createSupabaseExpenseRepository(client);

    const expenses = await repository.listExpenses("group_empty");

    expect(expenses).toEqual([]);
    expect(client.calls.map((call) => call.sql)).toEqual([expect.stringContaining("from public.expenses")]);
  });
});
