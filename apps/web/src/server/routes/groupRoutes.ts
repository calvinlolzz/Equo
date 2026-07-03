import type {
  CreateGroupRequest,
  CreateInviteRequest,
  AcceptInviteRequest,
  CreateVirtualMemberRequest,
  UpdateGroupRequest,
} from "../../contracts/schemas.js";
import { verifyGoogleIdToken, type GoogleTokenVerifier } from "../auth/google.js";
import { requireAuthenticatedUser } from "../auth/session.js";
import {
  createSupabaseGroupRepository,
  type SupabaseQueryClient,
  upsertUserByGoogleIdentity,
} from "../repositories/supabaseGroupRepository.js";
import { createSupabaseExpenseRepository } from "../repositories/supabaseExpenseRepository.js";
import { createSupabaseSettlementRepository } from "../repositories/supabaseSettlementRepository.js";
import {
  handleAcceptInvite,
  handleArchiveGroup,
  handleCreateGroup,
  handleCreateInvite,
  handleCreateVirtualMember,
  handleDeleteGroup,
  handleGetGroupDetail,
  handleListGroups,
  handleUpdateGroup,
} from "../handlers/groups.js";

type RouteOptions = {
  client: SupabaseQueryClient;
  verifier: GoogleTokenVerifier;
  idToken: string;
};

async function buildRouteContext(options: RouteOptions) {
  const identity = await verifyGoogleIdToken(options.idToken, options.verifier);
  return requireAuthenticatedUser(identity, (googleIdentity) =>
    upsertUserByGoogleIdentity(options.client, googleIdentity),
  );
}

export async function createGroupRoute(options: RouteOptions, request: CreateGroupRequest) {
  const auth = await buildRouteContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleCreateGroup(createSupabaseGroupRepository(options.client), auth.context, request);
}

export async function listGroupsRoute(options: RouteOptions) {
  const auth = await buildRouteContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleListGroups(createSupabaseGroupRepository(options.client), auth.context);
}

export async function getGroupDetailRoute(options: RouteOptions, groupId: string) {
  const auth = await buildRouteContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleGetGroupDetail(
    createSupabaseGroupRepository(options.client),
    createSupabaseExpenseRepository(options.client),
    createSupabaseSettlementRepository(options.client),
    auth.context,
    groupId,
  );
}

export async function updateGroupRoute(options: RouteOptions, groupId: string, request: UpdateGroupRequest) {
  const auth = await buildRouteContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleUpdateGroup(createSupabaseGroupRepository(options.client), auth.context, groupId, request);
}

export async function createVirtualMemberRoute(
  options: RouteOptions,
  groupId: string,
  request: CreateVirtualMemberRequest,
) {
  const auth = await buildRouteContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleCreateVirtualMember(createSupabaseGroupRepository(options.client), auth.context, groupId, request);
}

export async function archiveGroupRoute(options: RouteOptions, groupId: string, clientRequestId: string) {
  const auth = await buildRouteContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleArchiveGroup(createSupabaseGroupRepository(options.client), auth.context, groupId, clientRequestId);
}

export async function deleteGroupRoute(options: RouteOptions, groupId: string, clientRequestId: string) {
  const auth = await buildRouteContext(options);

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
  const auth = await buildRouteContext(options);

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
  const auth = await buildRouteContext(options);

  if (auth.ok === false) {
    return { ok: false, status: 401, body: auth.error };
  }

  return handleAcceptInvite(createSupabaseGroupRepository(options.client), auth.context, token, request);
}
