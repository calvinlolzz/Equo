import { describe, expect, test } from "vitest";
import type { SupabaseQueryClient } from "./supabaseGroupRepository.js";
import { createSupabaseSettlementRepository } from "./supabaseSettlementRepository.js";

const context = {
  user: {
    id: "user_alice",
    google_sub: "google-alice",
    email: "alice@example.com",
    display_name: "Alice",
  },
};

function makeClient(settlementVersion = 3): SupabaseQueryClient & { calls: Array<{ method: string; sql: string; params: unknown[] }> } {
  const calls: Array<{ method: string; sql: string; params: unknown[] }> = [];

  return {
    calls,
    async one(sql, params) {
      calls.push({ method: "one", sql, params });

      if (sql.includes("from public.group_members")) {
        return { id: "member_alice" } as never;
      }

      if (sql.includes("from public.group_member_balances")) {
        return [
          { memberId: "member_alice", balance: { amount_minor: 600, currency: "TWD" } },
          { memberId: "member_bob", balance: { amount_minor: -600, currency: "TWD" } },
        ] as never;
      }

      // The settlement row and all of its transfers are written by one
      // transactional RPC. It used to be an insert of the settlement followed by
      // one insert per transfer, each its own PostgREST call - a failure partway
      // through left a settlement carrying only some of its transfers, which
      // under-settles the group with nothing to show that it did.
      if (sql.includes("select public.create_settlement(")) {
        return {
          id: "settlement_1",
          group_id: params[0],
          settlement_version: params[2],
          calculated_version: params[3],
          status: "draft",
        } as never;
      }

      if (sql.includes("select id, group_id, settlement_version")) {
        return {
          id: params[1],
          group_id: params[0],
          settlement_version: settlementVersion,
          calculated_version: 2,
          status: "draft",
        } as never;
      }

      if (sql.includes("update public.settlements")) {
        return {
          id: params[1],
          group_id: params[0],
          settlement_version: params[2],
          calculated_version: 2,
          status: "confirmed",
        } as never;
      }

      throw new Error(`Unexpected one query: ${sql}`);
    },
    async maybeOne(sql) {
      if (sql.includes("from public.group_members")) {
        return { id: "member_alice" } as never;
      }

      return null;
    },
    async exec(sql, params) {
      calls.push({ method: "exec", sql, params });
    },
  };
}

/**
 * A client whose calls behave the way they do for a caller with no active
 * membership: the balances read comes back empty, and the create_settlement RPC
 * raises NOT_A_GROUP_MEMBER (the membership gate now lives in SQL, alongside the
 * write it guards, instead of in a separate query that raced it).
 */
function makeNonMemberClient(): SupabaseQueryClient {
  return {
    async one(sql) {
      if (sql.includes("from public.group_member_balances")) {
        return [] as never;
      }

      throw new Error("NOT_A_GROUP_MEMBER");
    },
    async maybeOne() {
      return null;
    },
    async exec() {},
  };
}

describe("createSupabaseSettlementRepository", () => {
  test("persists calculated settlement transfers", async () => {
    const client = makeClient();
    const repository = createSupabaseSettlementRepository(client);

    const result = await repository.calculateCurrentSettlement(context, "group_1");

    expect(result.transfers).toEqual([
      {
        fromMemberId: "member_bob",
        toMemberId: "member_alice",
        amount: { amount_minor: 600, currency: "TWD" },
      },
    ]);
    // One call carries the settlement AND its transfers.
    const create = client.calls.find((call) => call.sql.includes("select public.create_settlement("));
    expect(create?.params[4]).toEqual([
      { from_member_id: "member_bob", to_member_id: "member_alice", amount_minor: 600, currency: "TWD" },
    ]);
    expect(client.calls.some((call) => call.sql.includes("insert into public.settlement_transfers"))).toBe(false);
  });

  test("stores settlement_version inside Postgres integer range", async () => {
    const client = makeClient();
    const repository = createSupabaseSettlementRepository(client);

    await repository.calculateCurrentSettlement(context, "group_1");

    const create = client.calls.find((call) => call.sql.includes("select public.create_settlement("));
    expect(create?.params[2]).toBeLessThanOrEqual(2_147_483_647);
  });

  test("rejects confirmation when settlement_version differs", async () => {
    const client = makeClient(4);
    const repository = createSupabaseSettlementRepository(client);

    await expect(
      repository.confirmSettlement(context, "group_1", "settlement_1", {
        client_request_id: "req_settle",
        settlement_version: 3,
      }),
    ).rejects.toThrow("SETTLEMENT_VERSION_CONFLICT");
  });

  test("rejects calculateCurrentSettlement when the caller has no active membership", async () => {
    const repository = createSupabaseSettlementRepository(makeNonMemberClient());

    await expect(repository.calculateCurrentSettlement(context, "group_1")).rejects.toThrow(
      "NOT_A_GROUP_MEMBER",
    );
  });

  test("rejects confirmSettlement when the caller has no active membership", async () => {
    const repository = createSupabaseSettlementRepository(makeNonMemberClient());

    await expect(
      repository.confirmSettlement(context, "group_1", "settlement_1", {
        client_request_id: "req_settle",
        settlement_version: 3,
      }),
    ).rejects.toThrow("NOT_A_GROUP_MEMBER");
  });
});
