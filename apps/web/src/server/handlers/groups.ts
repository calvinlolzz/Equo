import type { ApiError } from "../../contracts/errors.js";
import type {
  AcceptInviteRequest,
  CreateGroupRequest,
  CreateInviteRequest,
  CreateVirtualMemberRequest,
  RenameGroupMemberRequest,
  UpdateGroupRequest,
} from "../../contracts/schemas.js";
import type { AuthenticatedContext } from "../auth/session.js";
import { INVITE_EXPIRED, type GroupMemberRecord, type GroupRepository } from "../repositories/groupRepository.js";
import { urlToStoragePath, type SupabaseStorageClient } from "../runtime/supabaseStorageClient.js";

type HandlerResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; body: ApiError };

function forbidden(request_id = "req_unknown"): HandlerResult<never> {
  return {
    ok: false,
    status: 403,
    body: {
      error: {
        code: "FORBIDDEN",
        message: "You are not a member of this group.",
        request_id,
      },
    },
  };
}

function memberNotFound(request_id: string): HandlerResult<never> {
  return {
    ok: false,
    status: 404,
    body: {
      error: {
        code: "MEMBER_NOT_FOUND",
        message: "Member not found in this group.",
        request_id,
      },
    },
  };
}

function invalidMember(message: string, request_id: string): HandlerResult<never> {
  return {
    ok: false,
    status: 400,
    body: {
      error: {
        code: "INVALID_MEMBER",
        message,
        request_id,
      },
    },
  };
}

/**
 * Shared target checks for the virtual-member management endpoints
 * (rename/remove): the target must exist, still be active, be virtual
 * (user_id null - real users own their names via their profile), and must
 * not be the owner.
 */
async function requireVirtualMemberTarget(
  repository: GroupRepository,
  groupId: string,
  memberId: string,
  requestId: string,
): Promise<{ ok: true; member: GroupMemberRecord } | { ok: false; error: HandlerResult<never> }> {
  const target = await repository.findMemberById(groupId, memberId);

  if (!target || target.status !== "active") {
    return { ok: false, error: memberNotFound(requestId) };
  }

  if (target.user_id !== null || target.role === "owner") {
    return {
      ok: false,
      error: invalidMember("Only virtual members (without a linked account) can be managed.", requestId),
    };
  }

  return { ok: true, member: target };
}

export async function requireGroupMember(
  repository: GroupRepository,
  context: AuthenticatedContext,
  groupId: string,
): Promise<GroupMemberRecord | null> {
  return repository.findActiveMember(groupId, context.user.id);
}

/**
 * Group management (rename/cover, archive, unarchive, delete) is
 * owner-only by product decision - every other group action (invites,
 * member management, expenses, settlements) stays open to all active
 * members. `findActiveMember`'s role field is the robust check here: it's
 * already scoped to (groupId, this caller), so there's no risk of comparing
 * ids from different id spaces the way group.owner_member_id vs a member id
 * would require an extra query to bridge.
 */
function ownerForbidden(request_id: string): HandlerResult<never> {
  return {
    ok: false,
    status: 403,
    body: {
      error: {
        code: "FORBIDDEN",
        message: "Only the group owner can perform this action.",
        request_id,
      },
    },
  };
}

async function requireGroupOwner(
  repository: GroupRepository,
  context: AuthenticatedContext,
  groupId: string,
  request_id: string,
): Promise<{ ok: true; member: GroupMemberRecord } | { ok: false; error: HandlerResult<never> }> {
  const member = await requireGroupMember(repository, context, groupId);

  if (!member) {
    return { ok: false, error: forbidden(request_id) };
  }

  if (member.role !== "owner") {
    return { ok: false, error: ownerForbidden(request_id) };
  }

  return { ok: true, member };
}

export async function handleCreateGroup(
  repository: GroupRepository,
  context: AuthenticatedContext,
  request: CreateGroupRequest,
) {
  const result = await repository.createGroup(context, request);
  await repository.recordClientRequest(result.group.id, request.client_request_id, result.group.id);

  return {
    ok: true,
    status: 201,
    body: {
      group: result.group,
      owner_member: result.ownerMember,
    },
  } satisfies HandlerResult<unknown>;
}

export async function handleListGroups(repository: GroupRepository, context: AuthenticatedContext) {
  const groups = await repository.listGroups(context);

  return {
    ok: true,
    status: 200,
    body: { groups },
  } satisfies HandlerResult<unknown>;
}

export async function handleListArchivedGroups(repository: GroupRepository, context: AuthenticatedContext) {
  const groups = await repository.listArchivedGroups(context);

  return {
    ok: true,
    status: 200,
    body: { groups },
  } satisfies HandlerResult<unknown>;
}

export async function handleUpdateGroup(
  repository: GroupRepository,
  context: AuthenticatedContext,
  groupId: string,
  request: UpdateGroupRequest,
  storage?: SupabaseStorageClient,
) {
  const owner = await requireGroupOwner(repository, context, groupId, request.client_request_id);

  if (owner.ok === false) {
    return owner.error;
  }

  const { group, previousCoverImageUrl } = await repository.updateGroup(groupId, request);
  await repository.recordClientRequest(groupId, request.client_request_id, group.id);

  // Clean up the previous cover once it's actually been replaced by a
  // different one - fire-and-forget, never blocks the response (see
  // supabaseStorageClient.ts's urlToStoragePath/deleteImage doc). Skipped
  // entirely when the new value is the same as the old one (request omitted
  // cover_image_url, or resubmitted the same URL) so a same-cover edit never
  // deletes the cover it's still using.
  if (storage && request.cover_image_url && previousCoverImageUrl && previousCoverImageUrl !== request.cover_image_url) {
    const path = urlToStoragePath(previousCoverImageUrl);
    if (path) {
      storage.deleteImage(path).catch((error) => {
        console.warn(`Failed to delete orphaned storage object ${path}:`, error);
      });
    }
  }

  return {
    ok: true,
    status: 200,
    body: { group },
  } satisfies HandlerResult<unknown>;
}

export async function handleArchiveGroup(
  repository: GroupRepository,
  context: AuthenticatedContext,
  groupId: string,
  clientRequestId: string,
) {
  const owner = await requireGroupOwner(repository, context, groupId, clientRequestId);

  if (owner.ok === false) {
    return owner.error;
  }

  const group = await repository.archiveGroup(groupId);
  await repository.recordClientRequest(groupId, clientRequestId, group.id);

  return {
    ok: true,
    status: 200,
    body: { group },
  } satisfies HandlerResult<unknown>;
}

export async function handleUnarchiveGroup(
  repository: GroupRepository,
  context: AuthenticatedContext,
  groupId: string,
  clientRequestId: string,
) {
  const owner = await requireGroupOwner(repository, context, groupId, clientRequestId);

  if (owner.ok === false) {
    return owner.error;
  }

  const group = await repository.unarchiveGroup(groupId);
  await repository.recordClientRequest(groupId, clientRequestId, group.id);

  return {
    ok: true,
    status: 200,
    body: { group },
  } satisfies HandlerResult<unknown>;
}

export async function handleDeleteGroup(
  repository: GroupRepository,
  context: AuthenticatedContext,
  groupId: string,
  clientRequestId: string,
) {
  const owner = await requireGroupOwner(repository, context, groupId, clientRequestId);

  if (owner.ok === false) {
    return owner.error;
  }

  const group = await repository.deleteGroup(groupId);
  await repository.recordClientRequest(groupId, clientRequestId, group.id);

  return {
    ok: true,
    status: 200,
    body: { group },
  } satisfies HandlerResult<unknown>;
}

export async function handleGetGroupDetail(
  groupRepository: GroupRepository,
  context: AuthenticatedContext,
  groupId: string,
) {
  const detail = await groupRepository.getGroupDetail(context, groupId);

  // The RPC returns null both when the caller isn't an active member and
  // when the group is deleted/missing - collapse both into the same
  // forbidden response the multi-query path used to return for either case.
  if (!detail) {
    return forbidden("req_group_detail");
  }

  return {
    ok: true,
    status: 200,
    body: detail,
  } satisfies HandlerResult<unknown>;
}

export async function handleCreateVirtualMember(
  repository: GroupRepository,
  context: AuthenticatedContext,
  groupId: string,
  request: CreateVirtualMemberRequest,
) {
  const member = await requireGroupMember(repository, context, groupId);

  if (!member) {
    return forbidden(request.client_request_id);
  }

  const virtualMember = await repository.createVirtualMember(groupId, request.display_name.trim());
  await repository.recordClientRequest(groupId, request.client_request_id, virtualMember.id);

  return {
    ok: true,
    status: 201,
    body: { member: virtualMember },
  } satisfies HandlerResult<unknown>;
}

export async function handleRenameGroupMember(
  repository: GroupRepository,
  context: AuthenticatedContext,
  groupId: string,
  memberId: string,
  request: RenameGroupMemberRequest,
) {
  const member = await requireGroupMember(repository, context, groupId);

  if (!member) {
    return forbidden(request.client_request_id);
  }

  const target = await requireVirtualMemberTarget(repository, groupId, memberId, request.client_request_id);

  if (target.ok === false) {
    return target.error;
  }

  const renamed = await repository.renameVirtualMember(groupId, memberId, request.display_name.trim());
  await repository.recordClientRequest(groupId, request.client_request_id, renamed.id);

  return {
    ok: true,
    status: 200,
    body: { member: renamed },
  } satisfies HandlerResult<unknown>;
}

export async function handleRemoveGroupMember(
  repository: GroupRepository,
  context: AuthenticatedContext,
  groupId: string,
  memberId: string,
  clientRequestId: string,
) {
  const member = await requireGroupMember(repository, context, groupId);

  if (!member) {
    return forbidden(clientRequestId);
  }

  const target = await requireVirtualMemberTarget(repository, groupId, memberId, clientRequestId);

  if (target.ok === false) {
    return target.error;
  }

  const balanceMinor = await repository.getMemberBalanceMinor(groupId, memberId);

  if (balanceMinor !== 0) {
    return {
      ok: false,
      status: 409,
      body: {
        error: {
          code: "MEMBER_HAS_BALANCE",
          message: "Member still has an unsettled balance and cannot be removed.",
          request_id: clientRequestId,
        },
      },
    } satisfies HandlerResult<never>;
  }

  const removed = await repository.removeVirtualMember(groupId, memberId);
  await repository.recordClientRequest(groupId, clientRequestId, removed.id);

  return {
    ok: true,
    status: 200,
    body: { member: removed },
  } satisfies HandlerResult<unknown>;
}

export async function handleCreateInvite(
  repository: GroupRepository,
  context: AuthenticatedContext,
  groupId: string,
  request: CreateInviteRequest,
) {
  const member = await requireGroupMember(repository, context, groupId);

  if (!member) {
    return forbidden(request.client_request_id);
  }

  const invite = await repository.createInvite(context, groupId, request);
  await repository.recordClientRequest(groupId, request.client_request_id, invite.id);

  return {
    ok: true,
    status: 201,
    body: { invite },
  } satisfies HandlerResult<unknown>;
}

/**
 * The invite check used to live here: look the token up, 404 if it's no good,
 * then accept it in a second call. Those two steps raced each other - between
 * the lookup and the accept the invite could be exhausted or revoked - so
 * validation now happens inside acceptInvite's transaction, and an unusable
 * invite comes back as INVITE_EXPIRED.
 *
 * recordClientRequest is gone from this path for the same reason: the RPC
 * writes it in the same transaction as the membership row.
 */
export async function handleAcceptInvite(
  repository: GroupRepository,
  context: AuthenticatedContext,
  token: string,
  request: AcceptInviteRequest,
) {
  try {
    const result = await repository.acceptInvite(context, token, request);

    return {
      ok: true,
      status: 200,
      body: result,
    } satisfies HandlerResult<unknown>;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    if (!message.includes(INVITE_EXPIRED)) {
      throw error;
    }

    return {
      ok: false,
      status: 404,
      body: {
        error: {
          code: "INVITE_EXPIRED",
          message: "Invite is expired, revoked, or unavailable.",
          request_id: request.client_request_id,
        },
      },
    } satisfies HandlerResult<never>;
  }
}
