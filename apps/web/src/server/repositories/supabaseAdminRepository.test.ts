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

  test("listGroups forwards search, limit, offset, filter positionally", async () => {
    const client = makeClient({ total: 0, groups: [] });
    const repository = createSupabaseAdminRepository(client);

    await repository.listGroups("trip", 10, 0, "deleted");

    expect(client.calls[0].sql).toContain("admin_console_groups");
    expect(client.calls[0].params).toEqual(["trip", 10, 0, "deleted"]);
  });

  const actor = { id: "user_admin", email: "admin@example.com" };

  test("setUserDisabled forwards actor identity and the disabled flag", async () => {
    const client = makeClient({ id: "user_alice", disabled_at: "2026-07-11T00:00:00.000Z" });
    const repository = createSupabaseAdminRepository(client);

    const result = await repository.setUserDisabled(actor, "user_alice", true);

    expect(result).toEqual({ id: "user_alice", disabled_at: "2026-07-11T00:00:00.000Z" });
    expect(client.calls[0].mode).toBe("maybeOne");
    expect(client.calls[0].sql).toContain("admin_console_set_user_disabled");
    expect(client.calls[0].params).toEqual(["user_admin", "admin@example.com", "user_alice", true]);
  });

  test("setGroupArchived and setGroupDeleted forward actor and flags", async () => {
    const client = makeClient({ id: "group_1", archived_at: null, deleted_at: null });
    const repository = createSupabaseAdminRepository(client);

    await repository.setGroupArchived(actor, "group_1", true);
    await repository.setGroupDeleted(actor, "group_1", false);

    expect(client.calls[0].sql).toContain("admin_console_set_group_archived");
    expect(client.calls[0].params).toEqual(["user_admin", "admin@example.com", "group_1", true]);
    expect(client.calls[1].sql).toContain("admin_console_set_group_deleted");
    expect(client.calls[1].params).toEqual(["user_admin", "admin@example.com", "group_1", false]);
  });

  test("listAuditLogs forwards limit and offset positionally", async () => {
    const client = makeClient({ total: 0, logs: [] });
    const repository = createSupabaseAdminRepository(client);

    await repository.listAuditLogs(20, 40);

    expect(client.calls[0].sql).toContain("admin_console_audit_logs");
    expect(client.calls[0].params).toEqual([20, 40]);
  });

  test("group write operations pass null through for missing groups", async () => {
    const repository = createSupabaseAdminRepository(makeClient(null));

    await expect(repository.setGroupArchived(actor, "group_missing", true)).resolves.toBeNull();
    await expect(repository.setGroupDeleted(actor, "group_missing", true)).resolves.toBeNull();
    await expect(repository.setUserDisabled(actor, "user_missing", true)).resolves.toBeNull();
  });
});
