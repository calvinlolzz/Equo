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
  INVITE_EXPIRED,
  type ArchivedGroupRecord,
  type GroupDetailRecord,
  type GroupMemberRecord,
  type GroupRecord,
  type GroupRepository,
  type InviteRecord,
} from "./groupRepository.js";

export type SupabaseQueryClient = {
  one<T>(sql: string, params: unknown[]): Promise<T>;
  maybeOne<T>(sql: string, params: unknown[]): Promise<T | null>;
  exec(sql: string, params: unknown[]): Promise<void>;
};

/**
 * get_group_detail's p_expense_limit (v3): the expenses array is capped to
 * this many newest entries (expense_date desc, created_at desc). The
 * client's records panel pages past this window via listExpensesPage/GET
 * /groups/:groupId/expenses once expense_count exceeds what's loaded.
 */
export const EXPENSE_WINDOW_LIMIT = 100;

export async function upsertUserByGoogleIdentity(
  client: SupabaseQueryClient,
  identity: GoogleIdentity,
) {
  // deleted_at rides along so callers (authRoutes, requireAuthenticatedUser)
  // can refuse admin-disabled accounts - the upsert itself must NOT clear it,
  // or a disabled user could re-enable themselves by logging in.
  const user = await client.one<AuthenticatedContext["user"] & { deleted_at?: string | null }>(
    `
      insert into public.users (id, google_sub, email, display_name, avatar_url, updated_at)
      values ($1, $2, $3, $4, $5, now())
      on conflict (google_sub) do update set
        email = excluded.email,
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        updated_at = now()
      returning id, google_sub, email, display_name, avatar_url, deleted_at
    `,
    [
      identity.auth_user_id,
      identity.google_sub,
      identity.email,
      identity.display_name,
      identity.avatar_url ?? null,
    ],
  );

  await client.exec(
    `
      insert into public.profiles (id, display_name, avatar_url, default_currency, updated_at)
      values ($1, $2, $3, 'TWD', now())
      on conflict (id) do update set
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        updated_at = now()
    `,
    [user.id, identity.display_name, identity.avatar_url ?? null],
  );

  return user;
}

/**
 * Self-scoped avatar update (PATCH /api/v1/me/avatar): sets users.avatar_url
 * to a freshly-uploaded storage URL for the given userId. Also mirrors the
 * value into profiles.avatar_url so the two tables (users - the auth
 * identity row read by every session/group-detail query, and profiles - the
 * legacy per-user settings row) never drift, matching how
 * upsertUserByGoogleIdentity keeps both in sync on login.
 *
 * Returns the PREVIOUS avatar_url alongside the new one so the caller can
 * clean up an orphaned storage object (see updateMyAvatarRoute) - read
 * fresh right before the write rather than trusting the caller's session
 * context, since upsertUserByGoogleIdentity overwrites users.avatar_url with
 * the Google identity's picture on every login, so a stale in-memory value
 * from earlier in the request could be wrong by the time this runs.
 */
export async function updateUserAvatar(
  client: SupabaseQueryClient,
  userId: string,
  avatarUrl: string,
): Promise<{ avatar_url: string; previousAvatarUrl: string | null }> {
  const current = await client.one<{ avatar_url: string | null }>(
    `
      select id, avatar_url
      from public.users
      where id = $1
    `,
    [userId],
  );

  const user = await client.one<{ avatar_url: string }>(
    `
      update public.users
      set avatar_url = $1, updated_at = now()
      where id = $2
      returning avatar_url
    `,
    [avatarUrl, userId],
  );

  await client.exec(
    `
      update public.profiles
      set avatar_url = $1, updated_at = now()
      where id = $2
    `,
    [avatarUrl, userId],
  );

  return { avatar_url: user.avatar_url, previousAvatarUrl: current.avatar_url ?? null };
}

/**
 * Unambiguous base32 alphabet (no I/O/0/1) - invite tokens get read aloud and
 * retyped, so the characters that get confused for each other are excluded.
 * 32 symbols means one random byte masked to 5 bits maps to exactly one
 * symbol with no modulo bias (256 = 8 x 32).
 */
const INVITE_TOKEN_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const INVITE_TOKEN_LENGTH = 12;

/**
 * The invite token is a bearer credential: whoever holds it can join the
 * group. It must come from a CSPRNG (Math.random is predictable from a few
 * observed outputs) and it must never be stored as-is - only the SHA-256
 * digest goes to invites.token_hash, so a leaked database row, backup, or
 * admin query yields no usable token.
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

/**
 * Cheap auth-state probe for a user id we already trust (an Equo session
 * token carries an already-resolved users.id - see sessionToken.ts). Exists
 * so an authenticated request can confirm the account is still enabled
 * without paying for upsertUserByGoogleIdentity's full write round-trip:
 * without this check an admin-disabled user keeps working until their
 * session token expires (up to 7 days), which makes the admin console's
 * "disable user" control effectively inert against an active session.
 */
export async function findUserAuthState(
  client: SupabaseQueryClient,
  userId: string,
): Promise<{ id: string; deleted_at: string | null } | null> {
  return client.maybeOne<{ id: string; deleted_at: string | null }>(
    `
      select id, deleted_at
      from public.users
      where id = $1
      limit 1
    `,
    [userId],
  );
}

export function createSupabaseGroupRepository(client: SupabaseQueryClient): GroupRepository {
  return {
    async listGroups(context: AuthenticatedContext) {
      return client.one<GroupRecord[]>(
        `
          select g.id, g.name, g.currency, g.owner_member_id, g.cover_image_url
          from public.groups g
          join public.group_members gm on gm.group_id = g.id
          where gm.user_id = $1
            and gm.status = 'active'
            and g.archived_at is null
            and g.deleted_at is null
          order by g.updated_at desc, g.created_at desc
          limit 50
        `,
        [context.user.id],
      );
    },

    async listArchivedGroups(context: AuthenticatedContext) {
      return client.one<ArchivedGroupRecord[]>(
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
        [context.user.id],
      );
    },

    async listMembers(groupId: string) {
      return client.one<GroupMemberRecord[]>(
        `
          select id, group_id, user_id, display_name, role, status
          from public.group_members
          where group_id = $1 and status = 'active'
          order by role desc, created_at asc
        `,
        [groupId],
      );
    },

    async getGroupDetail(context: AuthenticatedContext, groupId: string) {
      const result = await client.maybeOne<GroupDetailRecord | null>(
        `select public.get_group_detail($1, $2, $3) as detail`,
        [groupId, context.user.id, EXPENSE_WINDOW_LIMIT],
      );

      if (!result || !Array.isArray(result.members)) return result ?? null;

      // The RPC's members subquery has no status filter (unlike listMembers),
      // so filter to active members here to keep this method's contract
      // identical to the multi-query path it replaces.
      return {
        ...result,
        members: result.members.filter((member) => member.status === "active"),
      };
    },

    async createGroup(context: AuthenticatedContext, request: CreateGroupRequest) {
      const group = await client.one<GroupRecord>(
        `
          insert into public.groups (name, currency, owner_id, cover_image_url)
          values ($1, $2, $3, $4)
          returning id, name, currency, owner_member_id, cover_image_url
        `,
        [request.name, request.currency, context.user.id, request.cover_image_url ?? null],
      );
      const ownerMember = await client.one<GroupMemberRecord>(
        `
          insert into public.group_members (group_id, user_id, display_name, role, status, claimed_at)
          values ($1, $2, $3, 'owner', 'active', now())
          returning id, group_id, user_id, display_name, role, status
        `,
        [group.id, context.user.id, context.user.display_name],
      );
      const updatedGroup = await client.one<GroupRecord>(
        `
          update public.groups
          set owner_member_id = $1, updated_at = now()
          where id = $2
          returning id, name, currency, owner_member_id, cover_image_url
        `,
        [ownerMember.id, group.id],
      );

      return { group: updatedGroup, ownerMember };
    },

    async updateGroup(groupId: string, request: UpdateGroupRequest) {
      // Read the current cover_image_url before overwriting it - the UPDATE
      // below only returns the NEW row, and coalesce() means a request that
      // omits cover_image_url leaves the column untouched, so this is the
      // only way the caller can know what the old value was (needed to
      // clean it up from storage - see handleUpdateGroup).
      const current = await client.one<{ cover_image_url: string | null }>(
        `
          select id, name, currency, owner_member_id, cover_image_url
          from public.groups
          where id = $1 and deleted_at is null
        `,
        [groupId],
      );

      const group = await client.one<GroupRecord>(
        `
          update public.groups
          set name = $1, cover_image_url = coalesce($2, cover_image_url), updated_at = now()
          where id = $3 and deleted_at is null
          returning id, name, currency, owner_member_id, cover_image_url
        `,
        [request.name, request.cover_image_url ?? null, groupId],
      );

      return { group, previousCoverImageUrl: current.cover_image_url ?? null };
    },

    async archiveGroup(groupId: string) {
      return client.one<GroupRecord>(
        `
          update public.groups
          set archived_at = now(), updated_at = now()
          where id = $1 and deleted_at is null
          returning id, name, currency, owner_member_id, cover_image_url
        `,
        [groupId],
      );
    },

    async unarchiveGroup(groupId: string) {
      return client.one<GroupRecord>(
        `
          update public.groups
          set archived_at = null, updated_at = now()
          where id = $1 and deleted_at is null
          returning id, name, currency, owner_member_id, cover_image_url
        `,
        [groupId],
      );
    },

    async deleteGroup(groupId: string) {
      return client.one<GroupRecord>(
        `
          update public.groups
          set deleted_at = now(), updated_at = now()
          where id = $1 and deleted_at is null
          returning id, name, currency, owner_member_id, cover_image_url
        `,
        [groupId],
      );
    },

    async createVirtualMember(groupId: string, displayName: string) {
      return client.one<GroupMemberRecord>(
        `
          insert into public.group_members (group_id, user_id, display_name, role, status)
          values ($1, null, $2, 'member', 'active')
          returning id, group_id, user_id, display_name, role, status
        `,
        [groupId, displayName],
      );
    },

    async renameVirtualMember(groupId: string, memberId: string, displayName: string) {
      return client.one<GroupMemberRecord>(
        `
          update public.group_members
          set display_name = $1, updated_at = now()
          where id = $2 and group_id = $3 and user_id is null and status = 'active'
          returning id, group_id, user_id, display_name, role, status
        `,
        [displayName, memberId, groupId],
      );
    },

    async removeVirtualMember(groupId: string, memberId: string) {
      return client.one<GroupMemberRecord>(
        `
          update public.group_members
          set status = 'removed', updated_at = now()
          where id = $1 and group_id = $2 and user_id is null and status = 'active'
          returning id, group_id, user_id, display_name, role, status
        `,
        [memberId, groupId],
      );
    },

    async findActiveMember(groupId: string, userId: string) {
      return client.maybeOne<GroupMemberRecord>(
        `
          select id, group_id, user_id, display_name, role, status
          from public.group_members
          where group_id = $1 and user_id = $2 and status = 'active'
          limit 1
        `,
        [groupId, userId],
      );
    },

    async findMemberById(groupId: string, memberId: string) {
      return client.maybeOne<GroupMemberRecord>(
        `
          select id, group_id, user_id, display_name, role, status
          from public.group_members
          where group_id = $1 and id = $2
          limit 1
        `,
        [groupId, memberId],
      );
    },

    async getMemberBalanceMinor(groupId: string, memberId: string) {
      const row = await client.maybeOne<{ balance_minor: number } | null>(
        `
          select balance_minor
          from public.group_member_balances
          where group_id = $1 and member_id = $2
          limit 1
        `,
        [groupId, memberId],
      );

      return row?.balance_minor ?? 0;
    },

    async createInvite(context: AuthenticatedContext, groupId: string, request: CreateInviteRequest) {
      const token = generateInviteToken();
      const token_hash = createTokenHash(token);
      const member = await this.findActiveMember(groupId, context.user.id);

      if (!member) {
        throw new Error("active member required to create invite");
      }

      const invite = await client.one<InviteRecord>(
        `
          insert into public.invites (
            group_id,
            token_hash,
            max_uses,
            expires_at,
            created_by_member_id
          )
          values ($1, $2, $3, $4, $5)
          returning id, group_id, token_hash, max_uses, use_count, expires_at
        `,
        [groupId, token_hash, request.max_uses, request.expires_at ?? null, member.id],
      );

      return { ...invite, token };
    },

    /**
     * Validating the invite, joining the caller, and burning a use are one
     * locked transaction in the accept_invite RPC. Splitting them (a lookup
     * here, then an update) is what let two people redeem the last seat at
     * once - use_count was read, incremented in JS, and written back as an
     * absolute value - and what let an existing member re-run the join and get
     * a *second* member row, since nothing in the schema forbids one.
     */
    async acceptInvite(context: AuthenticatedContext, token: string, request: AcceptInviteRequest) {
      const result = await client.maybeOne<{
        group: GroupRecord;
        member: GroupMemberRecord;
        claimed: boolean;
      }>(`select public.accept_invite($1, $2, $3, $4, $5) as result`, [
        createTokenHash(token),
        context.user.id,
        request.display_name,
        request.claim_member_id ?? null,
        request.client_request_id,
      ]).catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        throw message.includes(INVITE_EXPIRED) ? new Error(INVITE_EXPIRED) : error;
      });

      if (!result) {
        throw new Error(INVITE_EXPIRED);
      }

      return result;
    },

    async recordClientRequest(groupId: string, client_request_id: string, resourceId: string) {
      await client.exec(
        `
          insert into public.client_requests (group_id, client_request_id, resource_id)
          values ($1, $2, $3)
          on conflict (group_id, client_request_id) do nothing
        `,
        [groupId, client_request_id, resourceId],
      );
    },
  };
}
