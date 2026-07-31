import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import { createFakePostgrest, type FakePostgrest } from "../db/fakePostgrest.js";
import {
  createSupabaseGroupRepository,
  findUserAuthState,
  updateUserAvatar,
  upsertUserByGoogleIdentity,
} from "./supabaseGroupRepository.js";

const context = {
  user: {
    id: "user_alice",
    google_sub: "google-alice",
    email: "alice@example.com",
    display_name: "Alice",
  },
};

const groupRow = {
  id: "group_1",
  name: "Tokyo Trip",
  currency: "TWD",
  owner_member_id: "member_owner",
  cover_image_url: null,
};

const memberRow = {
  id: "member_owner",
  group_id: "group_1",
  user_id: "user_alice",
  display_name: "Alice",
  role: "owner",
  status: "active",
};

/**
 * These assertions are on the literal PostgREST request the repository sends.
 * They used to be on a SQL string that production never executed - a translator
 * substring-matched it into a REST call, and the two were free to disagree. They
 * did: `updated_at = now()` was in every UPDATE's SQL and in none of the calls,
 * and `order by updated_at desc` never made it into the groups list at all.
 */
function makeClient(handlers: Parameters<typeof createFakePostgrest>[0] = {}): FakePostgrest {
  return createFakePostgrest({
    select: (table) => {
      if (table === "group_members") return [memberRow];
      if (table === "groups") return [groupRow];
      if (table === "users") return [{ id: "user_alice", avatar_url: null, deleted_at: null }];
      if (table === "group_member_balances") return [{ balance_minor: 0 }];
      return [];
    },
    insert: (table) => {
      if (table === "groups") return [groupRow];
      if (table === "group_members") return [memberRow];
      if (table === "users") return [{ ...context.user, avatar_url: null, deleted_at: null }];
      if (table === "invites") {
        return [
          { id: "invite_1", group_id: "group_1", token_hash: "hash", max_uses: 5, use_count: 0 },
        ];
      }
      return [];
    },
    update: (table) => {
      if (table === "groups") return [groupRow];
      if (table === "group_members") return [memberRow];
      if (table === "users") return [{ avatar_url: "https://cdn/new.jpg" }];
      return [];
    },
    rpc: () => [],
    ...handlers,
  });
}

describe("upsertUserByGoogleIdentity", () => {
  test("upserts the user and mirrors the legacy profiles row", async () => {
    const client = makeClient();

    await upsertUserByGoogleIdentity(client, {
      auth_user_id: "user_alice",
      google_sub: "google-alice",
      email: "alice@example.com",
      display_name: "Alice",
    });

    expect(client.calls[0]).toMatchObject({
      op: "insert",
      table: "users",
      options: { prefer: "resolution=merge-duplicates" },
    });
    // deleted_at rides along on the returning list: an admin-disabled account
    // must be refusable at login, and the upsert must never clear the flag.
    expect((client.calls[0] as { options?: { query?: string } }).options?.query).toContain("deleted_at");
    expect(client.calls[1]).toMatchObject({ op: "insert", table: "profiles" });
  });
});

describe("findUserAuthState", () => {
  test("reads the account's disabled flag by primary key", async () => {
    const client = makeClient();

    await expect(findUserAuthState(client, "user_alice")).resolves.toEqual({
      id: "user_alice",
      avatar_url: null,
      deleted_at: null,
    });
    expect(client.calls[0]).toMatchObject({
      op: "select",
      table: "users",
      query: "select=id,deleted_at&id=eq.user_alice&limit=1",
    });
  });

  test("returns null when the user row is gone", async () => {
    const client = makeClient({ select: () => [] });

    await expect(findUserAuthState(client, "user_ghost")).resolves.toBeNull();
  });
});

describe("updateUserAvatar", () => {
  test("returns the previous url so the caller can clean up the orphaned object", async () => {
    const client = createFakePostgrest({
      select: () => [{ id: "user_alice", avatar_url: "https://cdn/old.jpg" }],
      update: (table) => (table === "users" ? [{ avatar_url: "https://cdn/new.jpg" }] : []),
    });

    await expect(updateUserAvatar(client, "user_alice", "https://cdn/new.jpg")).resolves.toEqual({
      avatar_url: "https://cdn/new.jpg",
      previousAvatarUrl: "https://cdn/old.jpg",
    });

    // users AND profiles: the two carry the same avatar and must not drift.
    expect(client.calls.filter((call) => call.op === "update").map((call) => call.table)).toEqual([
      "users",
      "profiles",
    ]);
  });
});

describe("createSupabaseGroupRepository", () => {
  test("lists the caller's groups newest-activity-first, excluding archived and deleted", async () => {
    const client = makeClient();

    await createSupabaseGroupRepository(client).listGroups(context);

    // PostgREST can't express the join (groups relates to group_members through
    // more than one key), so it's a membership read then a groups read.
    expect(client.calls[0]).toMatchObject({ op: "select", table: "group_members" });
    const groupsRead = client.calls[1] as { query: string };
    expect(groupsRead.query).toContain("id=in.(group_1)");
    expect(groupsRead.query).toContain("archived_at=is.null");
    expect(groupsRead.query).toContain("deleted_at=is.null");
    // Without this the list comes back in PostgREST's unspecified order and
    // silently stops being sorted by recent activity.
    expect(groupsRead.query).toContain("order=updated_at.desc,created_at.desc");
  });

  test("decorates each listed group with its unread count, defaulting to zero", async () => {
    const client = makeClient({ rpc: () => [{ group_id: "group_1", unread_count: 3 }] });

    await expect(createSupabaseGroupRepository(client).listGroups(context)).resolves.toEqual([
      { ...groupRow, unread_count: 3 },
    ]);
    expect(client.rpcCall("group_unread_counts")?.args).toEqual({ p_user: "user_alice" });
  });

  test("a group the unread RPC says nothing about is read, not undefined", async () => {
    const client = makeClient({ rpc: () => [] });

    await expect(createSupabaseGroupRepository(client).listGroups(context)).resolves.toEqual([
      { ...groupRow, unread_count: 0 },
    ]);
  });

  test("marking a group read is scoped to the caller's own membership", async () => {
    const client = makeClient({ rpc: () => ({ group_id: "group_1", last_read_at: "2026-07-30T00:00:00.000Z" }) });

    await createSupabaseGroupRepository(client).markGroupRead(context, "group_1");

    expect(client.rpcCall("mark_group_read")?.args).toEqual({
      p_user: "user_alice",
      p_group_id: "group_1",
    });
  });

  test("marking a group read collapses a non-member result to null", async () => {
    const client = makeClient({ rpc: () => null });

    await expect(createSupabaseGroupRepository(client).markGroupRead(context, "group_x")).resolves.toBeNull();
  });

  test("skips the groups read entirely when the caller has no memberships", async () => {
    const client = makeClient({ select: () => [] });

    await expect(createSupabaseGroupRepository(client).listGroups(context)).resolves.toEqual([]);
    expect(client.calls).toHaveLength(1);
  });

  test("lists archived groups and attaches the caller's own member id to each", async () => {
    const client = createFakePostgrest({
      select: (table) => {
        if (table === "group_members") return [{ id: "member_me", group_id: "group_1" }];
        return [{ ...groupRow, archived_at: "2026-07-01T00:00:00.000Z" }];
      },
    });

    await expect(createSupabaseGroupRepository(client).listArchivedGroups(context)).resolves.toEqual([
      expect.objectContaining({ id: "group_1", caller_member_id: "member_me" }),
    ]);
    expect((client.calls[1] as { query: string }).query).toContain("archived_at=not.is.null");
  });

  test("creates the group, then its owner member, then points the group at that member", async () => {
    const client = makeClient();

    await createSupabaseGroupRepository(client).createGroup(context, {
      client_request_id: "req_group",
      name: "Tokyo Trip",
      currency: "TWD",
    });

    // owner_member_id can only be set once the member row exists, hence the
    // three-step dance.
    expect(client.calls.map((call) => `${call.op}:${"table" in call ? call.table : ""}`)).toEqual([
      "insert:groups",
      "insert:group_members",
      "update:groups",
    ]);
    expect(client.calls[2]).toMatchObject({
      body: { owner_member_id: "member_owner", updated_at: expect.any(String) },
    });
  });

  test("archive, unarchive and delete each stamp updated_at and skip already-deleted groups", async () => {
    const repository = createSupabaseGroupRepository(makeClient());
    const client = makeClient();
    const repo = createSupabaseGroupRepository(client);
    void repository;

    await repo.archiveGroup("group_1");
    await repo.unarchiveGroup("group_1");
    await repo.deleteGroup("group_1");

    const [archive, unarchive, remove] = client.calls as Array<{ query: string; body: Record<string, unknown> }>;

    // No database trigger maintains updated_at, and listGroups orders by it.
    expect(archive.body).toEqual({ archived_at: expect.any(String), updated_at: expect.any(String) });
    expect(unarchive.body).toEqual({ archived_at: null, updated_at: expect.any(String) });
    expect(remove.body).toEqual({ deleted_at: expect.any(String), updated_at: expect.any(String) });
    for (const call of [archive, unarchive, remove]) {
      expect(call.query).toContain("deleted_at=is.null");
    }
  });

  test("renaming a member is restricted to unclaimed, active rows", async () => {
    const client = makeClient();

    await createSupabaseGroupRepository(client).renameVirtualMember("group_1", "member_2", "Bobby");

    const call = client.calls[0] as { query: string; body: Record<string, unknown> };
    // A real user owns their name through their profile - only a virtual member
    // (user_id null) can be renamed here.
    expect(call.query).toContain("user_id=is.null");
    expect(call.query).toContain("status=eq.active");
    expect(call.body).toEqual({ display_name: "Bobby", updated_at: expect.any(String) });
  });

  test("removing a member flips status, and never writes the claim payload", async () => {
    const client = makeClient();

    await createSupabaseGroupRepository(client).removeVirtualMember("group_1", "member_2");

    const call = client.calls[0] as { query: string; body: Record<string, unknown> };
    expect(call.query).toContain("user_id=is.null");
    expect(call.body).toEqual({ status: "removed", updated_at: expect.any(String) });
    expect(call.body).not.toHaveProperty("user_id");
    expect(call.body).not.toHaveProperty("claimed_at");
  });

  test("getMemberBalanceMinor treats a missing balance row as zero", async () => {
    const client = makeClient({ select: () => [] });

    await expect(
      createSupabaseGroupRepository(client).getMemberBalanceMinor("group_1", "member_2"),
    ).resolves.toBe(0);
  });

  test("getGroupDetail drops removed members from the RPC's unfiltered member list", async () => {
    const client = createFakePostgrest({
      rpc: () => ({
        group: groupRow,
        members: [
          { id: "member_owner", status: "active" },
          { id: "member_gone", status: "removed" },
        ],
        expenses: [],
        balances: [],
      }),
    });

    const detail = await createSupabaseGroupRepository(client).getGroupDetail(context, "group_1");

    expect(detail?.members).toEqual([{ id: "member_owner", status: "active" }]);
    expect(client.rpcCall("get_group_detail")?.args).toEqual({
      p_group_id: "group_1",
      p_user_id: "user_alice",
      p_expense_limit: 100,
    });
  });

  test("stores a SHA-256 digest of the invite token, never the token", async () => {
    const client = makeClient();

    const invite = await createSupabaseGroupRepository(client).createInvite(context, "group_1", {
      client_request_id: "req_invite",
      max_uses: 5,
    });

    // The token is a bearer credential. What lands in the database must be a
    // real digest - not the token, and not a reversible "sha256:<token>" tag,
    // which is what this used to store.
    expect(invite.token).toMatch(/^EQO[2-9A-HJ-NP-Z]{12}$/);

    const insert = client.calls.find(
      (call): call is Extract<typeof call, { op: "insert" }> =>
        call.op === "insert" && call.table === "invites",
    );
    const written = (insert?.body as { token_hash: string }).token_hash;
    expect(written).toMatch(/^[0-9a-f]{64}$/);
    expect(written).not.toContain(String(invite.token));
    expect(written).toBe(createHash("sha256").update(String(invite.token), "utf8").digest("hex"));
  });

  test("issues a different token every time", async () => {
    const repo = createSupabaseGroupRepository(makeClient());
    const request = { client_request_id: "req_invite", max_uses: 5 };

    const first = await repo.createInvite(context, "group_1", request);
    const second = await repo.createInvite(context, "group_1", request);

    expect(first.token).not.toBe(second.token);
  });

  test("acceptInvite hands the whole redemption to the locked accept_invite transaction", async () => {
    const client = createFakePostgrest({
      rpc: () => ({ group: groupRow, member: memberRow, claimed: true }),
    });

    await expect(
      createSupabaseGroupRepository(client).acceptInvite(context, "EQOABCDEFGHJK", {
        client_request_id: "req_accept",
        display_name: "Alice",
        claim_member_id: "member_virtual",
      }),
    ).resolves.toMatchObject({ claimed: true });

    const call = client.rpcCall("accept_invite");
    expect(call?.args).toMatchObject({
      p_token_hash: createHash("sha256").update("EQOABCDEFGHJK", "utf8").digest("hex"),
      p_user_id: "user_alice",
      p_claim_member_id: "member_virtual",
    });
    // The token itself must never leave the process.
    expect(JSON.stringify(call?.args)).not.toContain("EQOABCDEFGHJK");
  });

  test("acceptInvite reports a revoked/exhausted/expired invite as INVITE_EXPIRED", async () => {
    const client = createFakePostgrest({
      rpc: () => {
        throw new Error("INVITE_EXPIRED");
      },
    });

    await expect(
      createSupabaseGroupRepository(client).acceptInvite(context, "EQOABCDEFGHJK", {
        client_request_id: "req_accept",
        display_name: "Alice",
      }),
    ).rejects.toThrow("INVITE_EXPIRED");
  });

  test("records client_request_id for idempotency, ignoring a duplicate", async () => {
    const client = makeClient();

    await createSupabaseGroupRepository(client).recordClientRequest("group_1", "req_1", "resource_1");

    expect(client.calls[0]).toMatchObject({
      op: "insert",
      table: "client_requests",
      body: { group_id: "group_1", client_request_id: "req_1", resource_id: "resource_1" },
      options: { prefer: "resolution=ignore-duplicates" },
    });
  });
});
