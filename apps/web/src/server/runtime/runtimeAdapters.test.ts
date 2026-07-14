import { describe, expect, test } from "vitest";
import { createGoogleTokenVerifier } from "./googleTokenVerifier.js";
import { missingRuntimeEnv, readRuntimeEnv } from "./runtimeEnv.js";
import { createSupabaseRestQueryClient } from "./supabaseQueryClient.js";
import { createSupabaseStorageClient } from "./supabaseStorageClient.js";

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
          insert into public.groups (name, currency, owner_id, cover_image_url)
          values ($1, $2, $3, $4)
          returning id, name, currency, owner_member_id, cover_image_url
        `,
        ["Tokyo", "TWD", "user_1", null],
      ),
    ).resolves.toEqual({ id: "group_1", name: "Tokyo", currency: "TWD", owner_member_id: null });

    expect(calls[0].url).toBe(
      "https://example.supabase.co/rest/v1/groups?select=id,name,currency,owner_member_id,cover_image_url",
    );
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({
      apikey: "service-role-key",
      Authorization: "Bearer service-role-key",
      Prefer: "return=representation",
    });
    expect(calls[0].init.body).toBe(
      JSON.stringify({ name: "Tokyo", currency: "TWD", owner_id: "user_1", cover_image_url: null }),
    );
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
    expect(calls[1].url).toContain(
      "/rest/v1/groups?select=id,name,currency,owner_member_id,cover_image_url&id=in.(group_1,group_2)",
    );
    expect(calls[1].url).toContain("archived_at=is.null");
    expect(calls[1].url).not.toContain("groups!inner");
    // The SQL says `order by g.updated_at desc, g.created_at desc` - without an
    // explicit order= the REST call returns rows in PostgREST's unspecified
    // order, and the groups list quietly stops being sorted by recent activity.
    expect(calls[1].url).toContain("order=updated_at.desc,created_at.desc");
  });

  test("refuses an expired invite even though its token hash still matches a row", async () => {
    const client = createSupabaseRestQueryClient({
      url: "https://example.supabase.co",
      serviceRoleKey: "service-role-key",
      fetcher: async () =>
        ({
          ok: true,
          async json() {
            return [
              {
                id: "invite_1",
                group_id: "group_1",
                token_hash: "hash_1",
                max_uses: 5,
                use_count: 0,
                expires_at: "2020-01-01T00:00:00.000Z",
                revoked_at: null,
              },
            ];
          },
        }) as Response,
    });

    // token_hash is unique, so the row always comes back - the expiry filter is
    // the only thing standing between an expired invite and joining the group.
    await expect(
      client.maybeOne(
        `
          select id, group_id, token_hash, max_uses, use_count, expires_at
          from public.invites
          where token_hash = $1
            and revoked_at is null
            and use_count < max_uses
            and (expires_at is null or expires_at > now())
          limit 1
        `,
        ["hash_1"],
      ),
    ).resolves.toBeNull();
  });

  test("accepts an unexpired, unrevoked, unexhausted invite", async () => {
    const client = createSupabaseRestQueryClient({
      url: "https://example.supabase.co",
      serviceRoleKey: "service-role-key",
      fetcher: async () =>
        ({
          ok: true,
          async json() {
            return [
              {
                id: "invite_1",
                group_id: "group_1",
                token_hash: "hash_1",
                max_uses: 5,
                use_count: 1,
                expires_at: "2999-01-01T00:00:00.000Z",
                revoked_at: null,
              },
            ];
          },
        }) as Response,
    });

    await expect(
      client.maybeOne(
        `
          select id, group_id, token_hash, max_uses, use_count, expires_at
          from public.invites
          where token_hash = $1
            and revoked_at is null
            and use_count < max_uses
            and (expires_at is null or expires_at > now())
          limit 1
        `,
        ["hash_1"],
      ),
    ).resolves.toMatchObject({ id: "invite_1", group_id: "group_1" });
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
    // updated_at rides along on every translated PATCH: the repository SQL says
    // `updated_at = now()` and no DB trigger maintains the column, so dropping
    // it here would freeze groups.updated_at - which listGroups orders by.
    expect(JSON.parse(String(calls[0].init.body))).toEqual({
      archived_at: expect.any(String),
      updated_at: expect.any(String),
    });
    expect(calls[1].url).toContain("/rest/v1/groups?id=eq.group_1&deleted_at=is.null");
    expect(calls[1].init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[1].init.body))).toEqual({
      deleted_at: expect.any(String),
      updated_at: expect.any(String),
    });
  });

  test("unarchives a group by clearing archived_at", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createSupabaseRestQueryClient({
      url: "https://example.supabase.co",
      serviceRoleKey: "service-role-key",
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return {
          ok: true,
          async json() {
            return [{ id: "group_1", name: "Tokyo", currency: "TWD", owner_member_id: "member_1", cover_image_url: null }];
          },
        } as Response;
      },
    });

    await expect(
      client.one(
        `
          update public.groups
          set archived_at = null, updated_at = now()
          where id = $1 and deleted_at is null
          returning id, name, currency, owner_member_id, cover_image_url
        `,
        ["group_1"],
      ),
    ).resolves.toEqual({
      id: "group_1",
      name: "Tokyo",
      currency: "TWD",
      owner_member_id: "member_1",
      cover_image_url: null,
    });

    expect(calls[0].url).toContain(
      "/rest/v1/groups?id=eq.group_1&deleted_at=is.null&select=id,name,currency,owner_member_id,cover_image_url",
    );
    expect(calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ archived_at: null, updated_at: expect.any(String) });
  });

  test("lists archived groups via a membership lookup followed by an archived_at filter", async () => {
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
              return [{ id: "member_1", group_id: "group_1" }];
            },
          } as Response;
        }

        return {
          ok: true,
          async json() {
            return [
              {
                id: "group_1",
                name: "Tokyo",
                currency: "TWD",
                owner_member_id: "member_1",
                archived_at: "2026-07-01T00:00:00.000Z",
                cover_image_url: null,
              },
            ];
          },
        } as Response;
      },
    });

    await expect(
      client.one(
        `
          select g.id, g.name, g.currency, g.owner_member_id, g.archived_at, g.cover_image_url, gm.id as caller_member_id
          from public.groups g
          join public.group_members gm on gm.group_id = g.id
          where gm.user_id = $1
            and gm.status = 'active'
            and g.archived_at is not null
            and g.deleted_at is null
          order by g.updated_at desc, g.created_at desc
          limit 50
        `,
        ["user_1"],
      ),
    ).resolves.toEqual([
      {
        id: "group_1",
        name: "Tokyo",
        currency: "TWD",
        owner_member_id: "member_1",
        archived_at: "2026-07-01T00:00:00.000Z",
        cover_image_url: null,
        caller_member_id: "member_1",
      },
    ]);

    expect(calls[0].url).toContain("/rest/v1/group_members?select=id,group_id");
    expect(calls[1].url).toContain(
      "/rest/v1/groups?select=id,name,currency,owner_member_id,archived_at,cover_image_url&id=in.(group_1)",
    );
    expect(calls[1].url).toContain("archived_at=not.is.null");
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

  test("renames virtual members through a PATCH restricted to unclaimed active rows", async () => {
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
                display_name: "Bobby",
                role: "member",
                status: "active",
              },
            ];
          },
        } as Response;
      },
    });

    await expect(
      client.one(
        `
          update public.group_members
          set display_name = $1, updated_at = now()
          where id = $2 and group_id = $3 and user_id is null and status = 'active'
          returning id, group_id, user_id, display_name, role, status
        `,
        ["Bobby", "member_2", "group_1"],
      ),
    ).resolves.toMatchObject({ id: "member_2", display_name: "Bobby" });

    expect(calls[0].url).toContain(
      "/rest/v1/group_members?id=eq.member_2&group_id=eq.group_1&user_id=is.null&status=eq.active",
    );
    expect(calls[0].init.method).toBe("PATCH");
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ display_name: "Bobby", updated_at: expect.any(String) });
  });

  test("removes virtual members by PATCHing status to removed, not the claim payload", async () => {
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
                status: "removed",
              },
            ];
          },
        } as Response;
      },
    });

    await expect(
      client.one(
        `
          update public.group_members
          set status = 'removed', updated_at = now()
          where id = $1 and group_id = $2 and user_id is null and status = 'active'
          returning id, group_id, user_id, display_name, role, status
        `,
        ["member_2", "group_1"],
      ),
    ).resolves.toMatchObject({ id: "member_2", status: "removed" });

    expect(calls[0].url).toContain(
      "/rest/v1/group_members?id=eq.member_2&group_id=eq.group_1&user_id=is.null&status=eq.active",
    );
    expect(calls[0].init.method).toBe("PATCH");
    // Must not fall through to the accept-invite claim branch, whose body
    // would set user_id/claimed_at instead.
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ status: "removed", updated_at: expect.any(String) });
  });

  test("looks up a member by id and a single member balance through Supabase REST", async () => {
    const calls: string[] = [];
    const client = createSupabaseRestQueryClient({
      url: "https://example.supabase.co",
      serviceRoleKey: "service-role-key",
      fetcher: async (url) => {
        calls.push(String(url));
        return {
          ok: true,
          async json() {
            return [{ id: "member_2", balance_minor: 0 }];
          },
        } as Response;
      },
    });

    await client.maybeOne(
      `
        select id, group_id, user_id, display_name, role, status
        from public.group_members
        where group_id = $1 and id = $2
        limit 1
      `,
      ["group_1", "member_2"],
    );
    await client.maybeOne(
      `
        select balance_minor
        from public.group_member_balances
        where group_id = $1 and member_id = $2
        limit 1
      `,
      ["group_1", "member_2"],
    );

    expect(calls[0]).toContain("/rest/v1/group_members?select=id,group_id,user_id,display_name,role,status");
    expect(calls[0]).toContain("group_id=eq.group_1&id=eq.member_2&limit=1");
    expect(calls[1]).toContain("/rest/v1/group_member_balances?select=balance_minor");
    expect(calls[1]).toContain("group_id=eq.group_1&member_id=eq.member_2&limit=1");
  });

  test("batch-fetches expense payments by expense ids through Supabase REST", async () => {
    const calls: string[] = [];
    const client = createSupabaseRestQueryClient({
      url: "https://example.supabase.co",
      serviceRoleKey: "service-role-key",
      fetcher: async (url) => {
        calls.push(String(url));
        return {
          ok: true,
          async json() {
            return [{ expense_id: "exp_1", payer_member_id: "m1", amount_minor: 100, currency: "TWD" }];
          },
        } as Response;
      },
    });

    await client.one(
      `
        select expense_id, payer_member_id, amount_minor, currency
        from public.expense_payments
        where expense_id = any($1)
      `,
      [["exp_1", "exp_2"]],
    );

    expect(calls[0]).toContain("/rest/v1/expense_payments");
    expect(calls[0]).toContain("select=expense_id,payer_member_id,amount_minor,currency");
    expect(calls[0]).toContain("expense_id=in.(exp_1,exp_2)");
  });

  test("batch-fetches expense shares by expense ids through Supabase REST", async () => {
    const calls: string[] = [];
    const client = createSupabaseRestQueryClient({
      url: "https://example.supabase.co",
      serviceRoleKey: "service-role-key",
      fetcher: async (url) => {
        calls.push(String(url));
        return {
          ok: true,
          async json() {
            return [{ expense_id: "exp_1", member_id: "m1", share_type: "fixed", share_value: null, amount_minor: 50 }];
          },
        } as Response;
      },
    });

    await client.one(
      `
        select expense_id, member_id, share_type, share_value, amount_minor
        from public.expense_shares
        where expense_id = any($1)
      `,
      [["exp_1"]],
    );

    expect(calls[0]).toContain("/rest/v1/expense_shares");
    expect(calls[0]).toContain("select=expense_id,member_id,share_type,share_value,amount_minor");
    expect(calls[0]).toContain("expense_id=in.(exp_1)");
  });
});

describe("createSupabaseStorageClient", () => {
  test("uploads bytes to the equo-images bucket with service role auth", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const storage = createSupabaseStorageClient({
      url: "https://example.supabase.co",
      serviceRoleKey: "service-role-key",
      randomUUID: () => "fixed-uuid",
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return { ok: true } as Response;
      },
    });

    const bytes = new Uint8Array([1, 2, 3]);
    await expect(
      storage.uploadImage({ pathPrefix: "group_1", ext: "jpg", bytes, contentType: "image/jpeg" }),
    ).resolves.toEqual({
      url: "https://example.supabase.co/storage/v1/object/public/equo-images/group_1/fixed-uuid.jpg",
    });

    expect(calls[0].url).toBe(
      "https://example.supabase.co/storage/v1/object/equo-images/group_1/fixed-uuid.jpg",
    );
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({
      Authorization: "Bearer service-role-key",
      "Content-Type": "image/jpeg",
      "x-upsert": "false",
    });
    expect(calls[0].init.body).toBeInstanceOf(Blob);
    expect(await (calls[0].init.body as Blob).arrayBuffer()).toEqual(bytes.buffer);
  });

  test("throws when the upload response is not ok", async () => {
    const storage = createSupabaseStorageClient({
      url: "https://example.supabase.co",
      serviceRoleKey: "service-role-key",
      fetcher: async () => ({ ok: false, status: 413 }) as Response,
    });

    await expect(
      storage.uploadImage({ pathPrefix: "group_1", ext: "jpg", bytes: new Uint8Array(), contentType: "image/jpeg" }),
    ).rejects.toThrow("Supabase storage upload failed: 413");
  });

  test("calls the get_group_detail RPC via the Postgres RPC endpoint and returns the jsonb value directly", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const rpcResult = {
      group: { id: "group_1", name: "Tokyo Trip", currency: "TWD", owner_member_id: "member_1", cover_image_url: null },
      members: [
        {
          id: "member_1",
          group_id: "group_1",
          user_id: "user_1",
          display_name: "Alice",
          role: "owner",
          status: "active",
        },
      ],
      expenses: [],
      balances: [],
    };
    const client = createSupabaseRestQueryClient({
      url: "https://example.supabase.co",
      serviceRoleKey: "service-role-key",
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return {
          ok: true,
          async json() {
            return rpcResult;
          },
        } as Response;
      },
    });

    await expect(
      client.maybeOne(`select public.get_group_detail($1, $2) as detail`, ["group_1", "user_1"]),
    ).resolves.toEqual(rpcResult);

    expect(calls[0].url).toBe("https://example.supabase.co/rest/v1/rpc/get_group_detail");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.headers).toMatchObject({
      apikey: "service-role-key",
      Authorization: "Bearer service-role-key",
      "Content-Type": "application/json",
    });
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ p_group_id: "group_1", p_user_id: "user_1" });
  });

  test("returns null from get_group_detail when the caller is not an active member (or the group is missing)", async () => {
    const client = createSupabaseRestQueryClient({
      url: "https://example.supabase.co",
      serviceRoleKey: "service-role-key",
      fetcher: async () =>
        ({
          ok: true,
          async json() {
            return null;
          },
        }) as Response,
    });

    await expect(
      client.maybeOne(`select public.get_group_detail($1, $2) as detail`, ["group_1", "user_1"]),
    ).resolves.toBeNull();
  });
});
