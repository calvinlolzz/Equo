import { describe, expect, test } from "vitest";
import { createSupabaseAdminRepository } from "./supabaseAdminRepository.js";
import type { SupabaseQueryClient } from "./supabaseGroupRepository.js";

type RecordedCall = {
  mode: "one" | "maybeOne" | "exec";
  sql: string;
  params: unknown[];
};

function makeClient(result: unknown): SupabaseQueryClient & { calls: RecordedCall[] } {
  const calls: RecordedCall[] = [];

  return {
    calls,
    async one(sql, params) {
      calls.push({ mode: "one", sql, params });
      return result as never;
    },
    async maybeOne(sql, params) {
      calls.push({ mode: "maybeOne", sql, params });
      return result as never;
    },
    async exec(sql, params) {
      calls.push({ mode: "exec", sql, params });
    },
  };
}

describe("supabase admin repository", () => {
  test("findAdminRole calls admin_console_role and maps null to null", async () => {
    const client = makeClient(null);
    const repository = createSupabaseAdminRepository(client);

    const role = await repository.findAdminRole("user_1");

    expect(role).toBeNull();
    expect(client.calls).toHaveLength(1);
    expect(client.calls[0].mode).toBe("maybeOne");
    expect(client.calls[0].sql).toContain("admin_console_role");
    expect(client.calls[0].params).toEqual(["user_1"]);
  });

  test("findAdminRole returns the role string when present", async () => {
    const repository = createSupabaseAdminRepository(makeClient("owner"));

    await expect(repository.findAdminRole("user_1")).resolves.toBe("owner");
  });

  test("getOverview calls admin_console_overview with no params", async () => {
    const overview = { user_count: 1 };
    const client = makeClient(overview);
    const repository = createSupabaseAdminRepository(client);

    await expect(repository.getOverview()).resolves.toBe(overview);
    expect(client.calls[0].sql).toContain("admin_console_overview");
    expect(client.calls[0].params).toEqual([]);
  });

  test("listUsers forwards search, limit, offset positionally", async () => {
    const client = makeClient({ total: 0, users: [] });
    const repository = createSupabaseAdminRepository(client);

    await repository.listUsers("alice", 20, 40);

    expect(client.calls[0].sql).toContain("admin_console_users");
    expect(client.calls[0].params).toEqual(["alice", 20, 40]);
  });

  test("getUserDetail calls admin_console_user_detail and passes null through", async () => {
    const client = makeClient(null);
    const repository = createSupabaseAdminRepository(client);

    await expect(repository.getUserDetail("user_missing")).resolves.toBeNull();
    expect(client.calls[0].sql).toContain("admin_console_user_detail");
    expect(client.calls[0].params).toEqual(["user_missing"]);
  });

  test("listGroups forwards search, limit, offset positionally", async () => {
    const client = makeClient({ total: 0, groups: [] });
    const repository = createSupabaseAdminRepository(client);

    await repository.listGroups("trip", 10, 0);

    expect(client.calls[0].sql).toContain("admin_console_groups");
    expect(client.calls[0].params).toEqual(["trip", 10, 0]);
  });
});
