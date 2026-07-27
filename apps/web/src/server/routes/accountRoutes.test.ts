import { describe, expect, test } from "vitest";
import { deleteMyAccountRoute } from "./accountRoutes.js";
import { createFakePostgrest } from "../db/fakePostgrest.js";

// Marks the identity already-resolved so requireAuthenticatedUser skips the
// upsert round-trip and only the account-state probe (users) is needed.
const verifier = async (idToken: string) => ({
  auth_user_id: idToken,
  google_sub: idToken,
  email: "alice@example.com",
  display_name: "Alice",
  resolved_user_id: idToken,
});

/** A client whose account-state probe passes and whose RPC returns `rpcResult`. */
function makeClient(rpcResult: unknown, deletedAt: string | null = null) {
  return createFakePostgrest({
    select: (table) => (table === "users" ? [{ id: "user_alice", deleted_at: deletedAt }] : []),
    rpc: () => rpcResult,
  });
}

describe("deleteMyAccountRoute", () => {
  test("erases the caller's own account and clears the session cookie", async () => {
    const client = makeClient({ ok: true, groups_reassigned: 1, groups_deleted: 2, memberships_anonymized: 3 });

    const result = await deleteMyAccountRoute({ client, verifier, idToken: "user_alice" });

    expect(result.status).toBe(200);
    expect(result.ok && result.body).toEqual({ ok: true });
    // The still-valid 7-day cookie must stop working immediately.
    expect("headers" in result && result.headers?.["set-cookie"]).toContain("Max-Age=0");
  });

  test("passes the authenticated caller's own id to the RPC, never a request value", async () => {
    const client = makeClient({ ok: true });

    await deleteMyAccountRoute({ client, verifier, idToken: "user_alice" });

    expect(client.rpcCall("delete_my_account")?.args).toEqual({ p_user: "user_alice" });
  });

  test("refuses with 409 when the caller is the last admin-console owner", async () => {
    const client = makeClient({ ok: false, reason: "last_admin_owner" });

    const result = await deleteMyAccountRoute({ client, verifier, idToken: "user_alice" });

    expect(result.status).toBe(409);
    if (result.ok) throw new Error("expected the last-owner refusal to fail");
    expect(result.body.error?.code).toBe("ACCOUNT_DELETE_BLOCKED");
    // Nothing was torn down, so no cookie clear.
    expect("headers" in result).toBe(false);
  });

  test("rejects an unauthenticated caller with 401 and never calls the RPC", async () => {
    const client = makeClient({ ok: true });

    const result = await deleteMyAccountRoute({ client, verifier: async () => null, idToken: "" });

    expect(result.status).toBe(401);
    if (result.ok) throw new Error("expected an unauthenticated caller to be refused");
    expect(result.body.error?.code).toBe("UNAUTHENTICATED");
    expect(client.rpcCall("delete_my_account")).toBeUndefined();
  });

  test("refuses a disabled account before deleting anything", async () => {
    const client = makeClient({ ok: true }, "2026-07-01T00:00:00Z");

    const result = await deleteMyAccountRoute({ client, verifier, idToken: "user_alice" });

    expect(result.status).toBe(401);
    expect(client.rpcCall("delete_my_account")).toBeUndefined();
  });
});
