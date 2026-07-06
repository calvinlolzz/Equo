import { describe, expect, test } from "vitest";
import type { AuthenticatedContext } from "../auth/session.js";
import { createSupabaseExpenseRepository } from "../repositories/supabaseExpenseRepository.js";
import { createSupabaseGroupRepository } from "../repositories/supabaseGroupRepository.js";
import type { SupabaseQueryClient } from "../repositories/supabaseGroupRepository.js";
import { createSupabaseSettlementRepository } from "../repositories/supabaseSettlementRepository.js";
import { createSupabaseRestQueryClient } from "./supabaseQueryClient.js";

/**
 * WHY THIS TEST EXISTS
 * ---------------------
 * createSupabaseRestQueryClient (supabaseQueryClient.ts) doesn't run real SQL -
 * it pattern-matches the SQL string each repository emits and translates it
 * into a Supabase PostgREST call by hand. There is no database or query
 * parser in the loop, so a repository query with no matching `if
 * (normalized.includes(...))` branch falls through to the final
 * `throw new Error("Unsupported Supabase REST SQL operation: ...")` - which,
 * in production, surfaces as an unhandled 500.
 *
 * This exact failure shipped once already: a repository query selecting
 * expense_payments via `where expense_id = any($1)` had no translator branch,
 * so every request that hit it 500'd in production until the branch was
 * added. Nothing in the type system catches this class of bug, because the
 * repository and the translator are only connected by a raw SQL string at
 * runtime - a new repository query compiles fine and passes its own repo-level
 * unit tests (which use a hand-rolled fake client, not the real translator),
 * and only breaks when it actually reaches createSupabaseRestQueryClient in
 * production.
 *
 * This test closes that gap by exercising EVERY method on every Supabase
 * repository against a recording fake client, capturing every SQL string the
 * app can currently emit, and then replaying each one through the real
 * createSupabaseRestQueryClient. If any of them falls through to the
 * "Unsupported Supabase REST SQL operation" branch, this test fails loudly -
 * so adding a new repository query without a matching translator branch can
 * never silently ship again.
 */

type RecordedCall = {
  mode: "one" | "maybeOne" | "exec";
  sql: string;
  params: unknown[];
};

function createRecordingClient(): SupabaseQueryClient & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];

  // Generic dummy row shape that satisfies every repository's expectations
  // well enough to let the call complete without throwing inside the
  // repository itself (we only care that the SQL reaches the translator).
  const dummyRow = {
    id: "row_1",
    group_id: "group_1",
    user_id: "user_1",
    display_name: "Dummy",
    role: "owner",
    status: "active",
    name: "Dummy Group",
    currency: "TWD",
    owner_member_id: "member_1",
    cover_image_url: null,
    archived_at: null,
    token_hash: "hash_1",
    max_uses: 5,
    use_count: 0,
    expires_at: null,
    title: "Dummy expense",
    kind: "expense",
    category: "general",
    amount_minor: 100,
    expense_date: "2026-07-01",
    created_at: "2026-07-01T00:00:00.000Z",
    version: 1,
    client_request_id: "req_1",
    image_url: null,
    settlement_version: 1,
    calculated_version: 1,
    member_id: "member_1",
    balance_minor: 0,
    memberId: "member_1",
    balance: { amount_minor: 0, currency: "TWD" },
  };

  return {
    calls,
    async one(sql, params) {
      calls.push({ mode: "one", sql, params });
      // Arrays are the right shape for list-returning queries; a single
      // dummy row is close enough for scalar-returning queries. Repositories
      // only destructure a handful of known fields, all present above.
      // Queries that return a list (as opposed to a single inserted/updated
      // row) all select FROM a table without an "insert"/"update" - detect
      // that plus a couple of known array-shaped exceptions.
      const normalized = sql.toLowerCase();
      const isListQuery =
        (normalized.includes("select") && normalized.includes(" from ") && !normalized.includes("insert into") && !normalized.includes("update ")) ||
        normalized.includes("group_member_balances");
      if (isListQuery) {
        return [dummyRow] as never;
      }
      return dummyRow as never;
    },
    async maybeOne(sql, params) {
      calls.push({ mode: "maybeOne", sql, params });
      return dummyRow as never;
    },
    async exec(sql, params) {
      calls.push({ mode: "exec", sql, params });
    },
  };
}

const authContext: AuthenticatedContext = {
  user: { id: "user_1", google_sub: "google_1", email: "alice@example.com", display_name: "Alice" },
};

async function invokeEveryGroupRepositoryMethod(client: SupabaseQueryClient) {
  const repo = createSupabaseGroupRepository(client);

  await repo.listGroups(authContext);
  await repo.listArchivedGroups(authContext);
  await repo.listMembers("group_1");
  await repo.getGroupDetail(authContext, "group_1");
  await repo.createGroup(authContext, { client_request_id: "req_1", name: "Trip", currency: "TWD" });
  await repo.updateGroup("group_1", { client_request_id: "req_2", name: "Trip 2" });
  await repo.archiveGroup("group_1");
  await repo.unarchiveGroup("group_1");
  await repo.deleteGroup("group_1");
  await repo.createVirtualMember("group_1", "Bob");
  await repo.renameVirtualMember("group_1", "member_2", "Bobby");
  await repo.removeVirtualMember("group_1", "member_2");
  await repo.findActiveMember("group_1", "user_1");
  await repo.findMemberById("group_1", "member_2");
  await repo.getMemberBalanceMinor("group_1", "member_2");
  await repo.createInvite(authContext, "group_1", { client_request_id: "req_3", max_uses: 5 });
  await repo
    .acceptInvite(authContext, "EQO123456", { client_request_id: "req_4", display_name: "Guest" })
    .catch(() => {});
  await repo.hashInviteToken("EQO123456");
  await repo.findInviteByTokenHash("sha256:EQO123456");
  await repo.recordClientRequest("group_1", "req_5", "resource_1");
}

async function invokeEveryExpenseRepositoryMethod(client: SupabaseQueryClient) {
  const repo = createSupabaseExpenseRepository(client);

  const createRequest = {
    client_request_id: "req_expense_1",
    title: "Dinner",
    kind: "expense" as const,
    category: "food",
    amount_minor: 1000,
    currency: "TWD" as const,
    expense_date: "2026-07-01",
    expense_payments: [{ payer_member_id: "member_1", amount_minor: 1000, currency: "TWD" as const }],
    expense_shares: [{ member_id: "member_1", share_type: "fixed" as const, amount_minor: 1000 }],
  };

  await repo.createExpense(authContext, "group_1", createRequest);
  await repo.listExpenses("group_1");
  await repo.softDeleteExpense("group_1", "expense_1", "req_expense_2");
  await repo.recordClientRequest("group_1", "req_expense_3", "resource_1");
}

async function invokeEverySettlementRepositoryMethod(client: SupabaseQueryClient) {
  const repo = createSupabaseSettlementRepository(client);

  await repo.listBalances("group_1");
  await repo.calculateCurrentSettlement(authContext, "group_1");
  await repo
    .confirmSettlement(authContext, "group_1", "settlement_1", { client_request_id: "req_settle_1", settlement_version: 1 })
    .catch(() => {});
}

describe("Supabase REST query translator coverage", () => {
  test("every repository SQL string the app can emit is translated by createSupabaseRestQueryClient", async () => {
    const recordingClient = createRecordingClient();

    await invokeEveryGroupRepositoryMethod(recordingClient);
    await invokeEveryExpenseRepositoryMethod(recordingClient);
    await invokeEverySettlementRepositoryMethod(recordingClient);

    expect(recordingClient.calls.length).toBeGreaterThan(0);

    const restClient = createSupabaseRestQueryClient({
      url: "https://example.supabase.co",
      serviceRoleKey: "service-role-key",
      fetcher: async () =>
        ({
          ok: true,
          status: 200,
          json: async () => [
            {
              id: "row_1",
              group_id: "group_1",
              user_id: "user_1",
              display_name: "Dummy",
              role: "owner",
              status: "active",
              name: "Dummy Group",
              currency: "TWD",
              owner_member_id: "member_1",
              cover_image_url: null,
              google_sub: "google_1",
              email: "alice@example.com",
              revoked_at: null,
              max_uses: 5,
              use_count: 0,
              expires_at: null,
              member_id: "member_1",
              balance_minor: 0,
            },
          ],
        }) as unknown as Response,
    });

    const unsupportedOperations: string[] = [];

    for (const call of recordingClient.calls) {
      try {
        if (call.mode === "one") {
          await restClient.one(call.sql, call.params);
        } else if (call.mode === "maybeOne") {
          await restClient.maybeOne(call.sql, call.params);
        } else {
          await restClient.exec(call.sql, call.params);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.includes("Unsupported Supabase REST SQL operation")) {
          unsupportedOperations.push(`${call.mode}: ${call.sql.trim().slice(0, 120)}`);
        }
        // Any other error (e.g. "returned no rows", a thrown business-logic
        // error from the repository like SETTLEMENT_VERSION_CONFLICT, or a
        // shape mismatch on our generic dummy row) is fine here - this test
        // only cares whether the translator recognized the SQL shape, not
        // whether the full round-trip produces a perfectly valid response.
      }
    }

    if (unsupportedOperations.length > 0) {
      throw new Error(
        `createSupabaseRestQueryClient has no translator branch for ${unsupportedOperations.length} ` +
          `repository quer${unsupportedOperations.length === 1 ? "y" : "ies"} - add a matching branch in ` +
          `supabaseQueryClient.ts. Unmatched calls:\n${unsupportedOperations.join("\n")}`,
      );
    }
  });
});
