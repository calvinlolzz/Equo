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
});
