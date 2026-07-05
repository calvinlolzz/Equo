import type { ApiError } from "../../contracts/errors.js";
import type {
  AcceptInviteRequest,
  CreateGroupRequest,
  CreateInviteRequest,
  CreateVirtualMemberRequest,
  UpdateGroupRequest,
} from "../../contracts/schemas.js";
import type { AuthenticatedContext } from "../auth/session.js";
import type { GroupMemberRecord, GroupRepository } from "../repositories/groupRepository.js";

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

export async function requireGroupMember(
  repository: GroupRepository,
  context: AuthenticatedContext,
  groupId: string,
): Promise<GroupMemberRecord | null> {
  return repository.findActiveMember(groupId, context.user.id);
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
) {
  const member = await requireGroupMember(repository, context, groupId);

  if (!member) {
    return forbidden(request.client_request_id);
  }

  const group = await repository.updateGroup(groupId, request);
  await repository.recordClientRequest(groupId, request.client_request_id, group.id);

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
  const member = await requireGroupMember(repository, context, groupId);

  if (!member) {
    return forbidden(clientRequestId);
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
  const member = await requireGroupMember(repository, context, groupId);

  if (!member) {
    return forbidden(clientRequestId);
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
  const member = await requireGroupMember(repository, context, groupId);

  if (!member) {
    return forbidden(clientRequestId);
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

  const virtualMember = await repository.createVirtualMember(groupId, request.display_name);
  await repository.recordClientRequest(groupId, request.client_request_id, virtualMember.id);

  return {
    ok: true,
    status: 201,
    body: { member: virtualMember },
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

export async function handleAcceptInvite(
  repository: GroupRepository,
  context: AuthenticatedContext,
  token: string,
  request: AcceptInviteRequest,
) {
  const token_hash = await repository.hashInviteToken(token);
  const invite = await repository.findInviteByTokenHash(token_hash);

  if (!invite) {
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

  const result = await repository.acceptInvite(context, token, request);
  await repository.recordClientRequest(result.group.id, request.client_request_id, result.member.id);

  return {
    ok: true,
    status: 200,
    body: result,
  } satisfies HandlerResult<unknown>;
}
