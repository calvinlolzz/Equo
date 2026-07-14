import { describe, expect, test } from "vitest";
import { createFakePostgrest, type FakePostgrest } from "../db/fakePostgrest.js";
import { InvalidMemberError } from "./expenseRepository.js";
import { createSupabaseExpenseRepository } from "./supabaseExpenseRepository.js";

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
  title: "Dinner",
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

const IMAGE_URL = "https://example.supabase.co/storage/v1/object/public/equo-images/group_1/photo.jpg";

const deletedExpenseRow = {
  id: "expense_1",
  group_id: "group_1",
  title: "Dinner",
  kind: "expense",
  amount_minor: 1200,
  currency: "TWD",
  version: 2,
  client_request_id: "req_expense",
  image_url: IMAGE_URL as string | null,
};

/**
 * The expense write path is a single transactional RPC per operation
 * (create_expense / replace_expense / soft_delete_expense - see
 * supabase/migrations/20260714100000_transactional_write_rpcs.sql). The
 * membership gate, the cross-group member-id validation, and the
 * client_requests idempotency check all live inside those functions. What the
 * repository still owns - and what these tests cover - is validating the request
 * before spending a round trip, forwarding the right arguments, translating the
 * RPC's sentinel errors into typed errors, and cleaning up orphaned images.
 */
function makeClient(
  overrides: { deletedImageUrl?: string | null; replacementImageUrl?: string | null } = {},
): FakePostgrest {
  const deleted = {
    ...deletedExpenseRow,
    image_url: "deletedImageUrl" in overrides ? overrides.deletedImageUrl : deletedExpenseRow.image_url,
  };

  return createFakePostgrest({
    rpc: (fn, args) => {
      if (fn === "create_expense") {
        const payload = args.p_payload as { client_request_id: string; title: string; image_url?: string };
        return {
          ...deletedExpenseRow,
          version: 1,
          title: payload.title,
          client_request_id: payload.client_request_id,
          image_url: payload.image_url ?? null,
        };
      }

      if (fn === "replace_expense") {
        const payload = args.p_payload as { image_url?: string };
        return {
          expense: {
            ...deletedExpenseRow,
            id: "expense_2",
            version: 1,
            image_url:
              "replacementImageUrl" in overrides ? overrides.replacementImageUrl : (payload.image_url ?? null),
          },
          previous: deleted,
        };
      }

      if (fn === "soft_delete_expense") {
        return deleted;
      }

      throw new Error(`Unexpected rpc ${fn}`);
    },
  });
}

/** A client whose write RPC raises the given sentinel, the way Postgres does. */
function makeRaisingClient(message: string): FakePostgrest {
  return createFakePostgrest({
    rpc: () => {
      throw new Error(message);
    },
  });
}

describe("createSupabaseExpenseRepository", () => {
  test("creates the expense, its payments and its shares in ONE transactional call", async () => {
    const client = makeClient();

    await createSupabaseExpenseRepository(client).createExpense(context, "group_1", validRequest);

    // This used to be 1 + N + M separate PostgREST calls with no transaction
    // around them - a failure partway through left an expense whose share set
    // was incomplete, which silently corrupts every balance in the group.
    expect(client.calls).toHaveLength(1);
    expect(client.rpcCall("create_expense")?.args).toEqual({
      p_group_id: "group_1",
      p_user_id: "user_alice",
      p_payload: validRequest,
    });
  });

  test("threads image_url through to the RPC payload", async () => {
    const client = makeClient();

    const expense = await createSupabaseExpenseRepository(client).createExpense(context, "group_1", {
      ...validRequest,
      image_url: IMAGE_URL,
    });

    expect(client.rpcCall("create_expense")?.args.p_payload).toMatchObject({ image_url: IMAGE_URL });
    expect(expense.image_url).toBe(IMAGE_URL);
  });

  test("rejects invalid expense totals before spending a round trip", async () => {
    const client = makeClient();

    await expect(
      createSupabaseExpenseRepository(client).createExpense(context, "group_1", {
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
    // The cross-group member-id check itself runs in SQL now (the FKs only
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

    const result = await createSupabaseExpenseRepository(client).replaceExpense(
      context,
      "group_1",
      "expense_1",
      validRequest,
    );

    expect(client.calls).toHaveLength(1);
    expect(client.rpcCall("replace_expense")?.args).toEqual({
      p_group_id: "group_1",
      p_user_id: "user_alice",
      p_expense_id: "expense_1",
      p_payload: validRequest,
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

  test("softDeleteExpense deletes through a single transactional call", async () => {
    const client = makeClient();

    const expense = await createSupabaseExpenseRepository(client).softDeleteExpense(
      context,
      "group_1",
      "expense_1",
      "req_delete",
    );

    // The membership gate, the version bump (which the old translated PATCH
    // silently dropped), and the client_requests write all live in the RPC.
    expect(client.calls).toHaveLength(1);
    expect(client.rpcCall("soft_delete_expense")?.args).toEqual({
      p_group_id: "group_1",
      p_user_id: "user_alice",
      p_expense_id: "expense_1",
      p_client_request_id: "req_delete",
    });
    expect(expense).toMatchObject({ id: "expense_1", version: 2 });
  });

  test("softDeleteExpense rejects a non-member with NOT_A_GROUP_MEMBER", async () => {
    const repository = createSupabaseExpenseRepository(makeRaisingClient("NOT_A_GROUP_MEMBER"));

    await expect(
      repository.softDeleteExpense(context, "group_1", "expense_1", "req_delete"),
    ).rejects.toThrow("NOT_A_GROUP_MEMBER");
  });

  describe("listing", () => {
    function makeListClient(expenses: unknown[], payments: unknown[], shares: unknown[]): FakePostgrest {
      return createFakePostgrest({
        select: (table) => {
          if (table === "expenses") return expenses;
          if (table === "expense_payments") return payments;
          if (table === "expense_shares") return shares;
          return [];
        },
      });
    }

    test("batch-fetches payments and shares for the whole page (no N+1)", async () => {
      const client = makeListClient(
        [
          { id: "expense_1", group_id: "group_1", title: "Dinner", note: "Bob paid", image_url: IMAGE_URL },
          { id: "expense_2", group_id: "group_1", title: "Payback", transfer_to_member_id: "member_bob" },
        ],
        [
          { expense_id: "expense_1", payer_member_id: "member_bob", amount_minor: 1200, currency: "TWD" },
          { expense_id: "expense_2", payer_member_id: "member_alice", amount_minor: 500, currency: "TWD" },
        ],
        [
          { expense_id: "expense_1", member_id: "member_alice", share_type: "fixed", amount_minor: 800 },
          { expense_id: "expense_1", member_id: "member_carol", share_type: "fixed", amount_minor: 400 },
        ],
      );

      const expenses = await createSupabaseExpenseRepository(client).listExpenses("group_1");

      // Three reads total, regardless of how many expenses came back.
      expect(client.calls.map((call) => ("table" in call ? call.table : ""))).toEqual([
        "expenses",
        "expense_payments",
        "expense_shares",
      ]);
      expect((client.calls[1] as { query: string }).query).toContain("expense_id=in.(expense_1,expense_2)");

      expect(expenses[0]).toMatchObject({
        id: "expense_1",
        note: "Bob paid",
        expense_payments: [{ payer_member_id: "member_bob", amount_minor: 1200, currency: "TWD" }],
        expense_shares: [
          { member_id: "member_alice", share_type: "fixed", amount_minor: 800 },
          { member_id: "member_carol", share_type: "fixed", amount_minor: 400 },
        ],
      });
      // The payer is not among expense_1's shares.
      expect(expenses[0]?.expense_shares?.some((share) => share.member_id === "member_bob")).toBe(false);
      expect(expenses[1]).toMatchObject({ id: "expense_2", expense_shares: [] });
    });

    test("skips the payments/shares reads entirely when the group has no expenses", async () => {
      const client = makeListClient([], [], []);

      await expect(createSupabaseExpenseRepository(client).listExpenses("group_empty")).resolves.toEqual([]);
      expect(client.calls).toHaveLength(1);
    });

    test("the first page is limited and ordered, with no cursor predicate", async () => {
      const client = makeListClient([], [], []);

      await createSupabaseExpenseRepository(client).listExpensesPage("group_1", { limit: 50 });

      const read = (client.calls[0] as { query: string }).query;
      expect(read).toContain("limit=50");
      expect(read).toContain("order=expense_date.desc,created_at.desc");
      expect(read).not.toContain("or=(");
    });

    test("a cursored page compares strictly, so a page boundary never repeats a row", async () => {
      const client = makeListClient([], [], []);

      await createSupabaseExpenseRepository(client).listExpensesPage("group_1", {
        limit: 50,
        cursor: { beforeDate: "2026-07-01", beforeCreatedAt: "2026-07-01T10:00:00.000Z" },
      });

      const read = (client.calls[0] as { query: string }).query;
      expect(read).toContain("or=(expense_date.lt.2026-07-01,and(expense_date.eq.2026-07-01,created_at.lt.");
      expect(read).not.toContain(".lte.");
    });

    test("clamps an oversized page request", async () => {
      const client = makeListClient([], [], []);

      await createSupabaseExpenseRepository(client).listExpensesPage("group_1", { limit: 5_000 });

      expect((client.calls[0] as { query: string }).query).toContain("limit=100");
    });
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
      const repository = createSupabaseExpenseRepository(
        makeClient({ deletedImageUrl: null }),
        storage.client,
      );

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
        makeClient({ replacementImageUrl: IMAGE_URL }),
        storage.client,
      );

      await repository.replaceExpense(context, "group_1", "expense_1", validRequest);
      await flush();

      expect(storage.deletedPaths).toEqual([]);
    });
  });
});
