import type {
  AcceptInviteRequest,
  CreateGroupRequest,
  CreateInviteRequest,
  UpdateGroupRequest,
} from "../../contracts/schemas.js";
import type { AuthenticatedContext } from "../auth/session.js";

export type GroupMemberRole = "owner" | "member";

export type GroupRecord = {
  id: string;
  name: string;
  currency: string;
  owner_member_id: string;
  cover_image_url?: string | null;
};

export type ArchivedGroupRecord = {
  id: string;
  name: string;
  currency: string;
  owner_member_id: string;
  archived_at: string;
  cover_image_url?: string | null;
};

export type GroupMemberRecord = {
  id: string;
  group_id: string;
  user_id: string | null;
  display_name: string;
  role: GroupMemberRole;
  status: "active" | "removed";
};

export type InviteRecord = {
  id: string;
  group_id: string;
  token_hash: string;
  token?: string;
  max_uses: number;
  use_count: number;
  expires_at?: string;
};

export type GroupRepository = {
  listGroups(context: AuthenticatedContext): Promise<GroupRecord[]>;
  listArchivedGroups(context: AuthenticatedContext): Promise<ArchivedGroupRecord[]>;
  listMembers(groupId: string): Promise<GroupMemberRecord[]>;
  createGroup(context: AuthenticatedContext, request: CreateGroupRequest): Promise<{
    group: GroupRecord;
    ownerMember: GroupMemberRecord;
  }>;
  updateGroup(groupId: string, request: UpdateGroupRequest): Promise<GroupRecord>;
  archiveGroup(groupId: string): Promise<GroupRecord>;
  unarchiveGroup(groupId: string): Promise<GroupRecord>;
  deleteGroup(groupId: string): Promise<GroupRecord>;
  createVirtualMember(groupId: string, displayName: string): Promise<GroupMemberRecord>;
  findActiveMember(groupId: string, userId: string): Promise<GroupMemberRecord | null>;
  createInvite(context: AuthenticatedContext, groupId: string, request: CreateInviteRequest): Promise<InviteRecord>;
  acceptInvite(context: AuthenticatedContext, token: string, request: AcceptInviteRequest): Promise<{
    group: GroupRecord;
    member: GroupMemberRecord;
    claimed: boolean;
  }>;
  hashInviteToken(token: string): Promise<string>;
  findInviteByTokenHash(token_hash: string): Promise<InviteRecord | null>;
  recordClientRequest(groupId: string, client_request_id: string, resourceId: string): Promise<void>;
};
