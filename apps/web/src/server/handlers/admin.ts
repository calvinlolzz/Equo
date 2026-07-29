import type { ApiError } from "../../contracts/errors.js";
import type { AuthenticatedContext } from "../auth/session.js";
import type {
  AdminAccountRecord,
  AdminAuditLogListRecord,
  AdminErrorListRecord,
  AdminExpenseListRecord,
  AdminFeedbackListRecord,
  AdminFeedbackStatus,
  AdminGroupDetailRecord,
  AdminGroupFilter,
  AdminGroupListRecord,
  AdminGroupStateResult,
  AdminHealthRecord,
  AdminOverviewRecord,
  AdminRepository,
  AdminStorageRecord,
  AdminTrendsRecord,
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

/**
 * Route ids reach us as raw path segments, but the admin_console_* RPCs type
 * their group/user params as uuid. A non-uuid segment makes PostgREST raise
 * 22P02, which the runtime turns into a 500 - the wrong answer for "look up
 * this id". Handlers screen the shape first and treat a malformed id as simply
 * not found, since a value that can't be a uuid can't name a real row.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Admin roles are ranked: support (read + feedback triage) < admin (+ the
 * destructive user/group writes) < owner (+ managing admins). A handler names
 * the minimum rank it needs; the gate below turns a too-low or absent role into
 * a 403. The console still hides what a role can't do, but the rank check here
 * is the actual enforcement - the UI is only a convenience.
 */
export const ADMIN_ROLE_RANK: Record<string, number> = {
  support: 1,
  admin: 2,
  owner: 3,
};

export function adminRoleAtLeast(role: string | null, min: number): boolean {
  return role !== null && (ADMIN_ROLE_RANK[role] ?? 0) >= min;
}

function adminForbidden(
  message = "This account has no admin console access.",
  request_id = "req_admin",
): HandlerResult<never> {
  return {
    ok: false,
    status: 403,
    body: {
      error: {
        code: "ADMIN_FORBIDDEN",
        message,
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

/** 409 for a request that's well-formed but conflicts with an invariant (last owner). */
function adminConflict(message: string, request_id = "req_admin"): HandlerResult<never> {
  return {
    ok: false,
    status: 409,
    body: {
      error: {
        code: "ADMIN_CONFLICT",
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

/** Trend windows the console offers. Anything else falls back to 30. */
const TREND_WINDOWS: readonly number[] = [7, 30, 90];
const DEFAULT_TREND_DAYS = 30;

/**
 * The requested window, or 30. Restricted to the console's own options rather
 * than clamped to a range: an arbitrary p_days is a free knob for scanning the
 * whole users/expenses history, and nothing needs 137 days.
 */
export function resolveTrendDays(raw: string | undefined): number {
  const parsed = Number(raw);
  return TREND_WINDOWS.includes(parsed) ? parsed : DEFAULT_TREND_DAYS;
}

export async function handleAdminTrends(
  repository: AdminRepository,
  context: AuthenticatedContext,
  days: string | undefined,
): Promise<HandlerResult<AdminTrendsRecord>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  const trends = await repository.getTrends(resolveTrendDays(days));
  return { ok: true, status: 200, body: trends };
}

export async function handleAdminHealth(
  repository: AdminRepository,
  context: AuthenticatedContext,
): Promise<HandlerResult<AdminHealthRecord>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  const health = await repository.getHealth();
  return { ok: true, status: 200, body: health };
}

export async function handleAdminStorage(
  repository: AdminRepository,
  context: AuthenticatedContext,
): Promise<HandlerResult<AdminStorageRecord>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  const storage = await repository.getStorage();
  return { ok: true, status: 200, body: storage };
}

const ADMIN_ROLE_NAMES: readonly string[] = ["owner", "admin", "support"];

export async function handleAdminListAdmins(
  repository: AdminRepository,
  context: AuthenticatedContext,
): Promise<HandlerResult<{ admins: AdminAccountRecord[] }>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!adminRoleAtLeast(role, ADMIN_ROLE_RANK.owner)) {
    return adminForbidden("Managing admins requires an owner role.");
  }

  const admins = await repository.listAdmins();
  return { ok: true, status: 200, body: { admins } };
}

export async function handleAdminSetAdminRole(
  repository: AdminRepository,
  context: AuthenticatedContext,
  targetEmail: string | undefined,
  newRole: string | undefined,
): Promise<HandlerResult<{ admin: AdminAccountRecord }>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!adminRoleAtLeast(role, ADMIN_ROLE_RANK.owner)) {
    return adminForbidden("Managing admins requires an owner role.");
  }

  const email = (targetEmail ?? "").trim();
  if (!email || !ADMIN_ROLE_NAMES.includes(newRole ?? "")) {
    return {
      ok: false,
      status: 400,
      body: {
        error: {
          code: "INVALID_ADMIN",
          message: `email is required and role must be one of: ${ADMIN_ROLE_NAMES.join(", ")}`,
          request_id: "req_admin",
        },
      },
    };
  }

  const result = await repository.setAdminRole(
    { id: context.user.id, email: context.user.email },
    email,
    newRole as string,
  );

  if (!result.ok) {
    if (result.error === "USER_NOT_FOUND") {
      return adminNotFound("No user with that email.");
    }
    if (result.error === "LAST_OWNER") {
      return adminConflict("Cannot demote the last owner.");
    }
    // INVALID_ROLE - already screened above, but the RPC double-checks.
    return {
      ok: false,
      status: 400,
      body: { error: { code: "INVALID_ADMIN", message: "Invalid role.", request_id: "req_admin" } },
    };
  }

  return { ok: true, status: 200, body: { admin: result.admin } };
}

export async function handleAdminRemoveAdmin(
  repository: AdminRepository,
  context: AuthenticatedContext,
  userId: string,
): Promise<HandlerResult<{ user_id: string }>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!adminRoleAtLeast(role, ADMIN_ROLE_RANK.owner)) {
    return adminForbidden("Managing admins requires an owner role.");
  }

  if (!isUuid(userId)) {
    return adminNotFound("Admin not found.");
  }

  const result = await repository.removeAdmin({ id: context.user.id, email: context.user.email }, userId);

  if (!result.ok) {
    if (result.error === "NOT_AN_ADMIN") {
      return adminNotFound("Admin not found.");
    }
    return adminConflict("Cannot remove the last owner.");
  }

  return { ok: true, status: 200, body: { user_id: result.user_id } };
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

  if (!isUuid(userId)) {
    return adminNotFound("User not found.");
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

export async function handleAdminGroupDetail(
  repository: AdminRepository,
  context: AuthenticatedContext,
  groupId: string,
): Promise<HandlerResult<AdminGroupDetailRecord>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  if (!isUuid(groupId)) {
    return adminNotFound("Group not found.");
  }

  const detail = await repository.getGroupDetail({ id: context.user.id, email: context.user.email }, groupId);

  if (!detail) {
    return adminNotFound("Group not found.");
  }

  return { ok: true, status: 200, body: detail };
}

export type AdminExpenseListQuery = AdminListQuery & {
  include_deleted?: boolean;
};

export async function handleAdminListGroupExpenses(
  repository: AdminRepository,
  context: AuthenticatedContext,
  groupId: string,
  query: AdminExpenseListQuery = {},
): Promise<HandlerResult<AdminExpenseListRecord>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  if (!isUuid(groupId)) {
    return adminNotFound("Group not found.");
  }

  const { limit, offset } = normalizeAdminListQuery(query);
  const page = await repository.listGroupExpenses(
    { id: context.user.id, email: context.user.email },
    groupId,
    limit,
    offset,
    query.include_deleted === true,
  );

  if (!page) {
    return adminNotFound("Group not found.");
  }

  return { ok: true, status: 200, body: page };
}

/** The admin_audit_logs actions the console knows how to label and filter by. */
export const AUDIT_ACTIONS: readonly string[] = [
  "user.disable",
  "user.enable",
  "group.archive",
  "group.unarchive",
  "group.delete",
  "group.restore",
  "group.view",
];

/** An unknown/absent action means "any", matching the RPC's '' / 'all' handling. */
export function normalizeAuditActionFilter(action: string | undefined): string {
  return AUDIT_ACTIONS.includes(action ?? "") ? (action as string) : "";
}

export type AdminAuditLogQuery = AdminListQuery & {
  action?: string;
};

export async function handleAdminListAuditLogs(
  repository: AdminRepository,
  context: AuthenticatedContext,
  query: AdminAuditLogQuery = {},
): Promise<HandlerResult<AdminAuditLogListRecord>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  const { search, limit, offset } = normalizeAdminListQuery(query);
  const page = await repository.listAuditLogs(search, normalizeAuditActionFilter(query.action), limit, offset);
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

  const { search, limit, offset } = normalizeAdminListQuery(query);
  const page = await repository.listErrors(search, limit, offset);
  return { ok: true, status: 200, body: page };
}

export async function handleAdminSetUserDisabled(
  repository: AdminRepository,
  context: AuthenticatedContext,
  userId: string,
  disabled: boolean,
): Promise<HandlerResult<AdminUserDisabledResult>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!adminRoleAtLeast(role, ADMIN_ROLE_RANK.admin)) {
    return adminForbidden("This action requires an admin or owner role.");
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

  if (!adminRoleAtLeast(role, ADMIN_ROLE_RANK.admin)) {
    return adminForbidden("This action requires an admin or owner role.");
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

  if (!adminRoleAtLeast(role, ADMIN_ROLE_RANK.admin)) {
    return adminForbidden("This action requires an admin or owner role.");
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
