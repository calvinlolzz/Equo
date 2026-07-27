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
      if (fn === "soft_delete_expense") return { ...expenseRow, version: 2 };
      if (fn === "accept_invite") return { group: groupRow, member: ownerMember, claimed: false };
      if (fn === "create_settlement") {
        return {
          id: "settlement_1",
          group_id: args.p_group_id,
          settlement_version: args.p_settlement_version,
          calculated_version: 1,
          status: "draft",
        };
      }
      return null;
    },
  });
}

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
