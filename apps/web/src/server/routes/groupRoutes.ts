import type { PostgrestClient } from "../db/postgrestClient.js";
import type {
  CreateGroupRequest,
  CreateInviteRequest,
  AcceptInviteRequest,
  CreateVirtualMemberRequest,
  RenameGroupMemberRequest,
  UpdateGroupRequest,
} from "../../contracts/schemas.js";
import {
  validateCreateVirtualMemberRequest,
  validateRenameGroupMemberRequest,
} from "../../contracts/validation.js";
import type { GoogleTokenVerifier } from "../auth/google.js";
import { buildAuthContext } from "../auth/routeContext.js";
import {
  createSupabaseGroupRepository,
} from "../repositories/supabaseGroupRepository.js";
import {
  handleAcceptInvite,
  handleArchiveGroup,
  handleCreateGroup,
  handleCreateInvite,
  handleCreateVirtualMember,
  handleDeleteGroup,
  handleGetGroupDetail,
  handleListArchivedGroups,
  handleListGroups,
  handleMarkGroupRead,
  handleRemoveGroupMember,
  handleRenameGroupMember,
  handleUnarchiveGroup,
  handleUpdateGroup,
} from "../handlers/groups.js";
import type { SupabaseStorageClient } from "../runtime/supabaseStorageClient.js";

type RouteOptions = {
  client: PostgrestClient;
  verifier: GoogleTokenVerifier;
  idToken: string;
  /** Optional so this type stays compatible with call sites that don't need storage cleanup; updateGroupRoute passes it through to handleUpdateGroup's previous-cover cleanup hook when present. */
  storage?: SupabaseStorageClient;
};


export async function createGroupRoute(options: RouteOptions, request: CreateGroupRequest) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleCreateGroup(createSupabaseGroupRepository(options.client), auth.context, request);
}

export async function listGroupsRoute(options: RouteOptions) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleListGroups(createSupabaseGroupRepository(options.client), auth.context);
}

export async function markGroupReadRoute(options: RouteOptions, groupId: string) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleMarkGroupRead(createSupabaseGroupRepository(options.client), auth.context, groupId);
}

export async function listArchivedGroupsRoute(options: RouteOptions) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleListArchivedGroups(createSupabaseGroupRepository(options.client), auth.context);
}

export async function getGroupDetailRoute(options: RouteOptions, groupId: string) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleGetGroupDetail(createSupabaseGroupRepository(options.client), auth.context, groupId);
}

export async function updateGroupRoute(options: RouteOptions, groupId: string, request: UpdateGroupRequest) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleUpdateGroup(createSupabaseGroupRepository(options.client), auth.context, groupId, request, options.storage);
}

export async function createVirtualMemberRoute(
  options: RouteOptions,
  groupId: string,
  request: CreateVirtualMemberRequest,
) {
  const validation = validateCreateVirtualMemberRequest(request);

  if (!validation.ok) {
    return { ok: false, status: 400, body: { issues: validation.issues } };
  }

  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleCreateVirtualMember(createSupabaseGroupRepository(options.client), auth.context, groupId, request);
}

export async function renameGroupMemberRoute(
  options: RouteOptions,
  groupId: string,
  memberId: string,
  request: RenameGroupMemberRequest,
) {
  const validation = validateRenameGroupMemberRequest(request);

  if (!validation.ok) {
    return { ok: false, status: 400, body: { issues: validation.issues } };
  }

  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleRenameGroupMember(createSupabaseGroupRepository(options.client), auth.context, groupId, memberId, request);
}

export async function removeGroupMemberRoute(
  options: RouteOptions,
  groupId: string,
  memberId: string,
  clientRequestId: string,
) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleRemoveGroupMember(
    createSupabaseGroupRepository(options.client),
    auth.context,
    groupId,
    memberId,
    clientRequestId,
  );
}

export async function archiveGroupRoute(options: RouteOptions, groupId: string, clientRequestId: string) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleArchiveGroup(createSupabaseGroupRepository(options.client), auth.context, groupId, clientRequestId);
}

export async function unarchiveGroupRoute(options: RouteOptions, groupId: string, clientRequestId: string) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleUnarchiveGroup(createSupabaseGroupRepository(options.client), auth.context, groupId, clientRequestId);
}

export async function deleteGroupRoute(options: RouteOptions, groupId: string, clientRequestId: string) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleDeleteGroup(createSupabaseGroupRepository(options.client), auth.context, groupId, clientRequestId);
}

export async function createInviteRoute(
  options: RouteOptions,
  groupId: string,
  request: CreateInviteRequest,
) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleCreateInvite(createSupabaseGroupRepository(options.client), auth.context, groupId, request);
}

export async function acceptInviteRoute(
  options: RouteOptions,
  token: string,
  request: AcceptInviteRequest,
) {
  const auth = await buildAuthContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAcceptInvite(createSupabaseGroupRepository(options.client), auth.context, token, request);
}
