import { describe, expect, test } from "vitest";
import type { SupabaseQueryClient } from "./supabaseGroupRepository.js";
import { InvalidMemberError } from "./expenseRepository.js";
import { createSupabaseExpenseRepository } from "./supabaseExpenseRepository.js";

/**
 * The expense write path is now a single transactional RPC per operation
 * (create_expense / replace_expense / soft_delete_expense - see
 * supabase/migrations/20260714100000_transactional_write_rpcs.sql). The
 * membership gate, the cross-group member-id validation, and the
 * client_requests idempotency check all live inside those functions, so what
 * this repository is still responsible for - and what these tests cover - is:
 * validating the request before spending a round trip, forwarding the right
 * params, translating the RPC's sentinel errors back into typed errors, and
 * cleaning up orphaned images.
 */
const deletedExpenseRow = {
  id: "expense_1",
  group_id: "group_1",
  title: "Dinner",
  kind: "expense",
  amount_minor: 1200,
  currency: "TWD",
  version: 2,
  client_request_id: "req_expense",
  image_url: "https://example.supabase.co/storage/v1/object/public/equo-images/group_1/photo.jpg",
};

function makeClient(
  overrides: { deletedImageUrl?: string | null; replacementImageUrl?: string | null } = {},
): SupabaseQueryClient & { calls: Array<{ method: string; sql: string; params: unknown[] }> } {
  const calls: Array<{ method: string; sql: string; params: unknown[] }> = [];
  const deleted = {
    ...deletedExpenseRow,
    image_url: "deletedImageUrl" in overrides ? overrides.deletedImageUrl : deletedExpenseRow.image_url,
  };

  return {
    calls,
    async one(sql, params) {
      calls.push({ method: "one", sql, params });

      if (sql.includes("select public.create_expense(")) {
        const payload = params[2] as { client_request_id: string; title: string; image_url?: string };
        return {
          id: "expense_1",
          group_id: params[0],
          title: payload.title,
          kind: "expense",
          amount_minor: 1200,
          currency: "TWD",
          version: 1,
          client_request_id: payload.client_request_id,
          image_url: payload.image_url ?? null,
        } as never;
      }

      if (sql.includes("select public.replace_expense(")) {
        const payload = params[3] as { image_url?: string };
        return {
          expense: {
            ...deletedExpenseRow,
            id: "expense_2",
            version: 1,
            image_url:
              "replacementImageUrl" in overrides ? overrides.replacementImageUrl : (payload.image_url ?? null),
          },
          previous: deleted,
        } as never;
      }

      if (sql.includes("select public.soft_delete_expense(")) {
        return deleted as never;
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

/** A client whose write RPC raises the given sentinel, the way Postgres does. */
function makeRaisingClient(message: string): SupabaseQueryClient {
  return {
    async one(): Promise<never> {
      throw new Error(message);
    },
    async maybeOne() {
      return null;
    },
    async exec() {},
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
  test("creates the expense, its payments and its shares in ONE transactional call", async () => {
    const client = makeClient();
    const repository = createSupabaseExpenseRepository(client);

    await repository.createExpense(context, "group_1", validRequest);

    // This used to be 1 + N + M separate PostgREST calls with no transaction
    // around them - a failure partway through left an expense whose share set
    // was incomplete, which silently corrupts every balance in the group.
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toMatchObject({
      method: "one",
      sql: expect.stringContaining("select public.create_expense("),
      params: ["group_1", "user_alice", validRequest],
    });
  });

  test("passes the whole request through as the RPC payload, image_url included", async () => {
    const client = makeClient();
    const repository = createSupabaseExpenseRepository(client);

    const expense = await repository.createExpense(context, "group_1", {
      ...validRequest,
      image_url: "https://example.supabase.co/storage/v1/object/public/equo-images/group_1/photo.jpg",
    });

    expect(client.calls[0]?.params[2]).toMatchObject({
      image_url: "https://example.supabase.co/storage/v1/object/public/equo-images/group_1/photo.jpg",
    });
    expect(expense.image_url).toBe(
      "https://example.supabase.co/storage/v1/object/public/equo-images/group_1/photo.jpg",
    );
  });

  test("rejects invalid expense totals before spending a round trip", async () => {
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

  test("maps the RPC's NOT_A_GROUP_MEMBER back to the typed error routes catch", async () => {
    const repository = createSupabaseExpenseRepository(makeRaisingClient("NOT_A_GROUP_MEMBER"));

    await expect(repository.createExpense(context, "group_1", validRequest)).rejects.toThrow(
      "NOT_A_GROUP_MEMBER",
    );
  });

  test("maps the RPC's INVALID_MEMBER:<id> back to InvalidMemberError", async () => {
    // The cross-group member-id check itself now runs in SQL (the FKs only
    // reference group_members(id) globally, so without it a crafted request
    // could charge another group's member). What this asserts is that its
    // failure still reaches the route as InvalidMemberError -> 400.
    const repository = createSupabaseExpenseRepository(makeRaisingClient("INVALID_MEMBER:member_other_group"));

    await expect(repository.createExpense(context, "group_1", validRequest)).rejects.toThrow(
      /INVALID_MEMBER.*member_other_group/,
    );
    await expect(repository.createExpense(context, "group_1", validRequest)).rejects.toBeInstanceOf(
      InvalidMemberError,
    );
  });

  test("replaceExpense edits through a single transactional call", async () => {
    const client = makeClient();
    const repository = createSupabaseExpenseRepository(client);

    const result = await repository.replaceExpense(context, "group_1", "expense_1", validRequest);

    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toMatchObject({
      sql: expect.stringContaining("select public.replace_expense("),
      params: ["group_1", "user_alice", "expense_1", validRequest],
    });
    expect(result.expense.id).toBe("expense_2");
    expect(result.previous?.id).toBe("expense_1");
  });

  test("replaceExpense surfaces EXPENSE_NOT_FOUND when the target is already gone", async () => {
    const repository = createSupabaseExpenseRepository(makeRaisingClient("EXPENSE_NOT_FOUND"));

    await expect(repository.replaceExpense(context, "group_1", "expense_1", validRequest)).rejects.toThrow(
      "EXPENSE_NOT_FOUND",
    );
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

  test("softDeleteExpense deletes through a single transactional call", async () => {
    const client = makeClient();
    const repository = createSupabaseExpenseRepository(client);

    const expense = await repository.softDeleteExpense(context, "group_1", "expense_1", "req_delete");

    // The membership gate, the version bump (which the translated PostgREST
    // PATCH silently dropped), and the client_requests write all live inside
    // the RPC now.
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0]).toMatchObject({
      sql: expect.stringContaining("select public.soft_delete_expense("),
      params: ["group_1", "user_alice", "expense_1", "req_delete"],
    });
    expect(expense).toMatchObject({ id: "expense_1", version: 2 });
  });

  test("softDeleteExpense rejects a non-member with NOT_A_GROUP_MEMBER", async () => {
    const repository = createSupabaseExpenseRepository(makeRaisingClient("NOT_A_GROUP_MEMBER"));

    await expect(repository.softDeleteExpense(context, "group_1", "expense_1", "req_delete")).rejects.toThrow(
      "NOT_A_GROUP_MEMBER",
    );
  });

  describe("orphaned-image cleanup", () => {
    function makeFakeStorage() {
      const deletedPaths: string[] = [];
      return {
        deletedPaths,
        client: {
          async uploadImage() {
            throw new Error("uploadImage should not be called here");
          },
          async deleteImage(path: string) {
            deletedPaths.push(path);
          },
        },
      };
    }

    /** deleteImage is fire-and-forget (see cleanupOrphanedImage) - flush microtasks. */
    const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

    test("softDeleteExpense deletes the removed expense's image via the bucket-relative path", async () => {
      const storage = makeFakeStorage();
      const repository = createSupabaseExpenseRepository(makeClient(), storage.client);

      await repository.softDeleteExpense(context, "group_1", "expense_1", "req_delete");
      await flush();

      expect(storage.deletedPaths).toEqual(["group_1/photo.jpg"]);
    });

    test("softDeleteExpense does nothing when the removed expense has no image", async () => {
      const storage = makeFakeStorage();
      const repository = createSupabaseExpenseRepository(makeClient({ deletedImageUrl: null }), storage.client);

      await repository.softDeleteExpense(context, "group_1", "expense_1", "req_delete");
      await flush();

      expect(storage.deletedPaths).toEqual([]);
    });

    test("softDeleteExpense does nothing when no storage client is provided (optional param)", async () => {
      const repository = createSupabaseExpenseRepository(makeClient());

      await expect(
        repository.softDeleteExpense(context, "group_1", "expense_1", "req_delete"),
      ).resolves.toMatchObject({ id: "expense_1" });
    });

    test("replaceExpense deletes the replaced expense's image once it is unreferenced", async () => {
      const storage = makeFakeStorage();
      const repository = createSupabaseExpenseRepository(
        makeClient({ replacementImageUrl: null }),
        storage.client,
      );

      await repository.replaceExpense(context, "group_1", "expense_1", validRequest);
      await flush();

      expect(storage.deletedPaths).toEqual(["group_1/photo.jpg"]);
    });

    test("replaceExpense keeps the image when the edit reuses it", async () => {
      const storage = makeFakeStorage();
      // An edit that changes only the title carries the same image_url through -
      // deleting it here would break the expense that is still using it.
      const repository = createSupabaseExpenseRepository(
        makeClient({ replacementImageUrl: deletedExpenseRow.image_url }),
        storage.client,
      );

      await repository.replaceExpense(context, "group_1", "expense_1", validRequest);
      await flush();

      expect(storage.deletedPaths).toEqual([]);
    });
  });
});
