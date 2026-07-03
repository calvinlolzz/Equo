import { describe, expect, test } from "vitest";
import { createGoogleTokenVerifier } from "./googleTokenVerifier.js";
import { missingRuntimeEnv, readRuntimeEnv } from "./runtimeEnv.js";
import { createSupabaseRestQueryClient } from "./supabaseQueryClient.js";

describe("runtime adapters", () => {
  test("rejects Google tokens with the wrong audience", async () => {
    const verifier = createGoogleTokenVerifier("client-a", async () => ({
      ok: true,
      async json() {
        return {
          sub: "google-user",
          aud: "client-b",
          email: "alice@example.com",
          email_verified: "true",
        };
      },
    }));

    await expect(verifier("token")).resolves.toBeNull();
  });

  test("maps Google tokeninfo into GoogleIdentity", async () => {
    const verifier = createGoogleTokenVerifier("client-a", async () => ({
      ok: true,
      async json() {
        return {
          sub: "google-user",
          aud: "client-a",
          email: "alice@example.com",
          email_verified: "true",
          name: "Alice",
          picture: "https://example.com/avatar.png",
        };
      },
    }));

    await expect(verifier("token")).resolves.toEqual({
      auth_user_id: "google-user",
      google_sub: "google-user",
      email: "alice@example.com",
      display_name: "Alice",
      avatar_url: "https://example.com/avatar.png",
    });
  });

  test("reports missing Supabase runtime env", () => {
    const env = readRuntimeEnv({
      SUPABASE_URL: "https://example.supabase.co",
    });

    expect(missingRuntimeEnv(env)).toEqual([
      "SUPABASE_ANON_KEY",
      "SUPABASE_SERVICE_ROLE_KEY",
      "GOOGLE_OAUTH_CLIENT_ID",
      "SESSION_SECRET",
    ]);
  });

  test("creates groups through Supabase REST with service role headers", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createSupabaseRestQueryClient({
      url: "https://example.supabase.co",
      serviceRoleKey: "service-role-key",
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return {
          ok: true,
          async json() {
            return [{ id: "group_1", name: "Tokyo", currency: "TWD", owner_member_id: null }];
          },
        } as Response;
      },
    });

    await expect(
      client.one(
        `
          insert into public.groups (name, currency, owner_id)
          values ($1, $2, $3)
          returning id, name, currency, owner_member_id
        `,
        ["Tokyo", "TWD", "user_1"],
      ),
    ).resolves.toEqual({ id: "group_1", name: "Tokyo", currency: "TWD", owner_member_id: null });

    expect(calls[0].url).toBe("https://example.supabase.co/rest/v1/groups?select=id,name,currency,owner_member_id");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({
      apikey: "service-role-key",
      Authorization: "Bearer service-role-key",
      Prefer: "return=representation",
    });
    expect(calls[0].init.body).toBe(JSON.stringify({ name: "Tokyo", currency: "TWD", owner_id: "user_1" }));
  });

  test("lists groups without embedded REST joins to avoid ambiguous relationships", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createSupabaseRestQueryClient({
      url: "https://example.supabase.co",
      serviceRoleKey: "service-role-key",
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        if (String(url).includes("/group_members?")) {
          return {
            ok: true,
            async json() {
              return [{ group_id: "group_1" }, { group_id: "group_2" }];
            },
          } as Response;
        }

        return {
          ok: true,
          async json() {
            return [
              { id: "group_1", name: "Tokyo", currency: "TWD", owner_member_id: "member_1" },
              { id: "group_2", name: "Osaka", currency: "TWD", owner_member_id: "member_2" },
            ];
          },
        } as Response;
      },
    });

    await expect(
      client.one(
        `
          select g.id, g.name, g.currency, g.owner_member_id
          from public.groups g
          join public.group_members gm on gm.group_id = g.id
          where gm.user_id = $1
            and gm.status = 'active'
            and g.deleted_at is null
          order by g.updated_at desc, g.created_at desc
          limit 50
        `,
        ["user_1"],
      ),
    ).resolves.toEqual([
      { id: "group_1", name: "Tokyo", currency: "TWD", owner_member_id: "member_1" },
      { id: "group_2", name: "Osaka", currency: "TWD", owner_member_id: "member_2" },
    ]);

    expect(calls[0].url).toContain("/rest/v1/group_members?select=group_id");
    expect(calls[1].url).toContain("/rest/v1/groups?select=id,name,currency,owner_member_id&id=in.(group_1,group_2)");
    expect(calls[1].url).toContain("archived_at=is.null");
    expect(calls[1].url).not.toContain("groups!inner");
  });

  test("archives and deletes groups with the correct REST update payloads", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createSupabaseRestQueryClient({
      url: "https://example.supabase.co",
      serviceRoleKey: "service-role-key",
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return {
          ok: true,
          async json() {
            return [{ id: "group_1", name: "Tokyo", currency: "TWD", owner_member_id: "member_1" }];
          },
        } as Response;
      },
    });

    await client.one(
      `
        update public.groups
        set archived_at = now(), updated_at = now()
        where id = $1 and deleted_at is null
        returning id, name, currency, owner_member_id
      `,
      ["group_1"],
    );
    await client.one(
      `
        update public.groups
        set deleted_at = now(), updated_at = now()
        where id = $1 and deleted_at is null
        returning id, name, currency, owner_member_id
      `,
      ["group_1"],
    );

    expect(calls[0].url).toContain("/rest/v1/groups?id=eq.group_1&deleted_at=is.null");
    expect(calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ archived_at: expect.any(String) });
    expect(calls[1].url).toContain("/rest/v1/groups?id=eq.group_1&deleted_at=is.null");
    expect(calls[1].init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[1].init.body))).toEqual({ deleted_at: expect.any(String) });
  });

  test("creates virtual members with the provided display name", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createSupabaseRestQueryClient({
      url: "https://example.supabase.co",
      serviceRoleKey: "service-role-key",
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return {
          ok: true,
          async json() {
            return [
              {
                id: "member_2",
                group_id: "group_1",
                user_id: null,
                display_name: "Bob",
                role: "member",
                status: "active",
              },
            ];
          },
        } as Response;
      },
    });

    await client.one(
      `
        insert into public.group_members (group_id, user_id, display_name, role, status)
        values ($1, null, $2, 'member', 'active')
        returning id, group_id, user_id, display_name, role, status
      `,
      ["group_1", "Bob"],
    );

    expect(calls[0].url).toContain("/rest/v1/group_members?select=id,group_id,user_id,display_name,role,status");
    expect(JSON.parse(String(calls[0].init.body))).toMatchObject({
      group_id: "group_1",
      user_id: null,
      display_name: "Bob",
      role: "member",
      status: "active",
    });
  });
});
