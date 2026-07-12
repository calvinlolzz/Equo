import type { ApiError } from "../../contracts/errors.js";
import type { AuthenticatedContext } from "../auth/session.js";
import type {
  AdminAuditLogListRecord,
  AdminErrorListRecord,
  AdminFeedbackListRecord,
  AdminFeedbackStatus,
  AdminGroupFilter,
  AdminGroupListRecord,
  AdminGroupStateResult,
  AdminOverviewRecord,
  AdminRepository,
  AdminUserDetailRecord,
  AdminUserDisabledResult,
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

export type AdminGroupListQuery = AdminListQuery & {
  filter?: string;
};

const GROUP_FILTERS: readonly AdminGroupFilter[] = ["all", "archived", "empty", "deleted"];

/** Unknown/absent filter strings fall back to 'all' rather than erroring. */
export function normalizeGroupFilter(filter: string | undefined): AdminGroupFilter {
  return (GROUP_FILTERS as readonly string[]).includes(filter ?? "") ? (filter as AdminGroupFilter) : "all";
}

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
  query: AdminGroupListQuery = {},
): Promise<HandlerResult<AdminGroupListRecord>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  const { search, limit, offset } = normalizeAdminListQuery(query);
  const page = await repository.listGroups(search, limit, offset, normalizeGroupFilter(query.filter));
  return { ok: true, status: 200, body: page };
}

export async function handleAdminListAuditLogs(
  repository: AdminRepository,
  context: AuthenticatedContext,
  query: AdminListQuery = {},
): Promise<HandlerResult<AdminAuditLogListRecord>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  const { limit, offset } = normalizeAdminListQuery(query);
  const page = await repository.listAuditLogs(limit, offset);
  return { ok: true, status: 200, body: page };
}

const FEEDBACK_STATUSES: readonly AdminFeedbackStatus[] = ["new", "reviewing", "done"];

export function normalizeFeedbackStatusFilter(status: string | undefined): string {
  return (FEEDBACK_STATUSES as readonly string[]).includes(status ?? "") ? (status as string) : "all";
}

export type AdminFeedbackListQuery = AdminListQuery & {
  status?: string;
};

export async function handleAdminListFeedback(
  repository: AdminRepository,
  context: AuthenticatedContext,
  query: AdminFeedbackListQuery = {},
): Promise<HandlerResult<AdminFeedbackListRecord>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  const { limit, offset } = normalizeAdminListQuery(query);
  const page = await repository.listFeedback(limit, offset, normalizeFeedbackStatusFilter(query.status));
  return { ok: true, status: 200, body: page };
}

export async function handleAdminSetFeedbackStatus(
  repository: AdminRepository,
  context: AuthenticatedContext,
  feedbackId: string,
  status: string | undefined,
): Promise<HandlerResult<{ id: string; status: string }>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  if (!(FEEDBACK_STATUSES as readonly string[]).includes(status ?? "")) {
    return {
      ok: false,
      status: 400,
      body: {
        error: {
          code: "INVALID_FEEDBACK",
          message: `status must be one of: ${FEEDBACK_STATUSES.join(", ")}`,
          request_id: "req_admin",
        },
      },
    };
  }

  const result = await repository.setFeedbackStatus(
    { id: context.user.id, email: context.user.email },
    feedbackId,
    status as AdminFeedbackStatus,
  );

  if (!result) {
    return adminNotFound("Feedback not found.");
  }

  return { ok: true, status: 200, body: result };
}

export async function handleAdminListErrors(
  repository: AdminRepository,
  context: AuthenticatedContext,
  query: AdminListQuery = {},
): Promise<HandlerResult<AdminErrorListRecord>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  const { limit, offset } = normalizeAdminListQuery(query);
  const page = await repository.listErrors(limit, offset);
  return { ok: true, status: 200, body: page };
}

export async function handleAdminSetUserDisabled(
  repository: AdminRepository,
  context: AuthenticatedContext,
  userId: string,
  disabled: boolean,
): Promise<HandlerResult<AdminUserDisabledResult>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  const result = await repository.setUserDisabled(
    { id: context.user.id, email: context.user.email },
    userId,
    disabled,
  );

  if (!result) {
    return adminNotFound("User not found.");
  }

  return { ok: true, status: 200, body: result };
}

export async function handleAdminSetGroupArchived(
  repository: AdminRepository,
  context: AuthenticatedContext,
  groupId: string,
  archived: boolean,
): Promise<HandlerResult<AdminGroupStateResult>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  const result = await repository.setGroupArchived(
    { id: context.user.id, email: context.user.email },
    groupId,
    archived,
  );

  if (!result) {
    return adminNotFound("Group not found or deleted.");
  }

  return { ok: true, status: 200, body: result };
}

export async function handleAdminSetGroupDeleted(
  repository: AdminRepository,
  context: AuthenticatedContext,
  groupId: string,
  deleted: boolean,
): Promise<HandlerResult<AdminGroupStateResult>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  const result = await repository.setGroupDeleted(
    { id: context.user.id, email: context.user.email },
    groupId,
    deleted,
  );

  if (!result) {
    return adminNotFound("Group not found.");
  }

  return { ok: true, status: 200, body: result };
}
