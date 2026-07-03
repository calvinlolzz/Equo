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

      if (sql.includes("insert into public.settlements")) {
        return {
          id: "settlement_1",
          group_id: params[0],
          settlement_version: params[1],
          calculated_version: params[2],
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
    async maybeOne() {
      return null;
    },
    async exec(sql, params) {
      calls.push({ method: "exec", sql, params });
    },
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
    expect(client.calls.some((call) => call.sql.includes("insert into public.settlement_transfers"))).toBe(true);
  });

  test("stores settlement_version inside Postgres integer range", async () => {
    const client = makeClient();
    const repository = createSupabaseSettlementRepository(client);

    await repository.calculateCurrentSettlement(context, "group_1");

    const settlementInsert = client.calls.find((call) => call.sql.includes("insert into public.settlements"));
    expect(settlementInsert?.params[1]).toBeLessThanOrEqual(2_147_483_647);
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
});
