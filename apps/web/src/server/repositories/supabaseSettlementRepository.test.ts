import { describe, expect, test } from "vitest";
import { createFakePostgrest, type FakePostgrest } from "../db/fakePostgrest.js";
import { createSupabaseSettlementRepository } from "./supabaseSettlementRepository.js";

const context = {
  user: {
    id: "user_alice",
    google_sub: "google-alice",
    email: "alice@example.com",
    display_name: "Alice",
  },
};

const balanceRows = [
  { member_id: "member_alice", balance_minor: 600, currency: "TWD" },
  { member_id: "member_bob", balance_minor: -600, currency: "TWD" },
];

function makeClient(settlementVersion = 3): FakePostgrest {
  return createFakePostgrest({
    select: (table) => {
      if (table === "group_member_balances") return balanceRows;
      if (table === "group_members") return [{ id: "member_alice" }];
      if (table === "settlements") {
        return [
          {
            id: "settlement_1",
            group_id: "group_1",
            settlement_version: settlementVersion,
            calculated_version: 2,
            status: "draft",
          },
        ];
      }
      return [];
    },
    update: () => [
      {
        id: "settlement_1",
        group_id: "group_1",
        settlement_version: settlementVersion,
        calculated_version: 2,
        status: "confirmed",
      },
    ],
    rpc: (fn, args) => {
      if (fn === "create_settlement") {
        return {
          id: "settlement_1",
          group_id: args.p_group_id,
          settlement_version: args.p_settlement_version,
          calculated_version: args.p_calculated_version,
          status: "draft",
        };
      }
      throw new Error(`Unexpected rpc ${fn}`);
    },
  });
}

describe("createSupabaseSettlementRepository", () => {
  test("listBalances maps the view's rows into the domain shape", async () => {
    const client = makeClient();

    await expect(createSupabaseSettlementRepository(client).listBalances("group_1")).resolves.toEqual([
      { memberId: "member_alice", balance: { amount_minor: 600, currency: "TWD" } },
      { memberId: "member_bob", balance: { amount_minor: -600, currency: "TWD" } },
    ]);
  });

  test("writes the settlement and ALL of its transfers in one transactional call", async () => {
    const client = makeClient();

    const result = await createSupabaseSettlementRepository(client).calculateCurrentSettlement(
      context,
      "group_1",
    );

    expect(result.transfers).toEqual([
      { fromMemberId: "member_bob", toMemberId: "member_alice", amount: { amount_minor: 600, currency: "TWD" } },
    ]);
    // It used to be an insert of the settlement followed by one insert per
    // transfer, each its own call - a partial failure produced a settlement that
    // under-settles the group, with nothing to show that it had.
    expect(client.rpcCall("create_settlement")?.args.p_transfers).toEqual([
      { from_member_id: "member_bob", to_member_id: "member_alice", amount_minor: 600, currency: "TWD" },
    ]);
    expect(client.calls.some((call) => "table" in call && call.table === "settlement_transfers")).toBe(false);
  });

  test("settlement_version stays inside the Postgres integer range", async () => {
    const client = makeClient();

    await createSupabaseSettlementRepository(client).calculateCurrentSettlement(context, "group_1");

    // Seconds, not milliseconds: Date.now() overflows int4.
    expect(client.rpcCall("create_settlement")?.args.p_settlement_version).toBeLessThanOrEqual(2_147_483_647);
  });

  test("rejects calculateCurrentSettlement when the caller has no active membership", async () => {
    const client = createFakePostgrest({
      select: () => [],
      rpc: () => {
        throw new Error("NOT_A_GROUP_MEMBER");
      },
    });

    await expect(
      createSupabaseSettlementRepository(client).calculateCurrentSettlement(context, "group_1"),
    ).rejects.toThrow("NOT_A_GROUP_MEMBER");
  });

  test("rejects confirmation when the settlement_version differs (someone else confirmed first)", async () => {
    const client = makeClient(4);

    await expect(
      createSupabaseSettlementRepository(client).confirmSettlement(context, "group_1", "settlement_1", {
        client_request_id: "req_settle",
        settlement_version: 3,
      }),
    ).rejects.toThrow("SETTLEMENT_VERSION_CONFLICT");
  });

  test("confirm carries the version into the write filter, not just the pre-check", async () => {
    const client = makeClient(3);

    await createSupabaseSettlementRepository(client).confirmSettlement(context, "group_1", "settlement_1", {
      client_request_id: "req_settle",
      settlement_version: 3,
    });

    // The read-then-write above is not atomic on its own; the version in the
    // PATCH filter is what makes a concurrent confirm match nothing.
    const write = client.calls.find((call) => call.op === "update") as { query: string; body: unknown };
    expect(write.query).toContain("settlement_version=eq.3");
    expect(write.body).toMatchObject({ status: "confirmed" });
  });

  test("rejects confirmSettlement when the caller has no active membership", async () => {
    const client = createFakePostgrest({ select: () => [] });

    await expect(
      createSupabaseSettlementRepository(client).confirmSettlement(context, "group_1", "settlement_1", {
        client_request_id: "req_settle",
        settlement_version: 3,
      }),
    ).rejects.toThrow("NOT_A_GROUP_MEMBER");
  });
});
