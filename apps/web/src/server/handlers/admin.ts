import type { ApiError } from "../../contracts/errors.js";
import type { AuthenticatedContext } from "../auth/session.js";
import type {
  AdminGroupListRecord,
  AdminOverviewRecord,
  AdminRepository,
  AdminUserDetailRecord,
  AdminUserListRecord,
} from "../repositories/adminRepository.js";

type HandlerResult<T> =
  | { ok: true; status: number; body: T }
  | { ok: false; status: number; body: ApiError };

export const ADMIN_LIST_DEFAULT_LIMIT = 20;
export const ADMIN_LIST_MAX_LIMIT = 100;

export type AdminListQuery = {
  search?: string;
  limit?: number;
  offset?: number;
};

function adminForbidden(request_id = "req_admin"): HandlerResult<never> {
  return {
    ok: false,
    status: 403,
    body: {
      error: {
        code: "ADMIN_FORBIDDEN",
        message: "This account has no admin console access.",
        request_id,
      },
    },
  };
}

function adminNotFound(message: string, request_id = "req_admin"): HandlerResult<never> {
  return {
    ok: false,
    status: 404,
    body: {
      error: {
        code: "ADMIN_NOT_FOUND",
        message,
        request_id,
      },
    },
  };
}

/**
 * Normalizes untrusted list query params: search is trimmed, limit is
 * clamped to [1, ADMIN_LIST_MAX_LIMIT] (default ADMIN_LIST_DEFAULT_LIMIT),
 * offset to >= 0. Non-finite numbers (NaN from a bad query string) fall
 * back to the defaults instead of leaking into SQL.
 */
export function normalizeAdminListQuery(query: AdminListQuery = {}): {
  search: string;
  limit: number;
  offset: number;
} {
  const limit = Number.isFinite(query.limit)
    ? Math.min(Math.max(Math.trunc(query.limit as number), 1), ADMIN_LIST_MAX_LIMIT)
    : ADMIN_LIST_DEFAULT_LIMIT;
  const offset = Number.isFinite(query.offset) ? Math.max(Math.trunc(query.offset as number), 0) : 0;

  return {
    search: (query.search ?? "").trim(),
    limit,
    offset,
  };
}

export type AdminMeResponse = {
  user: {
    id: string;
    email: string;
    display_name: string;
    avatar_url?: string | null;
  };
  role: string;
};

export async function handleAdminMe(
  repository: AdminRepository,
  context: AuthenticatedContext,
): Promise<HandlerResult<AdminMeResponse>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  return {
    ok: true,
    status: 200,
    body: {
      user: {
        id: context.user.id,
        email: context.user.email,
        display_name: context.user.display_name,
        avatar_url: context.user.avatar_url ?? null,
      },
      role,
    },
  };
}

export async function handleAdminOverview(
  repository: AdminRepository,
  context: AuthenticatedContext,
): Promise<HandlerResult<AdminOverviewRecord>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  const overview = await repository.getOverview();
  return { ok: true, status: 200, body: overview };
}

export async function handleAdminListUsers(
  repository: AdminRepository,
  context: AuthenticatedContext,
  query: AdminListQuery = {},
): Promise<HandlerResult<AdminUserListRecord>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  const { search, limit, offset } = normalizeAdminListQuery(query);
  const page = await repository.listUsers(search, limit, offset);
  return { ok: true, status: 200, body: page };
}

export async function handleAdminUserDetail(
  repository: AdminRepository,
  context: AuthenticatedContext,
  userId: string,
): Promise<HandlerResult<AdminUserDetailRecord>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  const detail = await repository.getUserDetail(userId);

  if (!detail) {
    return adminNotFound("User not found.");
  }

  return { ok: true, status: 200, body: detail };
}

export async function handleAdminListGroups(
  repository: AdminRepository,
  context: AuthenticatedContext,
  query: AdminListQuery = {},
): Promise<HandlerResult<AdminGroupListRecord>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  const { search, limit, offset } = normalizeAdminListQuery(query);
  const page = await repository.listGroups(search, limit, offset);
  return { ok: true, status: 200, body: page };
}
