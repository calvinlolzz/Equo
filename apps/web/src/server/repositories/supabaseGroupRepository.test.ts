import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import type { SupabaseQueryClient } from "./supabaseGroupRepository.js";
import { createSupabaseGroupRepository, updateUserAvatar, upsertUserByGoogleIdentity } from "./supabaseGroupRepository.js";

function makeClient(): SupabaseQueryClient & { calls: Array<{ method: string; sql: string; params: unknown[] }> } {
  const calls: Array<{ method: string; sql: string; params: unknown[] }> = [];

  return {
    calls,
    async one(sql, params) {
      calls.push({ method: "one", sql, params });

      if (sql.includes("insert into public.users")) {
        return {
          id: params[0],
          google_sub: params[1],
          email: params[2],
          display_name: params[3],
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
            caller_member_id: "member_owner",
          },
        ] as never;
      }

      if (sql.includes("from public.groups g")) {
        return [
          { id: "group_1", name: "Tokyo Trip", currency: "TWD", owner_member_id: "member_owner" },
        ] as never;
      }

      if (sql.includes("from public.group_members") && sql.includes("status = 'active'")) {
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
        return { id: params[1], name: "?曹漪??", currency: "TWD", owner_member_id: params[0] } as never;
      }

      if (sql.includes("insert into public.invites")) {
        return {
          id: "invite_1",
          group_id: params[0],
          token_hash: params[1],
          max_uses: params[2],
          use_count: 0,
          expires_at: params[3],
        } as never;
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

      if (sql.includes("select id, avatar_url") && sql.includes("from public.users")) {
        return { avatar_url: "https://example.supabase.co/storage/v1/object/public/equo-images/avatars/user_1/old.jpg" } as never;
      }

      if (sql.includes("update public.users") && sql.includes("set avatar_url = $1")) {
        return { avatar_url: params[0] } as never;
      }

      throw new Error(`Unexpected one query: ${sql}`);
    },
    async maybeOne(sql, params) {
      calls.push({ method: "maybeOne", sql, params });
      return {
        id: "member_owner",
        group_id: params[0],
        user_id: params[1],
        display_name: "Alice",
        role: "owner",
        status: "active",
      } as never;
    },
    async exec(sql, params) {
      calls.push({ method: "exec", sql, params });
    },
  };
}

const context = {
  user: {
    id: "user_alice",
    google_sub: "google-alice",
    email: "alice@example.com",
    display_name: "Alice",
  },
};

describe("createSupabaseGroupRepository", () => {
  test("upserts legacy profile alongside MVP user for live schema compatibility", async () => {
    const client = makeClient();

    await upsertUserByGoogleIdentity(client, {
      auth_user_id: "user_alice",
      google_sub: "google-alice",
      email: "alice@example.com",
      display_name: "Alice",
      avatar_url: "https://example.com/alice.png",
    });

    expect(client.calls.map((call) => call.sql)).toEqual([
      expect.stringContaining("insert into public.users"),
      expect.stringContaining("insert into public.profiles"),
    ]);
  });

  test("uses the persisted user id when upserting a profile after Google sub conflict", async () => {
    const client = makeClient();
    client.one = async (sql, params) => {
      client.calls.push({ method: "one", sql, params });

      return {
        id: "existing_user_id",
        google_sub: params[1],
        email: params[2],
        display_name: params[3],
      } as never;
    };

    await upsertUserByGoogleIdentity(client, {
      auth_user_id: "new_supabase_auth_user_id",
      google_sub: "google-alice",
      email: "alice@example.com",
      display_name: "Alice",
    });

    expect(client.calls[1]).toMatchObject({
      method: "exec",
      params: ["existing_user_id", "Alice", null],
    });
  });

  test("writes group and owner member in order", async () => {
    const client = makeClient();
    const repository = createSupabaseGroupRepository(client);

    await repository.createGroup(context, {
      client_request_id: "req_group",
      name: "?曹漪??",
      currency: "TWD",
    });

    expect(client.calls.map((call) => call.sql)).toEqual([
      expect.stringContaining("owner_id"),
      expect.stringContaining("insert into public.group_members"),
      expect.stringContaining("update public.groups"),
    ]);
    expect(client.calls[0].params).toEqual(["?曹漪??", "TWD", "user_alice", null]);
  });

  test("lists active groups for the current user", async () => {
    const client = makeClient();
    const repository = createSupabaseGroupRepository(client);

    const groups = await repository.listGroups(context);

    expect(groups).toEqual([
      { id: "group_1", name: "Tokyo Trip", currency: "TWD", owner_member_id: "member_owner" },
    ]);
    expect(client.calls[0]).toMatchObject({
      method: "one",
      params: ["user_alice"],
    });
    expect(client.calls[0].sql).toContain("join public.group_members");
  });

  test("lists active group members", async () => {
    const client = makeClient();
    const repository = createSupabaseGroupRepository(client);

    const members = await repository.listMembers("group_1");

    expect(members).toEqual([
      {
        id: "member_owner",
        group_id: "group_1",
        user_id: "user_alice",
        display_name: "Alice",
        role: "owner",
        status: "active",
      },
    ]);
    expect(client.calls[0].params).toEqual(["group_1"]);
  });

  test("stores invite token_hash instead of token", async () => {
    const client = makeClient();
    const repository = createSupabaseGroupRepository(client);

    const invite = await repository.createInvite(context, "group_1", {
      client_request_id: "req_invite",
      max_uses: 5,
    });

    // The token is a bearer credential, so what lands in the database must be
    // a real SHA-256 digest of it - never the token itself, and never a
    // reversible "sha256:<token>" tag (which is what this used to store).
    expect(invite.token).toMatch(/^EQO[2-9A-HJ-NP-Z]{12}$/);
    expect(invite.token_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(invite.token_hash).not.toContain(invite.token);
    expect(invite.token_hash).toBe(createHash("sha256").update(String(invite.token), "utf8").digest("hex"));
    expect(client.calls.some((call) => call.sql.includes("token_hash"))).toBe(true);
  });

  test("records client_request_id for idempotency", async () => {
    const client = makeClient();
    const repository = createSupabaseGroupRepository(client);

    await repository.recordClientRequest("group_1", "req_001", "resource_1");

    expect(client.calls[0]).toMatchObject({
      method: "exec",
      params: ["group_1", "req_001", "resource_1"],
    });
    expect(client.calls[0].sql).toContain("client_request_id");
  });

  test("lists archived groups for the current user", async () => {
    const client = makeClient();
    const repository = createSupabaseGroupRepository(client);

    const groups = await repository.listArchivedGroups(context);

    expect(groups).toEqual([
      {
        id: "group_2",
        name: "Osaka Trip",
        currency: "TWD",
        owner_member_id: "member_owner",
        archived_at: "2026-07-01T00:00:00.000Z",
        caller_member_id: "member_owner",
      },
    ]);
    expect(client.calls[0]).toMatchObject({
      method: "one",
      params: ["user_alice"],
    });
    expect(client.calls[0].sql).toContain("archived_at is not null");
    expect(client.calls[0].sql).toContain("caller_member_id");
  });

  test("unarchives a group", async () => {
    const client = makeClient();
    const repository = createSupabaseGroupRepository(client);

    const group = await repository.unarchiveGroup("group_2");

    expect(group).toEqual({
      id: "group_2",
      name: "Osaka Trip",
      currency: "TWD",
      owner_member_id: "member_owner",
    });
    expect(client.calls[0]).toMatchObject({
      method: "one",
      params: ["group_2"],
    });
    expect(client.calls[0].sql).toContain("set archived_at = null");
  });

  test("renames a virtual member with virtual-only and active-only filters", async () => {
    const client = makeClient();
    const repository = createSupabaseGroupRepository(client);

    const member = await repository.renameVirtualMember("group_1", "member_virtual", "Bobby");

    expect(member).toEqual({
      id: "member_virtual",
      group_id: "group_1",
      user_id: null,
      display_name: "Bobby",
      role: "member",
      status: "active",
    });
    expect(client.calls[0]).toMatchObject({
      method: "one",
      params: ["Bobby", "member_virtual", "group_1"],
    });
    expect(client.calls[0].sql).toContain("set display_name = $1");
    expect(client.calls[0].sql).toContain("user_id is null");
    expect(client.calls[0].sql).toContain("status = 'active'");
  });

  test("soft-removes a virtual member by flipping status to removed", async () => {
    const client = makeClient();
    const repository = createSupabaseGroupRepository(client);

    const member = await repository.removeVirtualMember("group_1", "member_virtual");

    expect(member).toMatchObject({ id: "member_virtual", status: "removed" });
    expect(client.calls[0]).toMatchObject({
      method: "one",
      params: ["member_virtual", "group_1"],
    });
    expect(client.calls[0].sql).toContain("set status = 'removed'");
    expect(client.calls[0].sql).toContain("user_id is null");
    expect(client.calls[0].sql).toContain("status = 'active'");
  });

  test("finds a member by id within a group", async () => {
    const client = makeClient();
    const repository = createSupabaseGroupRepository(client);

    await repository.findMemberById("group_1", "member_virtual");

    expect(client.calls[0]).toMatchObject({
      method: "maybeOne",
      params: ["group_1", "member_virtual"],
    });
    expect(client.calls[0].sql).toContain("where group_id = $1 and id = $2");
  });

  test("reads a member's balance and falls back to zero when the view has no row", async () => {
    const client = makeClient();
    const repository = createSupabaseGroupRepository(client);
    client.maybeOne = async (sql, params) => {
      client.calls.push({ method: "maybeOne", sql, params });
      return { balance_minor: 1200 } as never;
    };

    const balance = await repository.getMemberBalanceMinor("group_1", "member_virtual");

    expect(balance).toBe(1200);
    expect(client.calls[0].sql).toContain("from public.group_member_balances");
    expect(client.calls[0].sql).toContain("member_id = $2");
    expect(client.calls[0].params).toEqual(["group_1", "member_virtual"]);

    client.maybeOne = async (sql, params) => {
      client.calls.push({ method: "maybeOne", sql, params });
      return null as never;
    };

    await expect(repository.getMemberBalanceMinor("group_1", "member_virtual")).resolves.toBe(0);
  });

  test("updateUserAvatar sets users.avatar_url and mirrors it onto profiles.avatar_url", async () => {
    const client = makeClient();

    const result = await updateUserAvatar(
      client,
      "user_alice",
      "https://example.supabase.co/storage/v1/object/public/equo-images/avatars/user_alice/photo.jpg",
    );

    expect(result).toEqual({
      avatar_url: "https://example.supabase.co/storage/v1/object/public/equo-images/avatars/user_alice/photo.jpg",
      previousAvatarUrl: "https://example.supabase.co/storage/v1/object/public/equo-images/avatars/user_1/old.jpg",
    });
    // Reads the current avatar_url first (so the caller can clean up the old
    // one from storage) before writing the new value.
    expect(client.calls[0]).toMatchObject({ method: "one", params: ["user_alice"] });
    expect(client.calls[0].sql).toContain("select id, avatar_url");
    expect(client.calls[1]).toMatchObject({
      method: "one",
      params: ["https://example.supabase.co/storage/v1/object/public/equo-images/avatars/user_alice/photo.jpg", "user_alice"],
    });
    expect(client.calls[1].sql).toContain("update public.users");
    expect(client.calls[2]).toMatchObject({
      method: "exec",
      params: ["https://example.supabase.co/storage/v1/object/public/equo-images/avatars/user_alice/photo.jpg", "user_alice"],
    });
    expect(client.calls[2].sql).toContain("update public.profiles");
  });
});
