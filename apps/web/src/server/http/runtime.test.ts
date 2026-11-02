import { describe, expect, test, vi } from "vitest";
import { createHttpRuntime } from "./runtime.js";
import { createFakePostgrest } from "../db/fakePostgrest.js";
import { resetHealthCache } from "../routes/healthRoutes.js";
import type { PostgrestClient } from "../db/postgrestClient.js";
import type { SupabaseStorageClient } from "../runtime/supabaseStorageClient.js";

function makeStorage(): SupabaseStorageClient {
  return {
    async uploadImage({ pathPrefix, ext }) {
      return { url: `https://example.supabase.co/storage/v1/object/public/equo-images/${pathPrefix}/uploaded.${ext}` };
    },
    async deleteImage() {},
  };
}

/**
 * One fake database for the whole routing table. These tests are about routing
 * and wiring - which pattern matches, which handler runs, what status comes
 * back - so this answers every read/write/RPC the routes make with a plausible
 * row and nothing more. Repository-level behaviour is covered in the repository
 * tests, against this same PostgrestClient vocabulary.
 */
function makeClient(): PostgrestClient {
  const groupRow = {
    id: "group_1",
    name: "Tokyo Trip",
    currency: "TWD",
    owner_member_id: "member_owner",
    cover_image_url: null,
  };
  const ownerMember = {
    id: "member_owner",
    group_id: "group_1",
    user_id: "user_alice",
    display_name: "Alice",
    role: "owner",
    status: "active",
  };
  const virtualMember = { ...ownerMember, id: "member_virtual", user_id: null, display_name: "Bob", role: "member" };
  const expenseRow = {
    id: "expense_1",
    group_id: "group_1",
    title: "Dinner",
    kind: "expense",
    amount_minor: 120000,
    currency: "TWD",
    version: 1,
    client_request_id: "expense_req",
    image_url: null,
  };
  const groupDetail = {
    group: groupRow,
    members: [ownerMember],
    expenses: [expenseRow],
    balances: [{ memberId: "member_owner", balance: { amount_minor: 120000, currency: "TWD" } }],
  };

  return createFakePostgrest({
    select: (table, query) => {
      if (table === "users") return [{ id: "user_alice", deleted_at: null, avatar_url: null }];
      if (table === "group_members") {
        // The member-management routes look their target up by id; everything
        // else is asking about the caller's own membership.
        return query.includes("id=eq.member_virtual") ? [virtualMember] : [ownerMember];
      }
      if (table === "groups") {
        return [query.includes("archived_at=not.is.null") ? { ...groupRow, id: "group_2", name: "Osaka Trip", archived_at: "2026-07-01T00:00:00.000Z" } : groupRow];
      }
      if (table === "expenses") return [expenseRow];
      if (table === "expense_payments") {
        return [{ expense_id: "expense_1", payer_member_id: "member_owner", amount_minor: 120000, currency: "TWD" }];
      }
      if (table === "expense_shares") {
        return [{ expense_id: "expense_1", member_id: "member_owner", share_type: "equal", amount_minor: 120000 }];
      }
      if (table === "group_member_balances") return [{ member_id: "member_owner", balance_minor: 0, currency: "TWD" }];
      return [];
    },
    insert: (table) => {
      if (table === "users") {
        return [
          {
            id: "user_alice",
            google_sub: "google-alice",
            email: "alice@example.com",
            display_name: "Alice",
            deleted_at: null,
          },
        ];
      }
      if (table === "groups") return [groupRow];
      if (table === "group_members") return [ownerMember];
      if (table === "invites") {
        return [{ id: "invite_1", group_id: "group_1", token_hash: "hash", max_uses: 5, use_count: 0 }];
      }
      if (table === "app_feedback") return [{ id: "feedback_1" }];
      return [];
    },
    update: (table, query, body) => {
      // Echo the request back the way PostgREST would - the routes return the
      // updated row, so a fake that always answers with the same fixture can't
      // tell a rename from a remove, or group_2 from group_1.
      if (table === "groups") {
        const id = /id=eq\.([^&]+)/.exec(query)?.[1] ?? groupRow.id;
        return [{ ...groupRow, id, name: id === "group_2" ? "Osaka Trip" : groupRow.name, ...(body as object) }];
      }
      if (table === "group_members") return [{ ...virtualMember, ...(body as object) }];
      if (table === "users") return [{ avatar_url: (body as { avatar_url?: string }).avatar_url }];
      return [];
    },
    rpc: (fn, args) => {
      if (fn === "admin_console_role") return "owner";
      if (fn === "admin_console_storage") return { object_count: 13, total_bytes: 861938, orphan_count: 0, orphan_bytes: 0 };
      if (fn === "admin_console_groups") return { total: 1, groups: [groupRow] };
      if (fn === "admin_console_group_detail") return { group: groupRow, members: [ownerMember], invites: [] };
      if (fn === "admin_console_admins") return [{ user_id: "user_alice", email: "alice@example.com", role: "owner" }];
      if (fn === "admin_console_set_admin_role") {
        return { ok: true, admin: { user_id: "user_bob", email: args.p_target_email, role: args.p_role } };
      }
      if (fn === "admin_console_remove_admin") return { ok: true, user_id: args.p_user_id };
      if (fn === "admin_console_group_expenses") {
        // Echo the flag back so the query-string wiring is visible to the test.
        return { total: 1, expenses: [expenseRow], include_deleted: args.p_include_deleted };
      }
      // Echo the log filters back so the query-string wiring is visible.
      if (fn === "admin_console_audit_logs") {
        return { total: 0, logs: [], search: args.p_search, action: args.p_action };
      }
      if (fn === "admin_console_errors") return { total: 0, errors: [], search: args.p_search };
      if (fn === "get_group_detail") return groupDetail;
      if (fn === "replace_expense") {
        return {
          expense: { ...expenseRow, id: "expense_2", title: "Dinner (edited)", amount_minor: 1500 },
          previous: { ...expenseRow, image_url: null },
        };
      }
      if (fn === "delete_my_account") return { ok: true, groups_reassigned: 0, groups_deleted: 0, memberships_anonymized: 1 };
      if (fn === "create_expense") return expenseRow;
      if (fn === "upsert_push_subscription") return { id: "push_1", endpoint: args.p_endpoint };
      if (fn === "delete_push_subscription") return { deleted: 1 };
      if (fn === "push_targets_for_group") {
        return {
          group_name: "Tokyo Trip",
          actor_name: "Alice",
          subscriptions: [{ endpoint: "https://push.example/1", p256dh: "key", auth: "auth" }],
        };
      }
      if (fn === "soft_delete_expense") return { ...expenseRow, version: 2 };
      if (fn === "accept_invite") return { group: groupRow, member: ownerMember, claimed: false };
      if (fn === "line_attach_link_request") {
        return { ok: true, already_linked: false, currently_linked: false };
      }
      if (fn === "line_unlink_user") return { ok: true, unlinked: true };
      // Echo who and which key, so the wiring (session user, decoded key) is visible.
      if (fn === "line_entry_resolve") {
        return { status: "live", group_id: "ledger_1", expense_id: "expense_1", expense_date: "2026-11-01", edited: false, user: args.p_user, key: args.p_entry_key };
      }
      return null;
    },
  });
}

const vapid = { publicKey: "test-public", privateKey: "test-private", subject: "mailto:ops@example.com" };

const alice = async (idToken: string) => ({
  auth_user_id: "user_alice",
  google_sub: idToken,
  email: "alice@example.com",
  display_name: "Alice",
});

describe("createHttpRuntime", () => {
  test("exchanges Google tokens for Equo sessions that can authorize API routes", async () => {
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: idToken,
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
      sessionSecret: "session-secret",
      now: 1_000,
    });

    const login = await runtime.handle({
      method: "POST",
      path: "/api/v1/auth/google",
      headers: {},
      json: { id_token: "google-alice" },
    });

    expect(login.status).toBe(200);
    const loginBody = login.body as { session: { token: string } };
    const sessionToken = loginBody.session.token;

    const response = await runtime.handle({
      method: "POST",
      path: "/api/v1/groups",
      headers: { authorization: `Bearer ${sessionToken}` },
      json: { client_request_id: "req_group", name: "Tokyo Trip", currency: "TWD" },
    });

    expect(login.headers["set-cookie"]).toContain("equo_session=");
    expect(response.status).toBe(201);
  });

  test("skips the per-request user upsert once a session token is issued (fast path)", async () => {
    let userUpsertCount = 0;
    const client = makeClient();
    const countingClient: PostgrestClient = {
      ...client,
      async insert(table, body, options) {
        if (table === "users") {
          userUpsertCount += 1;
        }
        return client.insert(table, body, options);
      },
    };

    const runtime = createHttpRuntime({
      client: countingClient,
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: idToken,
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
      sessionSecret: "session-secret",
      now: 1_000,
    });

    const login = await runtime.handle({
      method: "POST",
      path: "/api/v1/auth/google",
      headers: {},
      json: { id_token: "google-alice" },
    });
    const sessionToken = (login.body as { session: { token: string } }).session.token;

    expect(userUpsertCount).toBe(1); // the login exchange itself still upserts once.

    await runtime.handle({
      method: "POST",
      path: "/api/v1/groups",
      headers: { authorization: `Bearer ${sessionToken}` },
      json: { client_request_id: "req_group", name: "Tokyo Trip", currency: "TWD" },
    });
    await runtime.handle({
      method: "GET",
      path: "/api/v1/groups",
      headers: { authorization: `Bearer ${sessionToken}` },
    });

    // Neither subsequent session-token request should touch public.users again.
    expect(userUpsertCount).toBe(1);
  });

  test("authorizes API routes from the Equo session cookie", async () => {
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: idToken,
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
      sessionSecret: "session-secret",
      now: 1_000,
    });

    const login = await runtime.handle({
      method: "POST",
      path: "/api/v1/auth/google",
      headers: {},
      json: { id_token: "google-alice" },
    });
    const cookie = login.headers["set-cookie"].split(";")[0];

    const response = await runtime.handle({
      method: "POST",
      path: "/api/v1/groups",
      headers: { cookie },
      json: { client_request_id: "req_group", name: "Cookie Trip", currency: "TWD" },
    });

    expect(response.status).toBe(201);
  });

  test("routes group creation requests", async () => {
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: "user_alice",
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
    });

    const response = await runtime.handle({
      method: "POST",
      path: "/api/v1/groups",
      headers: { authorization: "Bearer google-alice" },
      json: { client_request_id: "req_group", name: "Tokyo Trip", currency: "TWD" },
    });

    expect(response.status).toBe(201);
  });

  test("routes DELETE /api/v1/me to account deletion and forwards the cookie clear", async () => {
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: "user_alice",
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
    });

    const response = await runtime.handle({
      method: "DELETE",
      path: "/api/v1/me",
      headers: { authorization: "Bearer google-alice" },
    });

    expect(response.status).toBe(200);
    // The set-cookie from the route survives the runtime's header merge, so the
    // browser's live session cookie is cleared.
    expect(response.headers["set-cookie"]).toContain("Max-Age=0");
  });

  test("routes authenticated group list requests", async () => {
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: "user_alice",
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
    });

    const response = await runtime.handle({
      method: "GET",
      path: "/api/v1/groups",
      headers: { authorization: "Bearer google-token" },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      groups: [{ id: "group_1", name: "Tokyo Trip" }],
    });
  });

  test("routes authenticated group detail requests", async () => {
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: "user_alice",
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
    });

    const response = await runtime.handle({
      method: "GET",
      path: "/api/v1/groups/group_1",
      headers: { authorization: "Bearer google-token" },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      group: { id: "group_1" },
      members: [{ id: "member_owner" }],
      expenses: [{ id: "expense_1" }],
      balances: [{ memberId: "member_owner" }],
    });
  });

  test("routes PUT /groups/:groupId/expenses/:expenseId to the atomic replace", async () => {
    // An edit is a delete plus a create. It used to be issued as two separate
    // requests from the browser, so a create that failed after the delete had
    // landed destroyed the entry. PUT hands both halves to one transaction.
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: "user_alice",
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
    });

    const response = await runtime.handle({
      method: "PUT",
      path: "/api/v1/groups/group_1/expenses/expense_1",
      headers: { authorization: "Bearer google-token" },
      json: {
        client_request_id: "req_edit",
        title: "Dinner (edited)",
        kind: "expense",
        category: "food",
        amount_minor: 1500,
        currency: "TWD",
        expense_date: "2026-07-01",
        expense_payments: [{ payer_member_id: "member_owner", amount_minor: 1500, currency: "TWD" }],
        expense_shares: [{ member_id: "member_owner", share_type: "fixed", amount_minor: 1500 }],
      },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ expense: { id: "expense_2", title: "Dinner (edited)" } });
  });

  test("routes GET /groups/archived without falling through to the group-detail handler", async () => {
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: "user_alice",
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
    });

    const response = await runtime.handle({
      method: "GET",
      path: "/api/v1/groups/archived",
      headers: { authorization: "Bearer google-token" },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      groups: [{ id: "group_2", name: "Osaka Trip", archived_at: "2026-07-01T00:00:00.000Z" }],
    });
    // A response shaped like the group-detail handler's would include `members`/`expenses`/`balances`.
    expect(response.body).not.toHaveProperty("members");
    expect(response.body).not.toHaveProperty("expenses");
    expect(response.body).not.toHaveProperty("balances");
  });

  test("threads audit search/action and error search from the query string to the RPC", async () => {
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: "user_alice",
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
    });

    const headers = { authorization: "Bearer google-token" };

    const audit = await runtime.handle({
      method: "GET",
      path: "/api/v1/admin/audit",
      headers,
      query: { search: "alice", action: "group.delete" },
    });
    const errors = await runtime.handle({
      method: "GET",
      path: "/api/v1/admin/errors",
      headers,
      query: { search: "boom" },
    });

    expect(audit.body).toMatchObject({ search: "alice", action: "group.delete" });
    expect(errors.body).toMatchObject({ search: "boom" });
  });

  test("routes the owner-only admin management endpoints (list, set role, remove)", async () => {
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: "user_alice",
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
    });

    const headers = { authorization: "Bearer google-token" };

    const list = await runtime.handle({ method: "GET", path: "/api/v1/admin/admins", headers });
    const set = await runtime.handle({
      method: "POST",
      path: "/api/v1/admin/admins",
      headers,
      json: { email: "bob@example.com", role: "support" },
    });
    const remove = await runtime.handle({
      method: "POST",
      path: "/api/v1/admin/admins/11111111-1111-4111-8111-111111111111/remove",
      headers,
    });

    expect(list.status).toBe(200);
    expect(list.body).toHaveProperty("admins");
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ admin: { email: "bob@example.com", role: "support" } });
    expect(remove.status).toBe(200);
    expect(remove.body).toMatchObject({ user_id: "11111111-1111-4111-8111-111111111111" });
  });

  test("routes the admin storage stats endpoint", async () => {
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: "user_alice",
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
    });

    const response = await runtime.handle({
      method: "GET",
      path: "/api/v1/admin/storage",
      headers: { authorization: "Bearer google-token" },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ object_count: 13, orphan_count: 0 });
  });

  test("routes the admin group listing, detail, and expense drill-down to distinct handlers", async () => {
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: "user_alice",
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
    });

    const headers = { authorization: "Bearer google-token" };

    const list = await runtime.handle({ method: "GET", path: "/api/v1/admin/groups", headers });
    const detail = await runtime.handle({ method: "GET", path: "/api/v1/admin/groups/11111111-1111-4111-8111-111111111111", headers });
    const expenses = await runtime.handle({
      method: "GET",
      path: "/api/v1/admin/groups/11111111-1111-4111-8111-111111111111/expenses",
      headers,
      query: { include_deleted: "true" },
    });

    // The list must not fall through to the :groupId detail pattern, and the
    // detail must not swallow the /expenses suffix.
    expect(list.status).toBe(200);
    expect(list.body).toHaveProperty("groups");
    expect(detail.status).toBe(200);
    expect(detail.body).toHaveProperty("members");
    expect(detail.body).not.toHaveProperty("groups");
    expect(expenses.status).toBe(200);
    expect(expenses.body).toMatchObject({ include_deleted: true });
  });

  test("admin expense drill-down leaves deleted rows out unless the query asks for them", async () => {
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: "user_alice",
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
    });

    const response = await runtime.handle({
      method: "GET",
      path: "/api/v1/admin/groups/11111111-1111-4111-8111-111111111111/expenses",
      headers: { authorization: "Bearer google-token" },
    });

    expect(response.body).toMatchObject({ include_deleted: false });
  });

  test("routes group unarchive requests", async () => {
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: "user_alice",
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
    });

    const response = await runtime.handle({
      method: "POST",
      path: "/api/v1/groups/group_2/unarchive",
      headers: { authorization: "Bearer google-token" },
      json: { client_request_id: "req_unarchive" },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      group: { id: "group_2", name: "Osaka Trip" },
    });
  });

  test("routes member rename requests without colliding with the member creation route", async () => {
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: "user_alice",
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
    });

    // POST .../members (creation, one path segment less) must still hit the
    // creation handler...
    const created = await runtime.handle({
      method: "POST",
      path: "/api/v1/groups/group_1/members",
      headers: { authorization: "Bearer google-token" },
      json: { client_request_id: "req_member", display_name: "Bob" },
    });
    expect(created.status).toBe(201);

    // ...while PATCH .../members/:memberId hits the rename handler.
    const renamed = await runtime.handle({
      method: "PATCH",
      path: "/api/v1/groups/group_1/members/member_virtual",
      headers: { authorization: "Bearer google-token" },
      json: { client_request_id: "req_rename", display_name: "Bobby" },
    });

    expect(renamed.status).toBe(200);
    expect(renamed.body).toMatchObject({
      member: { id: "member_virtual", display_name: "Bobby", user_id: null },
    });
  });

  test("rejects member rename requests with an empty display name", async () => {
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: "user_alice",
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
    });

    const response = await runtime.handle({
      method: "PATCH",
      path: "/api/v1/groups/group_1/members/member_virtual",
      headers: { authorization: "Bearer google-token" },
      json: { client_request_id: "req_rename", display_name: "   " },
    });

    expect(response.status).toBe(400);
  });

  test("routes member removal requests", async () => {
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: "user_alice",
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
    });

    const response = await runtime.handle({
      method: "DELETE",
      path: "/api/v1/groups/group_1/members/member_virtual",
      headers: { authorization: "Bearer google-token" },
      json: { client_request_id: "req_remove" },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      member: { id: "member_virtual", status: "removed" },
    });
  });

  test("uploads a group image through the storage adapter", async () => {
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: "user_alice",
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
    });

    const tinyPngBase64 =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

    const response = await runtime.handle({
      method: "POST",
      path: "/api/v1/groups/group_1/images",
      headers: { authorization: "Bearer google-token" },
      json: {
        client_request_id: "req_image",
        kind: "expense",
        data_url: `data:image/png;base64,${tinyPngBase64}`,
      },
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      image: { url: "https://example.supabase.co/storage/v1/object/public/equo-images/group_1/uploaded.png" },
    });
  });

  test("rejects image uploads with an unsupported content type", async () => {
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: "user_alice",
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
    });

    const response = await runtime.handle({
      method: "POST",
      path: "/api/v1/groups/group_1/images",
      headers: { authorization: "Bearer google-token" },
      json: {
        client_request_id: "req_image",
        kind: "expense",
        data_url: "data:text/plain;base64,aGVsbG8=",
      },
    });

    expect(response.status).toBe(400);
  });

  test("rejects image uploads that decode to more than 1.5 MB", async () => {
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: "user_alice",
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
    });

    // ~2 MB of decoded bytes once base64-inflated.
    const oversizedBase64 = "A".repeat(Math.ceil((2 * 1024 * 1024 * 4) / 3));

    const response = await runtime.handle({
      method: "POST",
      path: "/api/v1/groups/group_1/images",
      headers: { authorization: "Bearer google-token" },
      json: {
        client_request_id: "req_image",
        kind: "expense",
        data_url: `data:image/jpeg;base64,${oversizedBase64}`,
      },
    });

    expect(response.status).toBe(400);
  });

  test("converts an unexpected handler exception into a structured 500 without leaking internals", async () => {
    const secret = "sk_internal_db_credential_leak";
    const client = makeClient();
    const throwingClient: PostgrestClient = {
      ...client,
      async insert(table, body, options) {
        if (table === "groups") {
          // A downstream failure whose message must never reach the caller.
          throw new Error(`connection refused ${secret}`);
        }
        return client.insert(table, body, options);
      },
    };

    const runtime = createHttpRuntime({
      client: throwingClient,
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: "user_alice",
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const response = await runtime.handle({
      method: "POST",
      path: "/api/v1/groups",
      headers: { authorization: "Bearer google-token" },
      json: { client_request_id: "req_group", name: "Tokyo Trip", currency: "TWD" },
    });

    expect(response.status).toBe(500);
    const body = response.body as { error: { code: string; message: string; request_id: string } };
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(body.error.request_id).toMatch(/^req_err_/);
    // The raw error (and any secret in it) stays server-side, logged against the id.
    expect(JSON.stringify(response.body)).not.toContain(secret);
    expect(JSON.stringify(response.body)).not.toContain("connection refused");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining(body.error.request_id), expect.anything());

    errorSpy.mockRestore();
  });

  test("returns 404 for unknown API paths", async () => {
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async () => null,
    });

    const response = await runtime.handle({
      method: "GET",
      path: "/api/v1/unknown",
      headers: {},
    });

    expect(response.status).toBe(404);
  });

  test("extracts bearer token for Google-only auth", async () => {
    let capturedToken = "";
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async (idToken) => {
        capturedToken = idToken;
        return {
          auth_user_id: "user_alice",
          google_sub: idToken,
          email: "alice@example.com",
          display_name: "Alice",
        };
      },
    });

    await runtime.handle({
      method: "POST",
      path: "/api/v1/groups",
      headers: { authorization: "Bearer google-token" },
      json: { client_request_id: "req_group", name: "Tokyo Trip", currency: "TWD" },
    });

    expect(capturedToken).toBe("google-token");
  });
});

/**
 * The limiter is wired in ahead of routing, so these go through the real
 * runtime rather than calling enforceRateLimit directly - the point is that a
 * blocked request never reaches its handler at all. Policy and identity rules
 * are covered in rateLimitPolicy.test.ts / rateLimit.test.ts.
 */
describe("rate limiting", () => {
  function overLimitClient(): PostgrestClient {
    const client = makeClient();
    return { ...client, async rpc<T>(fn: string) {
      if (fn === "consume_rate_limit") return { allowed: false, retry_after: 37 } as T;
      throw new Error(`Unexpected rpc ${fn}`);
    } };
  }

  test("answers 429 with Retry-After once a write is over the limit", async () => {
    const runtime = createHttpRuntime({
      client: overLimitClient(),
      storage: makeStorage(),
      verifier: async () => null,
    });

    const response = await runtime.handle({
      method: "POST",
      path: "/api/v1/errors",
      headers: { "x-forwarded-for": "203.0.113.9" },
      json: { message: "boom" },
    });

    expect(response.status).toBe(429);
    expect((response.body as { error: { code: string } }).error.code).toBe("RATE_LIMITED");
    // Without this the client has no idea how long to wait, and a well-behaved
    // one degenerates into the same tight loop as a hostile one.
    expect(response.headers["retry-after"]).toBe("37");
  });

  test("blocks before the handler runs, so an unknown path costs the same budget", async () => {
    const runtime = createHttpRuntime({
      client: overLimitClient(),
      storage: makeStorage(),
      verifier: async () => null,
    });

    const response = await runtime.handle({
      method: "POST",
      path: "/api/v1/not-a-real-route",
      headers: { "x-forwarded-for": "203.0.113.9" },
      json: {},
    });

    // 429, not 404: probing for endpoints must not be a way to spend nothing.
    expect(response.status).toBe(429);
  });

  test("leaves reads alone even when the counter would refuse", async () => {
    const runtime = createHttpRuntime({
      client: overLimitClient(),
      storage: makeStorage(),
      verifier: async () => null,
    });

    const response = await runtime.handle({
      method: "GET",
      path: "/api/v1/unknown",
      headers: { "x-forwarded-for": "203.0.113.9" },
    });

    expect(response.status).toBe(404);
  });
});

describe("health", () => {
  test("answers 200 without any credentials, and forbids caching", async () => {
    resetHealthCache();
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async () => null,
    });

    const response = await runtime.handle({
      method: "GET",
      path: "/api/v1/health",
      headers: {},
    });

    // No session: an uptime monitor cannot log in.
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok", database: "ok" });
    // A cached "ok" served through an outage is worse than no monitoring.
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  test("answers a HEAD probe too - the method uptime monitors default to", async () => {
    resetHealthCache();
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async () => null,
    });

    // UptimeRobot (and load balancers) send HEAD by default. A GET-only health
    // route 404s under exactly the tool meant to watch it.
    const response = await runtime.handle({
      method: "HEAD" as "GET",
      path: "/api/v1/health",
      headers: {},
    });

    expect(response.status).toBe(200);
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  test("answers 503 when the database is unreachable", async () => {
    resetHealthCache();
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = makeClient();
    const runtime = createHttpRuntime({
      client: { ...client, async select() { throw new Error("connection refused"); } },
      storage: makeStorage(),
      verifier: async () => null,
    });

    const response = await runtime.handle({
      method: "GET",
      path: "/api/v1/health",
      headers: {},
    });

    expect(response.status).toBe(503);
    logged.mockRestore();
  });
});

describe("web push wiring", () => {
  test("stores a subscription against the authenticated caller", async () => {
    const client = makeClient() as ReturnType<typeof createFakePostgrest>;
    const runtime = createHttpRuntime({ client, storage: makeStorage(), verifier: alice, vapid });

    const response = await runtime.handle({
      method: "POST",
      path: "/api/v1/push/subscribe",
      headers: { authorization: "Bearer google-alice" },
      json: {
        endpoint: "https://push.example/1",
        keys: { p256dh: "key", auth: "auth" },
        user_agent: "Firefox",
      },
    });

    expect(response.status).toBe(200);
    // The user id comes from the session, never from the body.
    expect(client.rpcCall("upsert_push_subscription")?.args).toEqual({
      p_user: "user_alice",
      p_endpoint: "https://push.example/1",
      p_p256dh: "key",
      p_auth: "auth",
      p_user_agent: "Firefox",
      // Absent from the body, and passed as null rather than omitted: the RPC
      // reads that as "this device did not say" and keeps whatever locale the
      // row already had, instead of clearing somebody's choice.
      p_locale: null,
    });
  });

  test("unsubscribing removes only the caller's own endpoint", async () => {
    const client = makeClient() as ReturnType<typeof createFakePostgrest>;
    const runtime = createHttpRuntime({ client, storage: makeStorage(), verifier: alice, vapid });

    const response = await runtime.handle({
      method: "POST",
      path: "/api/v1/push/unsubscribe",
      headers: { authorization: "Bearer google-alice" },
      json: { endpoint: "https://push.example/1" },
    });

    expect(response.status).toBe(200);
    expect(client.rpcCall("delete_push_subscription")?.args).toEqual({
      p_user: "user_alice",
      p_endpoint: "https://push.example/1",
    });
  });

  test("push endpoints are behind the session wall", async () => {
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async () => null,
      vapid,
    });

    for (const path of ["/api/v1/push/public-key", "/api/v1/push/subscribe"]) {
      const response = await runtime.handle({
        method: path.endsWith("public-key") ? "GET" : "POST",
        path,
        headers: {},
        json: {},
      });
      expect(response.status).toBe(401);
    }
  });

  test("reports push as switched off when the deployment has no VAPID key", async () => {
    const runtime = createHttpRuntime({ client: makeClient(), storage: makeStorage(), verifier: alice });

    const response = await runtime.handle({
      method: "GET",
      path: "/api/v1/push/public-key",
      headers: { authorization: "Bearer google-alice" },
    });

    // Not an error: "this deployment cannot deliver" is a state the UI renders.
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ enabled: false });
  });

  test("serves the public key when it is configured", async () => {
    const runtime = createHttpRuntime({ client: makeClient(), storage: makeStorage(), verifier: alice, vapid });

    const response = await runtime.handle({
      method: "GET",
      path: "/api/v1/push/public-key",
      headers: { authorization: "Bearer google-alice" },
    });

    expect(response.body).toEqual({ enabled: true, public_key: "test-public" });
    // The private half never leaves the server.
    expect(JSON.stringify(response.body)).not.toContain("test-private");
  });

  test("notifies the rest of the group after an expense is created", async () => {
    const sent: string[] = [];
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: alice,
      vapid,
      pushSend: async (subscription, payload) => {
        sent.push(`${subscription.endpoint}|${payload.title}|${payload.body}`);
        return { statusCode: 201 };
      },
    });

    const response = await runtime.handle({
      method: "POST",
      path: "/api/v1/groups/group_1/expenses",
      headers: { authorization: "Bearer google-alice" },
      json: {
        client_request_id: "req_expense",
        title: "Dinner",
        amount_minor: 120000,
        currency: "TWD",
        expense_payments: [{ payer_member_id: "member_owner", amount_minor: 120000, currency: "TWD" }],
        expense_shares: [{ member_id: "member_owner", share_type: "fixed", amount_minor: 120000 }],
      },
    });

    expect(response.status).toBe(201);
    expect(sent).toEqual(["https://push.example/1|Tokyo Trip|Alice 記了一筆：Dinner $1,200"]);
  });

  test("sends nothing when the deployment has push switched off", async () => {
    const sent: string[] = [];
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: alice,
      pushSend: async (subscription) => {
        sent.push(subscription.endpoint);
        return { statusCode: 201 };
      },
    });

    const response = await runtime.handle({
      method: "POST",
      path: "/api/v1/groups/group_1/expenses",
      headers: { authorization: "Bearer google-alice" },
      json: {
        client_request_id: "req_expense",
        title: "Dinner",
        amount_minor: 120000,
        currency: "TWD",
        expense_payments: [{ payer_member_id: "member_owner", amount_minor: 120000, currency: "TWD" }],
        expense_shares: [{ member_id: "member_owner", share_type: "fixed", amount_minor: 120000 }],
      },
    });

    expect(response.status).toBe(201);
    expect(sent).toEqual([]);
  });

  test("a push failure never turns a saved expense into a failed request", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const runtime = createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: alice,
      vapid,
      pushSend: async () => {
        throw new Error("push service unreachable");
      },
    });

    const response = await runtime.handle({
      method: "POST",
      path: "/api/v1/groups/group_1/expenses",
      headers: { authorization: "Bearer google-alice" },
      json: {
        client_request_id: "req_expense",
        title: "Dinner",
        amount_minor: 120000,
        currency: "TWD",
        expense_payments: [{ payer_member_id: "member_owner", amount_minor: 120000, currency: "TWD" }],
        expense_shares: [{ member_id: "member_owner", share_type: "fixed", amount_minor: 120000 }],
      },
    });

    expect(response.status).toBe(201);
    logged.mockRestore();
  });
});

describe("the scheduler endpoint", () => {
  function runtimeWith(cronSecret?: string) {
    return createHttpRuntime({
      client: createFakePostgrest({
        rpc: (fn) => {
          if (fn === "auto_nudge_settings") return { enabled: false, overdue_days: 14, cooldown_days: 7 };
          if (fn === "consume_rate_limit") return { allowed: true };
          throw new Error(`Unexpected rpc ${fn}`);
        },
      }),
      storage: makeStorage(),
      verifier: alice,
      sessionSecret: "session-secret",
      cronSecret,
    });
  }

  async function call(runtime: ReturnType<typeof createHttpRuntime>, authorization?: string) {
    return runtime.handle({
      method: "POST",
      path: "/api/v1/internal/run-nudges",
      headers: authorization ? { authorization } : {},
      json: {},
    });
  }

  test("is closed when no secret is configured", async () => {
    // The failure direction matters: an unauthenticated trigger for something
    // that sends notifications is worse than having no schedule at all.
    expect((await call(runtimeWith(undefined), "Bearer anything")).status).toBe(401);
  });

  test("rejects a wrong secret", async () => {
    expect((await call(runtimeWith("right"), "Bearer wrong")).status).toBe(401);
  });

  test("rejects a missing header", async () => {
    expect((await call(runtimeWith("right"))).status).toBe(401);
  });

  test("rejects a bare secret without the Bearer scheme", async () => {
    expect((await call(runtimeWith("right"), "right")).status).toBe(401);
  });

  test("runs for the right secret", async () => {
    const response = await call(runtimeWith("right"), "Bearer right");

    expect(response.status).toBe(200);
    // Switched off in this fixture, so it reports that rather than sending.
    expect(response.body).toMatchObject({ status: "disabled" });
  });
});


/**
 * View-as through the whole pipeline.
 *
 * The unit tests in viewAs.test.ts prove the predicate; these prove the wiring -
 * that the cookie really is preferred by auth, that the gate really sits in
 * front of the router, and that the exit really is reachable from inside the
 * mode. A predicate that is right and never called would pass those and fail
 * these.
 */
describe("read-only view-as", () => {
  function makeRuntime() {
    return createHttpRuntime({
      client: makeClient(),
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: idToken,
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
      sessionSecret: "session-secret",
      now: 1_000,
    });
  }

  async function viewAsCookie() {
    const { createViewAsToken } = await import("../auth/sessionToken.js");
    return createViewAsToken(
      {
        auth_user_id: "user_alice",
        google_sub: "google_alice",
        email: "alice@example.com",
        display_name: "Alice",
      },
      "user_admin",
      "session-secret",
      1_000,
    );
  }

  test("a write is refused with VIEW_AS_READONLY before it reaches any handler", async () => {
    const token = await viewAsCookie();

    const response = await makeRuntime().handle({
      method: "POST",
      path: "/api/v1/groups",
      headers: { cookie: `equo_view_as=${token}` },
      json: { client_request_id: "req_group", name: "Should Not Exist", currency: "TWD" },
    });

    expect(response.status).toBe(403);
    expect((response.body as { error: { code: string } }).error.code).toBe("VIEW_AS_READONLY");
  });

  test("reads still work, which is the entire point of the mode", async () => {
    const token = await viewAsCookie();

    const response = await makeRuntime().handle({
      method: "GET",
      path: "/api/v1/groups",
      headers: { cookie: `equo_view_as=${token}` },
      json: undefined,
    });

    expect(response.status).toBe(200);
  });

  test("GET /api/v1/groups under view-as makes no ensure_personal_ledger rpc call", async () => {
    // The gate is the cookie's mere presence, matching blocksWrite's
    // fail-closed stance - so this must hold even though the cookie here is a
    // perfectly valid one and the read otherwise succeeds.
    const token = await viewAsCookie();
    const rpcCalls: string[] = [];
    const client = makeClient();
    const trackingClient: PostgrestClient = {
      ...client,
      async rpc(fn, args) {
        rpcCalls.push(fn);
        return client.rpc(fn, args);
      },
    };
    const runtime = createHttpRuntime({
      client: trackingClient,
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: idToken,
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
      sessionSecret: "session-secret",
      now: 1_000,
    });

    const response = await runtime.handle({
      method: "GET",
      path: "/api/v1/groups",
      headers: { cookie: `equo_view_as=${token}` },
      json: undefined,
    });

    expect(response.status).toBe(200);
    expect(rpcCalls).not.toContain("ensure_personal_ledger");
  });

  test("leaving the view is reachable from inside it, and clears the cookie", async () => {
    // If this 403s, the mode has no exit and the admin is stuck as somebody
    // else until the token lapses.
    const token = await viewAsCookie();

    const response = await makeRuntime().handle({
      method: "DELETE",
      path: "/api/v1/admin/view-as",
      headers: { cookie: `equo_view_as=${token}` },
      json: undefined,
    });

    expect(response.status).toBe(200);
    expect(response.headers["set-cookie"]).toContain("equo_view_as=;");
    expect(response.headers["set-cookie"]).toContain("Max-Age=0");
  });

  test("the notice endpoint reports the view, so the app can say so", async () => {
    const token = await viewAsCookie();

    const response = await makeRuntime().handle({
      method: "GET",
      path: "/api/v1/site-notice",
      headers: { cookie: `equo_view_as=${token}` },
      json: undefined,
    });

    expect((response.body as { view_as: { active: boolean } | null }).view_as).toEqual({ active: true });
  });

  test("and reports nothing for an ordinary caller", async () => {
    // Computed per request rather than folded into the cached notice: the
    // notice is one shared object, and one admin's view-as state must never
    // reach everybody else.
    const response = await makeRuntime().handle({
      method: "GET",
      path: "/api/v1/site-notice",
      headers: {},
      json: undefined,
    });

    expect((response.body as { view_as: unknown }).view_as).toBeNull();
  });

  test("an ordinary session still writes", async () => {
    const runtime = makeRuntime();
    const login = await runtime.handle({
      method: "POST",
      path: "/api/v1/auth/google",
      headers: {},
      json: { id_token: "google-alice" },
    });
    const token = (login.body as { session: { token: string } }).session.token;

    const response = await runtime.handle({
      method: "POST",
      path: "/api/v1/groups",
      headers: { cookie: `equo_session=${token}` },
      json: { client_request_id: "req_group_ok", name: "Tokyo Trip", currency: "TWD" },
    });

    expect(response.status).toBe(201);
  });
});

describe("GET /api/v1/me/group-shares", () => {
  // [MV]
  test("is gone: 404 with a non-auth code, so old clients stay signed in", async () => {
    const client = makeClient();
    const runtime = createHttpRuntime({
      client,
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: idToken,
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
      sessionSecret: "session-secret",
      now: 1_000,
    });
    const login = await runtime.handle({
      method: "POST",
      path: "/api/v1/auth/google",
      headers: {},
      json: { id_token: "google-alice" },
    });
    const token = (login.body as { session: { token: string } }).session.token;

    const response = await runtime.handle({
      method: "GET",
      path: "/api/v1/me/group-shares",
      query: { month: "2026-09" },
      headers: { cookie: `equo_session=${token}` },
      json: undefined,
    });

    expect(response.status).toBe(404);
    expect((response.body as { error: { code: string } }).error.code).not.toBe("UNAUTHENTICATED");
  });
});

describe("LINE account link routes", () => {
  function makeRuntime(client: PostgrestClient = makeClient()) {
    return createHttpRuntime({
      client,
      storage: makeStorage(),
      verifier: async (idToken) => ({
        auth_user_id: "user_alice",
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
      sessionSecret: "session-secret",
      now: 1_000,
    });
  }

  test("all three routes are wired", async () => {
    const runtime = makeRuntime();
    const auth = { authorization: "Bearer google-alice" };

    const get = await runtime.handle({ method: "GET", path: "/api/v1/me/line", headers: auth });
    expect(get.status).toBe(200);
    expect(get.body).toEqual({ linked: false, linked_at: null });

    const post = await runtime.handle({
      method: "POST",
      path: "/api/v1/me/line/link",
      headers: auth,
      json: { link_token: "abcd1234efgh5678", locale: "zh-Hant" },
    });
    expect(post.status).toBe(200);

    const del = await runtime.handle({ method: "DELETE", path: "/api/v1/me/line", headers: auth });
    expect(del.status).toBe(200);
    expect(del.body).toEqual({ ok: true, unlinked: true });
  });

  test("GET /me/line/entries/:key is routed at its deep path, for the session user only", async () => {
    const runtime = makeRuntime();

    const anonymous = await runtime.handle({ method: "GET", path: "/api/v1/me/line/entries/msg%3A1234567890", headers: {} });
    expect(anonymous.status).toBe(401);
    expect((anonymous.body as { error: { code: string } }).error.code).toBe("UNAUTHENTICATED");

    const signedIn = await runtime.handle({
      method: "GET",
      path: "/api/v1/me/line/entries/msg%3A1234567890",
      headers: { authorization: "Bearer google-alice" },
    });
    expect(signedIn.status).toBe(200);
    expect(signedIn.body).toMatchObject({ status: "live", user: "user_alice", key: "msg:1234567890" });

    const malformed = await runtime.handle({
      method: "GET",
      path: "/api/v1/me/line/entries/short",
      headers: { authorization: "Bearer google-alice" },
    });
    expect(malformed.status).toBe(400);
  });

  test("the entry route is a GET only: other methods on that path are not routed", async () => {
    const response = await makeRuntime().handle({
      method: "DELETE",
      path: "/api/v1/me/line/entries/msg%3A1234567890",
      headers: { authorization: "Bearer google-alice" },
    });

    expect(response.status).toBe(404);
  });

  test("maintenance and view-as do not block resolving an entry (it is a read)", async () => {
    const { resetSiteNoticeCache } = await import("./maintenance.js");
    const { createViewAsToken } = await import("../auth/sessionToken.js");
    resetSiteNoticeCache();

    const client = makeClient();
    const path = "/api/v1/me/line/entries/msg%3A1234567890";
    try {
      const maintenanceClient: PostgrestClient = {
        ...client,
        async rpc(fn, args) {
          if (fn === "site_notice_settings") {
            return {
              banner: { message: "", level: "info", ends_at: null, active: false },
              maintenance: { enabled: true, message: "維護中" },
            } as never;
          }
          return client.rpc(fn, args);
        },
      };

      const duringMaintenance = await makeRuntime(maintenanceClient).handle({
        method: "GET",
        path,
        headers: { authorization: "Bearer google-alice" },
      });
      expect(duringMaintenance.status).toBe(200);
    } finally {
      // A failing assertion must not leave maintenance cached for the next test.
      resetSiteNoticeCache();
    }

    const viewAsToken = await createViewAsToken(
      { auth_user_id: "user_alice", google_sub: "google_alice", email: "alice@example.com", display_name: "Alice" },
      "user_admin",
      "session-secret",
      1_000,
    );
    const viewingAs = await makeRuntime().handle({
      method: "GET",
      path,
      headers: { cookie: `equo_view_as=${viewAsToken}` },
    });
    expect(viewingAs.status).toBe(200);
    expect(viewingAs.body).toMatchObject({ user: "user_alice" });
  });

  test("a view-as cookie refuses POST /me/line/link and DELETE /me/line with VIEW_AS_READONLY", async () => {
    const { createViewAsToken } = await import("../auth/sessionToken.js");
    const token = await createViewAsToken(
      { auth_user_id: "user_alice", google_sub: "google_alice", email: "alice@example.com", display_name: "Alice" },
      "user_admin",
      "session-secret",
      1_000,
    );
    const runtime = makeRuntime();
    const headers = { cookie: `equo_view_as=${token}` };

    const post = await runtime.handle({
      method: "POST",
      path: "/api/v1/me/line/link",
      headers,
      json: { link_token: "abcd1234efgh5678" },
    });
    expect(post.status).toBe(403);
    expect((post.body as { error: { code: string } }).error.code).toBe("VIEW_AS_READONLY");

    const del = await runtime.handle({ method: "DELETE", path: "/api/v1/me/line", headers });
    expect(del.status).toBe(403);
    expect((del.body as { error: { code: string } }).error.code).toBe("VIEW_AS_READONLY");
  });

  test("maintenance does not block DELETE /me/line (unlinking is always possible)", async () => {
    const { resetSiteNoticeCache } = await import("./maintenance.js");
    resetSiteNoticeCache();

    const client = makeClient();
    const maintenanceClient: PostgrestClient = {
      ...client,
      async rpc(fn, args) {
        if (fn === "site_notice_settings") {
          return {
            banner: { message: "", level: "info", ends_at: null, active: false },
            maintenance: { enabled: true, message: "維護中" },
          } as never;
        }
        return client.rpc(fn, args);
      },
    };

    const response = await makeRuntime(maintenanceClient).handle({
      method: "DELETE",
      path: "/api/v1/me/line",
      headers: { authorization: "Bearer google-alice" },
    });

    expect(response.status).toBe(200);
    resetSiteNoticeCache();
  });

  test("maintenance blocks POST /me/line/link", async () => {
    const { resetSiteNoticeCache } = await import("./maintenance.js");
    resetSiteNoticeCache();

    const client = makeClient();
    const maintenanceClient: PostgrestClient = {
      ...client,
      async rpc(fn, args) {
        if (fn === "site_notice_settings") {
          return {
            banner: { message: "", level: "info", ends_at: null, active: false },
            maintenance: { enabled: true, message: "維護中" },
          } as never;
        }
        return client.rpc(fn, args);
      },
    };

    const response = await makeRuntime(maintenanceClient).handle({
      method: "POST",
      path: "/api/v1/me/line/link",
      headers: { authorization: "Bearer google-alice" },
      json: { link_token: "abcd1234efgh5678" },
    });

    expect(response.status).toBe(503);
    expect((response.body as { error: { code: string } }).error.code).toBe("MAINTENANCE");

    resetSiteNoticeCache();
  });
});

/**
 * A LINE-in-app (LIFF) session is a NEW credential path, so these go through
 * the real runtime: the point is that nothing a route does can widen it. Token
 * and allowlist rules are in liffToken.test.ts / liffScope.test.ts, the gate in
 * isolation in liffGate.test.ts.
 */
describe("LIFF sessions", () => {
  const SECRET = "session-secret";
  const LEDGER = "0b8f2c1e-5a41-4f0a-9d2e-3c6b7a8d9e10";
  const HASH = "d".repeat(64);
  const SHARED = "group_1";

  async function liffToken(overrides: Partial<{ ledger_id: string; line_sub_hash: string }> = {}, now = 1_000) {
    const { createLiffToken } = await import("../auth/liffToken.js");
    return createLiffToken(
      {
        auth_user_id: "user_alice",
        google_sub: "google_alice",
        email: "alice@example.com",
        display_name: "Alice",
        ledger_id: LEDGER,
        line_sub_hash: HASH,
        ...overrides,
      },
      SECRET,
      now,
    );
  }

  /** makeClient plus: a controllable liveness answer, a two-group list, and a record of every rpc/insert. */
  function liffClient(live: unknown = true) {
    const base = makeClient();
    const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
    const inserts: string[] = [];
    const client: PostgrestClient = {
      ...base,
      async select<T>(table: string, query: string) {
        if (table === "groups" && query.includes("order=")) {
          return [
            { id: LEDGER, name: "My ledger", currency: "TWD", kind: "personal", owner_member_id: "member_owner" },
            { id: SHARED, name: "Tokyo Trip", currency: "TWD", kind: "shared", owner_member_id: "member_owner" },
          ] as T[];
        }
        return base.select<T>(table, query);
      },
      async insert<T>(table: string, body: unknown, options?: Parameters<PostgrestClient["insert"]>[2]) {
        inserts.push(table);
        return base.insert<T>(table, body, options);
      },
      async rpc<T>(fn: string, args: Record<string, unknown>) {
        rpcs.push({ fn, args });
        if (fn === "line_liff_link_live") {
          if (live instanceof Error) throw live;
          return live as T;
        }
        return base.rpc<T>(fn, args);
      },
    };
    return { client, rpcs, inserts };
  }

  function makeRuntime(client: PostgrestClient, extra: Partial<Parameters<typeof createHttpRuntime>[0]> = {}) {
    return createHttpRuntime({
      client,
      storage: makeStorage(),
      // Accepts ANY string as a Google token, like the rest of this file: a LIFF
      // token that fell through to here would be let in as "Alice".
      verifier: async (idToken) => ({
        auth_user_id: "user_alice",
        google_sub: idToken,
        email: "alice@example.com",
        display_name: "Alice",
      }),
      sessionSecret: SECRET,
      now: 1_000,
      ...extra,
    });
  }

  const code = (response: { body: unknown }) => (response.body as { error: { code: string } }).error.code;

  test("lists the personal ledger and nothing else, and never writes a user row", async () => {
    const { client, inserts } = liffClient();

    const response = await makeRuntime(client).handle({
      method: "GET",
      path: "/api/v1/groups",
      headers: { authorization: `Bearer ${await liffToken()}` },
    });

    expect(response.status).toBe(200);
    expect((response.body as { groups: Array<{ id: string }> }).groups.map((group) => group.id)).toEqual([LEDGER]);
    // The token is a resolved identity: no upsert of the user on the way in.
    expect(inserts).not.toContain("users");
  });

  // [MV]: an unfiltered GET /groups hands a LINE session every shared group.
  test("a normal session still sees every group (the filter is LIFF-only)", async () => {
    const { client } = liffClient();
    const runtime = makeRuntime(client);
    const login = await runtime.handle({ method: "POST", path: "/api/v1/auth/google", headers: {}, json: { id_token: "google-alice" } });
    const session = (login.body as { session: { token: string } }).session.token;

    const response = await runtime.handle({ method: "GET", path: "/api/v1/groups", headers: { authorization: `Bearer ${session}` } });

    expect((response.body as { groups: Array<{ id: string }> }).groups.map((group) => group.id)).toEqual([LEDGER, SHARED]);
  });

  test("checks the link on every request, with the user, ledger and hash from the token", async () => {
    const { client, rpcs } = liffClient();
    const runtime = makeRuntime(client);
    const headers = { authorization: `Bearer ${await liffToken()}` };

    await runtime.handle({ method: "GET", path: "/api/v1/groups", headers });
    await runtime.handle({ method: "GET", path: `/api/v1/groups/${LEDGER}`, headers });

    const checks = rpcs.filter((call) => call.fn === "line_liff_link_live");
    expect(checks).toHaveLength(2);
    expect(checks[0].args).toEqual({ p_user: "user_alice", p_ledger: LEDGER, p_line_sub_hash: HASH });
  });

  // [MV]: remove the liveness check and unlinking would leave the token working for the rest of its hour.
  test("unlinking (the link check says no) ends the session at once: 401", async () => {
    const { client } = liffClient(false);

    const response = await makeRuntime(client).handle({
      method: "GET",
      path: `/api/v1/groups/${LEDGER}`,
      headers: { authorization: `Bearer ${await liffToken()}` },
    });

    expect(response.status).toBe(401);
    expect(code(response)).toBe("UNAUTHENTICATED");
  });

  test("when the link cannot be checked the request is refused (503), not waved through", async () => {
    const { client } = liffClient(new Error("db down"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await makeRuntime(client).handle({
      method: "GET",
      path: `/api/v1/groups/${LEDGER}`,
      headers: { authorization: `Bearer ${await liffToken()}` },
    });

    expect(response.status).toBe(503);
    expect(code(response)).toBe("LINE_UNAVAILABLE");
    spy.mockRestore();
  });

  test.each([
    ["DELETE", "/api/v1/me"],
    ["GET", "/api/v1/admin/me"],
    ["GET", "/api/v1/admin/users"],
    ["POST", "/api/v1/admin/view-as"],
    ["GET", "/api/v1/me/line"],
    ["DELETE", "/api/v1/me/line"],
    ["PATCH", `/api/v1/groups/${LEDGER}`],
    ["POST", `/api/v1/groups/${LEDGER}/invites`],
    ["POST", `/api/v1/groups/${LEDGER}/archive`],
    ["POST", "/api/v1/groups"],
    ["GET", `/api/v1/groups/${SHARED}`],
    ["GET", `/api/v1/groups/${SHARED}/expenses`],
    ["POST", `/api/v1/groups/${SHARED}/expenses`],
    ["POST", "/api/v1/receipts/scan"],
    ["POST", "/api/v1/push/subscribe"],
    ["GET", "/api/v1/notifications"],
    ["POST", "/api/v1/feedback"],
    ["POST", "/api/v1/auth/google"],
    ["GET", "/api/v1/nope"],
  ] as const)("%s %s is refused 403 LIFF_SCOPE before any handler runs", async (method, path) => {
    const { client, rpcs } = liffClient();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await makeRuntime(client).handle({
      method,
      path,
      headers: { authorization: `Bearer ${await liffToken()}` },
      json: {},
    });

    expect(response.status).toBe(403);
    expect(code(response)).toBe("LIFF_SCOPE");
    // Nothing ran: no handler RPC, not even the liveness check.
    expect(rpcs.map((call) => call.fn).filter((fn) => fn !== "consume_rate_limit" && fn !== "site_notice_settings")).toEqual([]);
    warn.mockRestore();
  });

  test("a token for another ledger cannot reach this one", async () => {
    const { client } = liffClient();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const other = "11111111-2222-4333-8444-555555555555";

    const response = await makeRuntime(client).handle({
      method: "GET",
      path: `/api/v1/groups/${LEDGER}/expenses`,
      headers: { authorization: `Bearer ${await liffToken({ ledger_id: other })}` },
    });

    expect(response.status).toBe(403);
    expect(code(response)).toBe("LIFF_SCOPE");
    warn.mockRestore();
  });

  test("writes inside the scope work: an expense on its own ledger, a delete", async () => {
    const { client } = liffClient();
    const runtime = makeRuntime(client);
    const headers = { authorization: `Bearer ${await liffToken()}` };

    const created = await runtime.handle({
      method: "POST",
      path: `/api/v1/groups/${LEDGER}/expenses`,
      headers,
      json: {
        client_request_id: "req_liff_expense",
        title: "Dinner",
        amount_minor: 120000,
        currency: "TWD",
        expense_payments: [{ payer_member_id: "member_owner", amount_minor: 120000, currency: "TWD" }],
        expense_shares: [{ member_id: "member_owner", share_type: "fixed", amount_minor: 120000 }],
      },
    });
    const removed = await runtime.handle({
      method: "DELETE",
      path: `/api/v1/groups/${LEDGER}/expenses/expense_1`,
      headers,
      json: { client_request_id: "req_liff_delete" },
    });

    expect(created.status).toBe(201);
    expect(removed.status).toBe(200);
  });

  // [MV]: a route verifier that falls through to the Google verifier would turn any junk after equoL1. into "Alice".
  test("a LIFF token never reaches the session or Google verifiers, even where the Google one accepts anything", async () => {
    const { client } = liffClient();
    const seen: string[] = [];
    const runtime = makeRuntime(client, {
      verifier: async (idToken) => {
        seen.push(idToken);
        return { auth_user_id: "user_alice", google_sub: idToken, email: "alice@example.com", display_name: "Alice" };
      },
    });

    // Correctly signed and in scope: served through the LIFF identity (fast path, no upsert).
    const ok = await runtime.handle({ method: "GET", path: `/api/v1/groups/${LEDGER}`, headers: { authorization: `Bearer ${await liffToken()}` } });
    // Forged: the gate says 401 and the Google verifier is never consulted.
    const forged = await runtime.handle({ method: "GET", path: `/api/v1/groups/${LEDGER}`, headers: { authorization: "Bearer equoL1.eyJ4IjoxfQ.AAAA" } });

    expect(ok.status).toBe(200);
    expect(forged.status).toBe(401);
    expect(seen).toEqual([]);
  });

  test("an expired token is a 401, not a fall-through", async () => {
    const { client } = liffClient();

    const response = await makeRuntime(client, { now: 1_000 + 61 * 60_000 }).handle({
      method: "GET",
      path: `/api/v1/groups/${LEDGER}`,
      headers: { authorization: `Bearer ${await liffToken()}` },
    });

    expect(response.status).toBe(401);
  });

  test("a deployment with no session secret trusts no LIFF token", async () => {
    const { client } = liffClient();

    const response = await makeRuntime(client, { sessionSecret: undefined }).handle({
      method: "GET",
      path: `/api/v1/groups/${LEDGER}`,
      headers: { authorization: `Bearer ${await liffToken()}` },
    });

    expect(response.status).toBe(401);
  });

  test("a LIFF token smuggled into a cookie is gated the same way", async () => {
    const { client } = liffClient();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const token = await liffToken();

    const denied = await makeRuntime(client).handle({ method: "GET", path: "/api/v1/admin/me", headers: { cookie: `equo_session=${token}` } });
    const revoked = await makeRuntime(liffClient(false).client).handle({
      method: "GET",
      path: `/api/v1/groups/${LEDGER}`,
      headers: { cookie: `equo_session=${token}` },
    });

    expect(denied.status).toBe(403);
    expect(revoked.status).toBe(401);
    warn.mockRestore();
  });

  // The view-as write block is in front of the gate and unchanged: a LIFF bearer does not lift it.
  test("a write is still refused while an equo_view_as cookie is present", async () => {
    const { client } = liffClient();
    const { createViewAsToken } = await import("../auth/sessionToken.js");
    const view = createViewAsToken(
      { auth_user_id: "user_alice", google_sub: "google_alice", email: "alice@example.com", display_name: "Alice" },
      "user_admin",
      SECRET,
      1_000,
    );

    const response = await makeRuntime(client).handle({
      method: "POST",
      path: `/api/v1/groups/${LEDGER}/expenses`,
      headers: { authorization: `Bearer ${await liffToken()}`, cookie: `equo_view_as=${view}` },
      json: { client_request_id: "req_x", title: "x", amount_minor: 1, currency: "TWD" },
    });

    expect(response.status).toBe(403);
    expect(code(response)).toBe("VIEW_AS_READONLY");
  });

  test("a LIFF write is charged to its user, not to the shared carrier address", async () => {
    const { client, rpcs } = liffClient();

    await makeRuntime(client).handle({
      method: "DELETE",
      path: `/api/v1/groups/${LEDGER}/expenses/expense_1`,
      headers: { authorization: `Bearer ${await liffToken()}`, "x-forwarded-for": "203.0.113.9" },
      json: { client_request_id: "req_liff_delete" },
    });

    const limited = rpcs.find((call) => call.fn === "consume_rate_limit");
    expect(limited?.args.p_bucket).toBe("write:u:user_alice");
  });

  test("a LIFF write over the limit is a 429 before the gate's database check", async () => {
    const base = liffClient().client;
    const rpcs: string[] = [];
    const client: PostgrestClient = {
      ...base,
      async rpc<T>(fn: string, args: Record<string, unknown>) {
        rpcs.push(fn);
        if (fn === "consume_rate_limit") return { allowed: false, retry_after: 12 } as T;
        return base.rpc<T>(fn, args);
      },
    };

    const response = await makeRuntime(client).handle({
      method: "POST",
      path: `/api/v1/groups/${LEDGER}/expenses`,
      headers: { authorization: `Bearer ${await liffToken()}` },
      json: {},
    });

    expect(response.status).toBe(429);
    expect(rpcs).not.toContain("line_liff_link_live");
  });

  test("an ordinary session and a Google token never trigger the link check", async () => {
    const { client, rpcs } = liffClient();
    const runtime = makeRuntime(client);

    await runtime.handle({ method: "GET", path: "/api/v1/groups", headers: { authorization: "Bearer google-token" } });
    await runtime.handle({ method: "GET", path: "/api/v1/site-notice", headers: {} });

    expect(rpcs.map((call) => call.fn)).not.toContain("line_liff_link_live");
  });

  describe("exchanging a LINE ID token", () => {
    const SUB = "U" + "a".repeat(32);
    const IDENTITY = {
      ok: true,
      user: { id: "user_alice", google_sub: "google_alice", email: "alice@example.com", display_name: "Alice", avatar_url: null },
      ledger_id: LEDGER,
      locale: "zh-Hant",
    };
    const goodVerify = async () => ({
      ok: true as const,
      claims: { iss: "https://access.line.me", sub: SUB, aud: "1234567890", exp: 9_999_999, iat: 1 },
    });
    const LIFF_ON = { liffId: "1234567890-AbcdEfgh", verifyIdToken: goodVerify };

    /** liffClient plus the identity RPC. */
    function exchangeClient(identity: unknown = IDENTITY, live: unknown = true) {
      const { client: base, rpcs, inserts } = liffClient(live);
      const client: PostgrestClient = {
        ...base,
        async rpc<T>(fn: string, args: Record<string, unknown>) {
          if (fn === "line_liff_identity") {
            rpcs.push({ fn, args });
            return identity as T;
          }
          return base.rpc<T>(fn, args);
        },
      };
      return { client, rpcs, inserts };
    }

    function exchangeRuntime(client: PostgrestClient) {
      return makeRuntime(client, { lineLiff: LIFF_ON });
    }

    const exchange = (runtime: ReturnType<typeof makeRuntime>, extra: Record<string, unknown> = {}) =>
      runtime.handle({
        method: "POST",
        path: "/api/v1/auth/line",
        headers: { "x-forwarded-for": "203.0.113.9" },
        json: { id_token: "aaa.bbb.ccc" },
        ...extra,
      });

    function maintenanceOn(base: PostgrestClient): PostgrestClient {
      return {
        ...base,
        async rpc<T>(fn: string, args: Record<string, unknown>) {
          if (fn === "site_notice_settings") {
            return {
              banner: { message: "", level: "info", ends_at: null, active: false },
              maintenance: { enabled: true, message: "maintenance" },
            } as T;
          }
          return base.rpc<T>(fn, args);
        },
      };
    }

    test("GET /line/liff needs no credential and reports the LIFF id", async () => {
      const { client } = exchangeClient();

      const response = await exchangeRuntime(client).handle({ method: "GET", path: "/api/v1/line/liff", headers: {} });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ liff_id: "1234567890-AbcdEfgh" });
      expect(response.headers["cache-control"]).toBe("no-store");
    });

    test("GET /line/liff reports null when LIFF is not configured", async () => {
      const { client } = exchangeClient();

      const response = await makeRuntime(client).handle({ method: "GET", path: "/api/v1/line/liff", headers: {} });

      expect(response.status).toBe(200);
      expect(response.body).toEqual({ liff_id: null });
    });

    test("POST /auth/line is 503 LINE_UNAVAILABLE when LIFF is not configured, and the database is not asked who it is", async () => {
      const { client, rpcs } = exchangeClient();

      const response = await exchange(makeRuntime(client));

      expect(response.status).toBe(503);
      expect(code(response)).toBe("LINE_UNAVAILABLE");
      expect(rpcs.map((call) => call.fn)).not.toContain("line_liff_identity");
    });

    test("POST /auth/line without SESSION_SECRET is 503 RUNTIME_ENV_MISSING", async () => {
      const { client } = exchangeClient();

      const response = await exchange(makeRuntime(client, { sessionSecret: undefined, lineLiff: LIFF_ON }));

      expect(response.status).toBe(503);
      expect(code(response)).toBe("RUNTIME_ENV_MISSING");
    });

    test("an exchange returns a token in the body and sets no cookie", async () => {
      const { client } = exchangeClient();

      const response = await exchange(exchangeRuntime(client));

      expect(response.status).toBe(200);
      expect((response.body as { session: { token: string } }).session.token.startsWith("equoL1.")).toBe(true);
      expect(Object.keys(response.headers).map((name) => name.toLowerCase())).not.toContain("set-cookie");
      expect(response.headers["cache-control"]).toBe("no-store");
    });

    test("the exchange is charged to the ADDRESS under its own rule, and to the account", async () => {
      const { client, rpcs } = exchangeClient();

      await exchange(exchangeRuntime(client));

      const buckets = rpcs.filter((call) => call.fn === "consume_rate_limit").map((call) => String(call.args.p_bucket));
      expect(buckets).toContain("lineAuth:ip:203.0.113.9");
      expect(buckets.some((bucket) => bucket.startsWith("lineAuth:s:"))).toBe(true);
    });

    test("an exchange over the address limit is a 429 and LINE is never asked", async () => {
      const base = exchangeClient().client;
      const verify = vi.fn(goodVerify);
      const client: PostgrestClient = {
        ...base,
        async rpc<T>(fn: string, args: Record<string, unknown>) {
          if (fn === "consume_rate_limit") return { allowed: false, retry_after: 7 } as T;
          return base.rpc<T>(fn, args);
        },
      };

      const response = await exchange(makeRuntime(client, { lineLiff: { liffId: "1234567890-AbcdEfgh", verifyIdToken: verify } }));

      expect(response.status).toBe(429);
      expect(verify).not.toHaveBeenCalled();
    });

    test("the exchange is not stopped by maintenance mode", async () => {
      const { resetSiteNoticeCache } = await import("./maintenance.js");
      resetSiteNoticeCache();

      try {
        const response = await exchange(exchangeRuntime(maintenanceOn(exchangeClient().client)));

        expect(response.status).toBe(200);
      } finally {
        resetSiteNoticeCache();
      }
    });

    test("a LIFF write IS stopped by maintenance mode, like any other write", async () => {
      const { resetSiteNoticeCache } = await import("./maintenance.js");
      resetSiteNoticeCache();

      try {
        const response = await makeRuntime(maintenanceOn(liffClient().client)).handle({
          method: "POST",
          path: `/api/v1/groups/${LEDGER}/expenses`,
          headers: { authorization: `Bearer ${await liffToken()}` },
          json: {},
        });

        expect(response.status).toBe(503);
        expect(code(response)).toBe("MAINTENANCE");
      } finally {
        resetSiteNoticeCache();
      }
    });

    test("an exchanged token works end to end: lists only its ledger, and is refused everywhere else", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const { client } = exchangeClient();
      const runtime = exchangeRuntime(client);
      const token = ((await exchange(runtime)).body as { session: { token: string } }).session.token;
      const headers = { authorization: `Bearer ${token}` };

      const groups = await runtime.handle({ method: "GET", path: "/api/v1/groups", headers });
      expect((groups.body as { groups: Array<{ id: string }> }).groups.map((group) => group.id)).toEqual([LEDGER]);

      for (const [method, path] of [
        ["GET", "/api/v1/admin/users"],
        ["DELETE", "/api/v1/me"],
        ["GET", `/api/v1/groups/${SHARED}`],
        ["POST", "/api/v1/me/line/link"],
      ] as const) {
        const refused = await runtime.handle({ method, path, headers });
        expect([method, path, refused.status, code(refused)]).toEqual([method, path, 403, "LIFF_SCOPE"]);
      }
    });

    test("a LIFF token sent along with an exchange is refused: the client must exchange without Authorization", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const { client } = exchangeClient();

      const response = await exchange(exchangeRuntime(client), {
        headers: { authorization: `Bearer ${await liffToken()}`, "x-forwarded-for": "203.0.113.9" },
      });

      // The token in hand cannot be used to mint another one.
      expect(response.status).toBe(403);
      expect(code(response)).toBe("LIFF_SCOPE");
    });

    test("an unlinked LINE account gets 403 and no token", async () => {
      vi.spyOn(console, "warn").mockImplementation(() => {});
      const { client } = exchangeClient({ ok: false, reason: "not_linked" });

      const response = await exchange(exchangeRuntime(client));

      expect(response.status).toBe(403);
      expect(code(response)).toBe("LINE_NOT_LINKED");
      expect(JSON.stringify(response.body)).not.toContain("equoL1");
    });

    test("a view-as cookie blocks the exchange like every other write", async () => {
      const { client } = exchangeClient();

      const response = await exchange(exchangeRuntime(client), {
        headers: { cookie: "equo_view_as=anything", "x-forwarded-for": "203.0.113.9" },
      });

      expect(response.status).toBe(403);
      expect(code(response)).toBe("VIEW_AS_READONLY");
    });
  });
});
