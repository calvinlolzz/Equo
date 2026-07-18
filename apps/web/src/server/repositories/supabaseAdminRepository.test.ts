import { describe, expect, test } from "vitest";
import { createFakePostgrest } from "../db/fakePostgrest.js";
import { createSupabaseAdminRepository } from "./supabaseAdminRepository.js";

const actor = { id: "user_admin", email: "admin@example.com" };

/**
 * Admin reads and writes go through admin_console_* Postgres functions rather
 * than table access: the reads are cross-table aggregates PostgREST can't
 * express, and the writes have to record their audit-log row in the same
 * transaction as the change they audit. So every one of these is an rpc call,
 * and what matters is the function name and the argument mapping.
 */
function makeClient(result: unknown = { total: 0, users: [] }) {
  return createFakePostgrest({ rpc: () => result });
}

describe("createSupabaseAdminRepository", () => {
  test("resolves the caller's admin role, collapsing a missing role to null", async () => {
    const client = makeClient(null);

    await expect(createSupabaseAdminRepository(client).findAdminRole("user_1")).resolves.toBeNull();
    expect(client.rpcCall("admin_console_role")?.args).toEqual({ p_user_id: "user_1" });
  });

  test("reads bucket stats through the storage RPC, no args", async () => {
    const client = makeClient({ object_count: 13, total_bytes: 861938, orphan_count: 0, orphan_bytes: 0 });

    const result = await createSupabaseAdminRepository(client).getStorage();

    expect(result.object_count).toBe(13);
    expect(client.rpcCall("admin_console_storage")?.args).toEqual({});
  });

  test("reads the admin roster with no args", async () => {
    const client = makeClient([{ user_id: "u1", role: "owner" }]);

    await createSupabaseAdminRepository(client).listAdmins();

    expect(client.rpcCall("admin_console_admins")?.args).toEqual({});
  });

  test("grants an admin role keyed by email, carrying the actor", async () => {
    const client = makeClient({ ok: true, admin: {} });

    await createSupabaseAdminRepository(client).setAdminRole(actor, "bob@example.com", "support");

    expect(client.rpcCall("admin_console_set_admin_role")?.args).toEqual({
      p_actor: "user_admin",
      p_actor_email: "admin@example.com",
      p_target_email: "bob@example.com",
      p_role: "support",
    });
  });

  test("removes an admin keyed by user id, carrying the actor", async () => {
    const client = makeClient({ ok: true, user_id: "user_bob" });

    await createSupabaseAdminRepository(client).removeAdmin(actor, "user_bob");

    expect(client.rpcCall("admin_console_remove_admin")?.args).toEqual({
      p_actor: "user_admin",
      p_actor_email: "admin@example.com",
      p_user_id: "user_bob",
    });
  });

  test("passes search/limit/offset through to the user listing", async () => {
    const client = makeClient({ total: 1, users: [] });

    await createSupabaseAdminRepository(client).listUsers("alice", 20, 40);

    expect(client.rpcCall("admin_console_users")?.args).toEqual({
      p_search: "alice",
      p_limit: 20,
      p_offset: 40,
    });
  });

  test("passes the actor through to the group detail read, which audits it", async () => {
    const client = makeClient({ group: {}, members: [] });

    await createSupabaseAdminRepository(client).getGroupDetail(actor, "group_1");

    expect(client.rpcCall("admin_console_group_detail")?.args).toEqual({
      p_actor: "user_admin",
      p_actor_email: "admin@example.com",
      p_group_id: "group_1",
    });
  });

  test("collapses a missing group to null on the detail read", async () => {
    const client = makeClient(null);

    await expect(createSupabaseAdminRepository(client).getGroupDetail(actor, "group_missing")).resolves.toBeNull();
  });

  test("passes the actor and include-deleted flag through to the expense listing", async () => {
    const client = makeClient({ total: 0, expenses: [] });

    await createSupabaseAdminRepository(client).listGroupExpenses(actor, "group_1", 20, 40, true);

    expect(client.rpcCall("admin_console_group_expenses")?.args).toEqual({
      p_actor: "user_admin",
      p_actor_email: "admin@example.com",
      p_group_id: "group_1",
      p_limit: 20,
      p_offset: 40,
      p_include_deleted: true,
    });
  });

  test("collapses a missing group to null on the expense listing", async () => {
    const client = makeClient(null);

    await expect(
      createSupabaseAdminRepository(client).listGroupExpenses(actor, "group_missing", 20, 0, false),
    ).resolves.toBeNull();
  });

  test("passes the group filter through alongside the pagination", async () => {
    const client = makeClient({ total: 0, groups: [] });

    await createSupabaseAdminRepository(client).listGroups("trip", 20, 0, "archived");

    expect(client.rpcCall("admin_console_groups")?.args).toEqual({
      p_search: "trip",
      p_limit: 20,
      p_offset: 0,
      p_filter: "archived",
    });
  });

  test("every state-changing admin call carries the actor, so the audit row can name them", async () => {
    const client = makeClient({ id: "x" });
    const repository = createSupabaseAdminRepository(client);

    await repository.setUserDisabled(actor, "user_2", true);
    await repository.setGroupArchived(actor, "group_1", true);
    await repository.setGroupDeleted(actor, "group_1", true);
    await repository.setFeedbackStatus(actor, "fb_1", "done");

    for (const call of client.calls) {
      expect(call).toMatchObject({
        op: "rpc",
        args: { p_actor: "user_admin", p_actor_email: "admin@example.com" },
      });
    }
    expect(client.calls.map((call) => (call.op === "rpc" ? call.fn : ""))).toEqual([
      "admin_console_set_user_disabled",
      "admin_console_set_group_archived",
      "admin_console_set_group_deleted",
      "admin_console_set_feedback_status",
    ]);
  });

  test("collapses a null RPC result to null rather than returning undefined", async () => {
    const repository = createSupabaseAdminRepository(makeClient(null));

    await expect(repository.getUserDetail("user_1")).resolves.toBeNull();
    await expect(repository.setUserDisabled(actor, "user_1", true)).resolves.toBeNull();
    await expect(repository.setGroupArchived(actor, "group_1", true)).resolves.toBeNull();
  });

  test("paginated log readers forward their search/filter params", async () => {
    const client = makeClient({ total: 0, logs: [] });
    const repository = createSupabaseAdminRepository(client);

    await repository.listAuditLogs("alice", "group.delete", 50, 100);
    expect(client.rpcCall("admin_console_audit_logs")?.args).toEqual({
      p_search: "alice",
      p_action: "group.delete",
      p_limit: 50,
      p_offset: 100,
    });

    await repository.listErrors("boom", 10, 0);
    expect(client.rpcCall("admin_console_errors")?.args).toEqual({ p_search: "boom", p_limit: 10, p_offset: 0 });

    await repository.listFeedback(10, 0, "open");
    expect(client.rpcCall("admin_console_feedback")?.args).toEqual({
      p_limit: 10,
      p_offset: 0,
      p_status: "open",
    });
  });
});
