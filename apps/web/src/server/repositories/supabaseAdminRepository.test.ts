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

  test("passes search/limit/offset through to the user listing", async () => {
    const client = makeClient({ total: 1, users: [] });

    await createSupabaseAdminRepository(client).listUsers("alice", 20, 40);

    expect(client.rpcCall("admin_console_users")?.args).toEqual({
      p_search: "alice",
      p_limit: 20,
      p_offset: 40,
    });
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

  test("paginated log readers forward limit and offset", async () => {
    const client = makeClient({ total: 0, logs: [] });
    const repository = createSupabaseAdminRepository(client);

    await repository.listAuditLogs(50, 100);
    expect(client.rpcCall("admin_console_audit_logs")?.args).toEqual({ p_limit: 50, p_offset: 100 });

    await repository.listErrors(10, 0);
    expect(client.rpcCall("admin_console_errors")?.args).toEqual({ p_limit: 10, p_offset: 0 });

    await repository.listFeedback(10, 0, "open");
    expect(client.rpcCall("admin_console_feedback")?.args).toEqual({
      p_limit: 10,
      p_offset: 0,
      p_status: "open",
    });
  });
});
