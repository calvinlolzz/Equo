import { describe, expect, test } from "vitest";
import { createHttpRuntime } from "./runtime.js";
import type { SupabaseQueryClient } from "../repositories/supabaseGroupRepository.js";
import type { SupabaseStorageClient } from "../runtime/supabaseStorageClient.js";

function makeStorage(): SupabaseStorageClient {
  return {
    async uploadImage({ pathPrefix, ext }) {
      return { url: `https://example.supabase.co/storage/v1/object/public/equo-images/${pathPrefix}/uploaded.${ext}` };
    },
  };
}

function makeClient(): SupabaseQueryClient {
  return {
    async one(sql, params) {
      if (sql.includes("insert into public.users")) {
        return {
          id: "user_alice",
          google_sub: "google-alice",
          email: "alice@example.com",
          display_name: "Alice",
        } as never;
      }

      if (sql.includes("insert into public.groups")) {
        return { id: "group_1", name: params[0], currency: params[1], owner_member_id: null } as never;
      }

      if (sql.includes("from public.groups g") && sql.includes("archived_at is not null")) {
        return [
          {
            id: "group_2",
            name: "Osaka Trip",
            currency: "TWD",
            owner_member_id: "member_owner",
            archived_at: "2026-07-01T00:00:00.000Z",
          },
        ] as never;
      }

      if (sql.includes("from public.groups g")) {
        return [
          { id: "group_1", name: "Tokyo Trip", currency: "TWD", owner_member_id: "member_owner" },
        ] as never;
      }

      if (sql.includes("from public.group_members") && sql.includes("where group_id = $1 and status = 'active'")) {
        return [
          {
            id: "member_owner",
            group_id: params[0],
            user_id: "user_alice",
            display_name: "Alice",
            role: "owner",
            status: "active",
          },
        ] as never;
      }

      if (sql.includes("from public.expenses")) {
        return [
          {
            id: "expense_1",
            group_id: params[0],
            title: "Dinner",
            kind: "expense",
            amount_minor: 120000,
            currency: "TWD",
            version: 1,
            client_request_id: "expense_req",
          },
        ] as never;
      }

      if (sql.includes("from public.expense_payments")) {
        return [{ expense_id: "expense_1", payer_member_id: "member_owner", amount_minor: 120000, currency: "TWD" }] as never;
      }

      if (sql.includes("from public.expense_shares")) {
        return [
          { expense_id: "expense_1", member_id: "member_owner", share_type: "equal", amount_minor: 120000 },
        ] as never;
      }

      if (sql.includes("from public.group_member_balances")) {
        return [{ memberId: "member_owner", balance: { amount_minor: 120000, currency: "TWD" } }] as never;
      }

      if (sql.includes("insert into public.group_members")) {
        return {
          id: "member_owner",
          group_id: params[0],
          user_id: params[1],
          display_name: params[2],
          role: "owner",
          status: "active",
        } as never;
      }

      if (sql.includes("update public.groups") && sql.includes("set archived_at = null")) {
        return { id: params[0], name: "Osaka Trip", currency: "TWD", owner_member_id: "member_owner" } as never;
      }

      if (sql.includes("update public.groups")) {
        return { id: params[1], name: "Tokyo Trip", currency: "TWD", owner_member_id: params[0] } as never;
      }

      if (sql.includes("update public.group_members") && sql.includes("set display_name = $1")) {
        return {
          id: params[1],
          group_id: params[2],
          user_id: null,
          display_name: params[0],
          role: "member",
          status: "active",
        } as never;
      }

      if (sql.includes("update public.group_members") && sql.includes("set status = 'removed'")) {
        return {
          id: params[0],
          group_id: params[1],
          user_id: null,
          display_name: "Bob",
          role: "member",
          status: "removed",
        } as never;
      }

      throw new Error(sql);
    },
    async maybeOne(sql) {
      if (sql.includes("get_group_detail")) {
        return {
          group: { id: "group_1", name: "Tokyo Trip", currency: "TWD", owner_member_id: "member_owner" },
          members: [
            {
              id: "member_owner",
              group_id: "group_1",
              user_id: "user_alice",
              display_name: "Alice",
              role: "owner",
              status: "active",
            },
          ],
          expenses: [
            {
              id: "expense_1",
              group_id: "group_1",
              title: "Dinner",
              kind: "expense",
              amount_minor: 120000,
              currency: "TWD",
              version: 1,
              client_request_id: "expense_req",
            },
          ],
          balances: [{ memberId: "member_owner", balance: { amount_minor: 120000, currency: "TWD" } }],
        } as never;
      }

      // Target lookup for member management (rename/remove): a VIRTUAL member.
      if (sql.includes("where group_id = $1 and id = $2")) {
        return {
          id: "member_virtual",
          group_id: "group_1",
          user_id: null,
          display_name: "Bob",
          role: "member",
          status: "active",
        } as never;
      }

      if (sql.includes("from public.group_member_balances")) {
        return { balance_minor: 0 } as never;
      }

      return {
        id: "member_owner",
        group_id: "group_1",
        user_id: "user_alice",
        display_name: "Alice",
        role: "owner",
        status: "active",
      } as never;
    },
    async exec() {},
  };
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
    const countingClient: SupabaseQueryClient = {
      ...client,
      async one(sql, params) {
        if (sql.includes("insert into public.users")) {
          userUpsertCount += 1;
        }
        return client.one(sql, params);
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
