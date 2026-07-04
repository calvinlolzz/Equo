import { describe, expect, test } from "vitest";
import { createHttpRuntime } from "./runtime.js";
import type { SupabaseQueryClient } from "../repositories/supabaseGroupRepository.js";

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

      if (sql.includes("update public.groups")) {
        return { id: params[1], name: "Tokyo Trip", currency: "TWD", owner_member_id: params[0] } as never;
      }

      throw new Error(sql);
    },
    async maybeOne() {
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

  test("authorizes API routes from the Equo session cookie", async () => {
    const runtime = createHttpRuntime({
      client: makeClient(),
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

  test("returns 404 for unknown API paths", async () => {
    const runtime = createHttpRuntime({
      client: makeClient(),
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
