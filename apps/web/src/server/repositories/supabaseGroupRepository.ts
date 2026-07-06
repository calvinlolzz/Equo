import type {
  AcceptInviteRequest,
  CreateGroupRequest,
  CreateInviteRequest,
  UpdateGroupRequest,
} from "../../contracts/schemas.js";
import type { GoogleIdentity } from "../auth/google.js";
import type { AuthenticatedContext } from "../auth/session.js";
import type {
  ArchivedGroupRecord,
  GroupDetailRecord,
  GroupMemberRecord,
  GroupRecord,
  GroupRepository,
  InviteRecord,
} from "./groupRepository.js";

export type SupabaseQueryClient = {
  one<T>(sql: string, params: unknown[]): Promise<T>;
  maybeOne<T>(sql: string, params: unknown[]): Promise<T | null>;
  exec(sql: string, params: unknown[]): Promise<void>;
};

export async function upsertUserByGoogleIdentity(
  client: SupabaseQueryClient,
  identity: GoogleIdentity,
) {
  const user = await client.one<AuthenticatedContext["user"]>(
    `
      insert into public.users (id, google_sub, email, display_name, avatar_url, updated_at)
      values ($1, $2, $3, $4, $5, now())
      on conflict (google_sub) do update set
        email = excluded.email,
        display_name = excluded.display_name,
        avatar_url = excluded.avatar_url,
        updated_at = now()
      returning id, google_sub, email, display_name
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

function createTokenHash(token: string): string {
  return `sha256:${token}`;
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
          select g.id, g.name, g.currency, g.owner_member_id, g.archived_at, g.cover_image_url
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
        `select public.get_group_detail($1, $2) as detail`,
        [groupId, context.user.id],
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
      return client.one<GroupRecord>(
        `
          update public.groups
          set name = $1, cover_image_url = coalesce($2, cover_image_url), updated_at = now()
          where id = $3 and deleted_at is null
          returning id, name, currency, owner_member_id, cover_image_url
        `,
        [request.name, request.cover_image_url ?? null, groupId],
      );
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
      const token = `EQO${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
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

    async acceptInvite(context: AuthenticatedContext, token: string, request: AcceptInviteRequest) {
      const token_hash = createTokenHash(token);
      const invite = await this.findInviteByTokenHash(token_hash);

      if (!invite) {
        throw new Error("invite not found");
      }

      const group = await client.one<GroupRecord>(
        `
          select id, name, currency, owner_member_id, cover_image_url
          from public.groups
          where id = $1 and deleted_at is null
        `,
        [invite.group_id],
      );
      const member = request.claim_member_id
        ? await client.one<GroupMemberRecord>(
            `
              update public.group_members
              set user_id = $1, display_name = $2, claimed_at = now(), updated_at = now()
              where id = $3 and group_id = $4 and user_id is null and status = 'active'
              returning id, group_id, user_id, display_name, role, status
            `,
            [context.user.id, request.display_name, request.claim_member_id, invite.group_id],
          )
        : await client.one<GroupMemberRecord>(
            `
              insert into public.group_members (group_id, user_id, display_name, role, status, claimed_at)
              values ($1, $2, $3, 'member', 'active', now())
              returning id, group_id, user_id, display_name, role, status
            `,
            [invite.group_id, context.user.id, request.display_name],
          );

      await client.exec(
        `
          update public.invites
          set use_count = use_count + 1
          where id = $1
        `,
        [invite.id, invite.use_count + 1],
      );

      return { group, member, claimed: Boolean(request.claim_member_id) };
    },

    async hashInviteToken(token: string) {
      return createTokenHash(token);
    },

    async findInviteByTokenHash(token_hash: string) {
      return client.maybeOne<InviteRecord>(
        `
          select id, group_id, token_hash, max_uses, use_count, expires_at
          from public.invites
          where token_hash = $1
            and revoked_at is null
            and use_count < max_uses
            and (expires_at is null or expires_at > now())
          limit 1
        `,
        [token_hash],
      );
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
