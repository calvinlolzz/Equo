import { describe, expect, test } from "vitest";
import { createFakePostgrest } from "../db/fakePostgrest.js";
import { createSupabasePersonalSharesRepository, createSupabaseSpendRepository } from "./supabaseSpendRepository.js";

describe("createSupabaseSpendRepository", () => {
  test("calls get_spend_breakdown with the p_* argument names the RPC expects", async () => {
    const client = createFakePostgrest({ rpc: () => null });

    await createSupabaseSpendRepository(client).getSpendBreakdown("user_1", "group_1", "month", "2026-08");

    expect(client.rpcCall("get_spend_breakdown")?.args).toEqual({
      p_group_id: "group_1",
      p_user_id: "user_1",
      p_period_kind: "month",
      p_period_key: "2026-08",
    });
  });

  test("a null RPC result stays null", async () => {
    const client = createFakePostgrest({ rpc: () => null });

    await expect(
      createSupabaseSpendRepository(client).getSpendBreakdown("user_1", "group_1", "year", null),
    ).resolves.toBeNull();
  });
});

describe("createSupabasePersonalSharesRepository", () => {
  test("calls personal_month_group_shares with the p_* argument names the RPC expects", async () => {
    const client = createFakePostgrest({ rpc: () => null });

    await createSupabasePersonalSharesRepository(client).getMonthGroupShares("user_1", "2026-09");

    expect(client.rpcCall("personal_month_group_shares")?.args).toEqual({
      p_user: "user_1",
      p_month: "2026-09",
    });
  });

  test("a null RPC result stays null", async () => {
    const client = createFakePostgrest({ rpc: () => null });

    await expect(
      createSupabasePersonalSharesRepository(client).getMonthGroupShares("user_1", "2026-09"),
    ).resolves.toBeNull();
  });
});
