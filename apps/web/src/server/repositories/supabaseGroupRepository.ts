import { createHash, randomBytes } from "node:crypto";
import type {
  AcceptInviteRequest,
  CreateGroupRequest,
  CreateInviteRequest,
  UpdateGroupRequest,
} from "../../contracts/schemas.js";
import type { GoogleIdentity } from "../auth/google.js";
import type { AuthenticatedContext } from "../auth/session.js";
import {
  columns,
  eq,
  inList,
  isNotNull,
  isNull,
  limit,
  onConflict,
  optionalRow,
  order,
  query,
  requireRow,
  type PostgrestClient,
} from "../db/postgrestClient.js";
import {
  INVITE_EXPIRED,
  type ArchivedGroupRecord,
  type GroupDetailRecord,
  type GroupMemberRecord,
  type GroupRecord,
  type GroupRepository,
  type InviteRecord,
} from "./groupRepository.js";

/** The column list every GroupRecord-shaped read/write returns. */
const GROUP_COLUMNS = "id,name,currency,owner_member_id,cover_image_url";
/** The column list every GroupMemberRecord-shaped read/write returns. */
const MEMBER_COLUMNS = "id,group_id,user_id,display_name,role,status";

/**
 * A user's group list is capped here. The cap is on memberships, and it exists
 * because PostgREST cannot express the join - the list is a membership read
 * followed by a groups read keyed on the resulting ids.
 */
const GROUP_LIST_LIMIT = 50;

/**
 * get_group_detail's p_expense_limit: the expenses array is capped to this many
 * newest entries (expense_date desc, created_at desc). The client's records
 * panel pages past this window via listExpensesPage / GET
 * /groups/:groupId/expenses once expense_count exceeds what's loaded.
 */
export const EXPENSE_WINDOW_LIMIT = 100;

function nowIso(): string {
  return new Date().toISOString();
}

export async function upsertUserByGoogleIdentity(client: PostgrestClient, identity: GoogleIdentity) {
  // deleted_at rides along so callers (authRoutes, requireAuthenticatedUser)
  // can refuse admin-disabled accounts. The upsert must NOT clear it, or a
  // disabled user could re-enable themselves just by logging in again.
  const rows = await client.insert<AuthenticatedContext["user"] & { deleted_at?: string | null }>(
    "users",
    {
      id: identity.auth_user_id,
      google_sub: identity.google_sub,
      email: identity.email,
      display_name: identity.display_name,
      avatar_url: identity.avatar_url ?? null,
      updated_at: nowIso(),
    },
    {
      query: query(onConflict("google_sub"), columns("id,google_sub,email,display_name,avatar_url,deleted_at")),
      prefer: "resolution=merge-duplicates",
    },
  );
  const user = requireRow(rows, "user");

  // profiles is the legacy per-user settings row; keep it in step with users so
  // the two never drift (updateUserAvatar does the same on the other side).
  await client.insert(
    "profiles",
    {
      id: user.id,
      display_name: identity.display_name,
      avatar_url: identity.avatar_url ?? null,
      default_currency: "TWD",
      updated_at: nowIso(),
    },
    { query: onConflict("id"), prefer: "resolution=merge-duplicates" },
  );

  return user;
}

/**
 * Cheap auth-state probe for a user id we already trust (an Equo session token
 * carries an already-resolved users.id - see sessionToken.ts). Exists so an
 * authenticated request can confirm the account is still enabled without paying
 * for upsertUserByGoogleIdentity's full write round-trip: without this check an
 * admin-disabled user keeps working until their session token expires (up to 7
 * days), which makes the admin console's "disable user" control inert against
 * exactly the sessions it most needs to stop.
 */
export async function findUserAuthState(
  client: PostgrestClient,
  userId: string,
): Promise<{ id: string; deleted_at: string | null } | null> {
  const rows = await client.select<{ id: string; deleted_at: string | null }>(
    "users",
    query(columns("id,deleted_at"), eq("id", userId), limit(1)),
  );

  return optionalRow(rows);
}

/**
 * Self-scoped avatar update (PATCH /api/v1/me/avatar). Mirrors the value into
 * profiles.avatar_url so the two tables never drift.
 *
 * Returns the PREVIOUS avatar_url alongside the new one so the caller can clean
 * up the orphaned storage object (see updateMyAvatarRoute). It is read fresh
 * right before the write rather than taken from the caller's session context,
 * because upsertUserByGoogleIdentity overwrites users.avatar_url with the Google
 * picture on every login - an in-memory value from earlier in the request can
 * already be stale by the time this runs.
 */
export async function updateUserAvatar(
  client: PostgrestClient,
  userId: string,
  avatarUrl: string,
): Promise<{ avatar_url: string; previousAvatarUrl: string | null }> {
  const currentRows = await client.select<{ avatar_url: string | null }>(
    "users",
    query(columns("id,avatar_url"), eq("id", userId), limit(1)),
  );
  const current = requireRow(currentRows, "user");

  const updatedRows = await client.update<{ avatar_url: string }>(
    "users",
    query(eq("id", userId), columns("avatar_url")),
    { avatar_url: avatarUrl, updated_at: nowIso() },
  );
  const user = requireRow(updatedRows, "user");

  await client.update("profiles", eq("id", userId), {
    avatar_url: avatarUrl,
    updated_at: nowIso(),
  });

  return { avatar_url: user.avatar_url, previousAvatarUrl: current.avatar_url ?? null };
}

/**
 * Unambiguous base32 alphabet (no I/O/0/1) - invite tokens get read aloud and
 * retyped, so the characters that get confused for each other are excluded.
 * 32 symbols means one random byte masked to 5 bits maps to exactly one symbol
 * with no modulo bias (256 = 8 x 32).
 */
const INVITE_TOKEN_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const INVITE_TOKEN_LENGTH = 12;

/**
 * The invite token is a bearer credential: whoever holds it can join the group.
 * It must come from a CSPRNG (Math.random is predictable from a few observed
 * outputs) and it must never be stored as-is - only the SHA-256 digest goes to
 * invites.token_hash, so a leaked row, backup, or admin query yields no usable
 * token.
 */
function generateInviteToken(): string {
  const bytes = randomBytes(INVITE_TOKEN_LENGTH);
  let token = "";

  for (const byte of bytes) {
    token += INVITE_TOKEN_ALPHABET[byte & 31];
  }

  return `EQO${token}`;
}

function createTokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

export function createSupabaseGroupRepository(client: PostgrestClient): GroupRepository {
  /**
   * The groups a user belongs to. PostgREST can't express the join without an
   * embedded resource (which is ambiguous here - groups relates to
   * group_members through more than one key), so it is two reads: the caller's
   * memberships, then the groups those point at.
   */
  async function listMemberships(userId: string): Promise<Array<{ id: string; group_id: string }>> {
    return client.select<{ id: string; group_id: string }>(
      "group_members",
      query(
        columns("id,group_id"),
        eq("user_id", userId),
        eq("status", "active"),
        limit(GROUP_LIST_LIMIT),
      ),
    );
  }

  return {
    async listGroups(context: AuthenticatedContext) {
      const memberships = await listMemberships(context.user.id);
      const groupIds = [...new Set(memberships.map((row) => row.group_id))];

      if (groupIds.length === 0) {
        return [];
      }

      return client.select<GroupRecord>(
        "groups",
        query(
          columns(GROUP_COLUMNS),
          inList("id", groupIds),
          isNull("archived_at"),
          isNull("deleted_at"),
          order("updated_at.desc,created_at.desc"),
          limit(GROUP_LIST_LIMIT),
        ),
      );
    },

    async listArchivedGroups(context: AuthenticatedContext) {
      const memberships = await listMemberships(context.user.id);
      const callerMemberIdByGroupId = new Map(memberships.map((row) => [row.group_id, row.id]));
      const groupIds = [...new Set(memberships.map((row) => row.group_id))];

      if (groupIds.length === 0) {
        return [];
      }

      const groups = await client.select<Omit<ArchivedGroupRecord, "caller_member_id">>(
        "groups",
        query(
          columns("id,name,currency,owner_member_id,archived_at,cover_image_url"),
          inList("id", groupIds),
          isNotNull("archived_at"),
          isNull("deleted_at"),
          order("updated_at.desc,created_at.desc"),
          limit(GROUP_LIST_LIMIT),
        ),
      );

      return groups.map((group) => ({
        ...group,
        caller_member_id: callerMemberIdByGroupId.get(group.id) ?? null,
      })) as ArchivedGroupRecord[];
    },

    async listMembers(groupId: string) {
      return client.select<GroupMemberRecord>(
        "group_members",
        query(
          columns(MEMBER_COLUMNS),
          eq("group_id", groupId),
          eq("status", "active"),
          order("role.desc,created_at.asc"),
        ),
      );
    },

    async getGroupDetail(context: AuthenticatedContext, groupId: string) {
      const result = await client.rpc<GroupDetailRecord | null>("get_group_detail", {
        p_group_id: groupId,
        p_user_id: context.user.id,
        p_expense_limit: EXPENSE_WINDOW_LIMIT,
      });

      if (!result || !Array.isArray(result.members)) return result ?? null;

      // The RPC's members subquery has no status filter (unlike listMembers), so
      // filter to active members here to keep this method's contract identical
      // to the multi-query path it replaced.
      return {
        ...result,
        members: result.members.filter((member) => member.status === "active"),
      };
    },

    async createGroup(context: AuthenticatedContext, request: CreateGroupRequest) {
      const group = requireRow(
        await client.insert<GroupRecord>(
          "groups",
          {
            name: request.name,
            currency: request.currency,
            owner_id: context.user.id,
            cover_image_url: request.cover_image_url ?? null,
          },
          { query: columns(GROUP_COLUMNS) },
        ),
        "group",
      );

      const ownerMember = requireRow(
        await client.insert<GroupMemberRecord>(
          "group_members",
          {
            group_id: group.id,
            user_id: context.user.id,
            display_name: context.user.display_name,
            role: "owner",
            status: "active",
            claimed_at: nowIso(),
          },
          { query: columns(MEMBER_COLUMNS) },
        ),
        "group member",
      );

      // groups.owner_member_id can only be set once the owner's member row
      // exists, so the group is created first and pointed at it here.
      const updatedGroup = requireRow(
        await client.update<GroupRecord>("groups", query(eq("id", group.id), columns(GROUP_COLUMNS)), {
          owner_member_id: ownerMember.id,
          updated_at: nowIso(),
        }),
        "group",
      );

      return { group: updatedGroup, ownerMember };
    },

    async updateGroup(groupId: string, request: UpdateGroupRequest) {
      // Read the current cover before overwriting it: the update returns only
      // the new row, and a request that omits cover_image_url leaves the column
      // untouched, so this is the only way the caller can learn the old value
      // (needed to clean it up from storage - see handleUpdateGroup).
      const current = requireRow(
        await client.select<{ cover_image_url: string | null }>(
          "groups",
          query(columns(GROUP_COLUMNS), eq("id", groupId), isNull("deleted_at"), limit(1)),
        ),
        "group",
      );

      const group = requireRow(
        await client.update<GroupRecord>(
          "groups",
          query(eq("id", groupId), isNull("deleted_at"), columns(GROUP_COLUMNS)),
          request.cover_image_url == null
            ? { name: request.name, updated_at: nowIso() }
            : { name: request.name, cover_image_url: request.cover_image_url, updated_at: nowIso() },
        ),
        "group",
      );

      return { group, previousCoverImageUrl: current.cover_image_url ?? null };
    },

    async archiveGroup(groupId: string) {
      return requireRow(
        await client.update<GroupRecord>(
          "groups",
          query(eq("id", groupId), isNull("deleted_at"), columns(GROUP_COLUMNS)),
          { archived_at: nowIso(), updated_at: nowIso() },
        ),
        "group",
      );
    },

    async unarchiveGroup(groupId: string) {
      return requireRow(
        await client.update<GroupRecord>(
          "groups",
          query(eq("id", groupId), isNull("deleted_at"), columns(GROUP_COLUMNS)),
          { archived_at: null, updated_at: nowIso() },
        ),
        "group",
      );
    },

    async deleteGroup(groupId: string) {
      return requireRow(
        await client.update<GroupRecord>(
          "groups",
          query(eq("id", groupId), isNull("deleted_at"), columns(GROUP_COLUMNS)),
          { deleted_at: nowIso(), updated_at: nowIso() },
        ),
        "group",
      );
    },

    async createVirtualMember(groupId: string, displayName: string) {
      return requireRow(
        await client.insert<GroupMemberRecord>(
          "group_members",
          {
            group_id: groupId,
            user_id: null,
            display_name: displayName,
            role: "member",
            status: "active",
          },
          { query: columns(MEMBER_COLUMNS) },
        ),
        "group member",
      );
    },

    async renameVirtualMember(groupId: string, memberId: string, displayName: string) {
      // user_id is null / status active: only an unclaimed member can be renamed
      // this way - a real user owns their own name through their profile.
      return requireRow(
        await client.update<GroupMemberRecord>(
          "group_members",
          query(
            eq("id", memberId),
            eq("group_id", groupId),
            isNull("user_id"),
            eq("status", "active"),
            columns(MEMBER_COLUMNS),
          ),
          { display_name: displayName, updated_at: nowIso() },
        ),
        "group member",
      );
    },

    async removeVirtualMember(groupId: string, memberId: string) {
      return requireRow(
        await client.update<GroupMemberRecord>(
          "group_members",
          query(
            eq("id", memberId),
            eq("group_id", groupId),
            isNull("user_id"),
            eq("status", "active"),
            columns(MEMBER_COLUMNS),
          ),
          { status: "removed", updated_at: nowIso() },
        ),
        "group member",
      );
    },

    async findActiveMember(groupId: string, userId: string) {
      return optionalRow(
        await client.select<GroupMemberRecord>(
          "group_members",
          query(
            columns(MEMBER_COLUMNS),
            eq("group_id", groupId),
            eq("user_id", userId),
            eq("status", "active"),
            limit(1),
          ),
        ),
      );
    },

    async findMemberById(groupId: string, memberId: string) {
      return optionalRow(
        await client.select<GroupMemberRecord>(
          "group_members",
          query(columns(MEMBER_COLUMNS), eq("group_id", groupId), eq("id", memberId), limit(1)),
        ),
      );
    },

    async getMemberBalanceMinor(groupId: string, memberId: string) {
      const row = optionalRow(
        await client.select<{ balance_minor: number }>(
          "group_member_balances",
          query(columns("balance_minor"), eq("group_id", groupId), eq("member_id", memberId), limit(1)),
        ),
      );

      return row?.balance_minor ?? 0;
    },

    async createInvite(context: AuthenticatedContext, groupId: string, request: CreateInviteRequest) {
      const token = generateInviteToken();
      const member = await this.findActiveMember(groupId, context.user.id);

      if (!member) {
        throw new Error("active member required to create invite");
      }

      const invite = requireRow(
        await client.insert<InviteRecord>(
          "invites",
          {
            group_id: groupId,
            token_hash: createTokenHash(token),
            max_uses: request.max_uses,
            expires_at: request.expires_at ?? null,
            created_by_member_id: member.id,
          },
          { query: columns("id,group_id,token_hash,max_uses,use_count,expires_at") },
        ),
        "invite",
      );

      return { ...invite, token };
    },

    /**
     * Validating the invite, joining the caller, and burning a use are one
     * locked transaction in the accept_invite RPC. Splitting them (look the
     * invite up, then update it) is what let two people redeem the last seat at
     * once - use_count was read, incremented in JS, and written back as an
     * absolute value - and what let an existing member re-run the join and get a
     * SECOND member row, since nothing in the schema forbids one.
     */
    async acceptInvite(context: AuthenticatedContext, token: string, request: AcceptInviteRequest) {
      const result = await client
        .rpc<{ group: GroupRecord; member: GroupMemberRecord; claimed: boolean } | null>("accept_invite", {
          p_token_hash: createTokenHash(token),
          p_user_id: context.user.id,
          p_display_name: request.display_name,
          p_claim_member_id: request.claim_member_id ?? null,
          p_client_request_id: request.client_request_id,
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error);
          throw message.includes(INVITE_EXPIRED) ? new Error(INVITE_EXPIRED) : error;
        });

      if (!result) {
        throw new Error(INVITE_EXPIRED);
      }

      return result;
    },

    async recordClientRequest(groupId: string, client_request_id: string, resourceId: string) {
      await client.insert(
        "client_requests",
        { group_id: groupId, client_request_id, resource_id: resourceId },
        { query: onConflict("group_id,client_request_id"), prefer: "resolution=ignore-duplicates" },
      );
    },
  };
}
