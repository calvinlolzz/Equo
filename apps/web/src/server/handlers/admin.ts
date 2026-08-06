import type { ApiError } from "../../contracts/errors.js";
import type { AuthenticatedContext } from "../auth/session.js";
import type { ReceiptScanSettings, SettingsRepository } from "../repositories/supabaseSettingsRepository.js";
import {
  RECEIPT_SCAN_MODELS,
  availableReceiptScanModels,
  isReceiptScanModel,
  type ReceiptScanKeys,
  type ReceiptScanModel,
} from "../runtime/receiptScanner.js";
import type {
  AdminAccountRecord,
  AdminAuditLogListRecord,
  AdminCatalogRecord,
  AdminDeleteUserResult,
  AdminRateOverrideResult,
  AdminSaveCategoryResult,
  AdminSaveCurrencyResult,
  AdminErrorGroupListRecord,
  AdminErrorGroupStatus,
  AdminErrorListRecord,
  AdminExpenseListRecord,
  AdminExpenseMetaPatch,
  AdminExpenseWriteResult,
  AdminFeedbackListRecord,
  AdminFeedbackStatus,
  AdminMergeConflictGroup,
  AdminMergeUsersResult,
  AdminDeleteNotificationResult,
  AdminNotificationAudience,
  AdminReplyFeedbackResult,
  AdminSendNotificationResult,
  AdminSentNotificationListRecord,
  AdminTransferOwnerResult,
  AdminUserExportRecord,
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
/** The console's view of receipt recognition: the saved settings plus what the deployment allows. */
export type AdminReceiptScanSettings = ReceiptScanSettings & {
  /**
   * Can the CURRENTLY SELECTED model actually run - i.e. does its provider have
   * a key. False means the switch below has nothing to switch, and the fix is
   * in the deployment's env rather than in the console.
   */
  configured: boolean;
  /**
   * Every model this build knows, each marked with whether its provider has a
   * key here. The console shows them all rather than hiding the unusable ones,
   * because "why is Gemini not in the list" is a worse question to be left with
   * than "Gemini needs a key".
   */
  models: Array<ReceiptScanModel & { available: boolean }>;
};

/** Can the saved model actually run here, i.e. does its provider have a key. */
function canRun(models: AdminReceiptScanSettings["models"], model: string): boolean {
  return models.some((entry) => entry.id === model && entry.available);
}

/** The catalog as the console needs it: every model, each flagged runnable or not. */
function describeModels(keys: ReceiptScanKeys): AdminReceiptScanSettings["models"] {
  const available = new Set(availableReceiptScanModels(keys).map((entry) => entry.id));
  return RECEIPT_SCAN_MODELS.map((entry) => ({ ...entry, available: available.has(entry.id) }));
}

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
  receiptScan?: AdminHealthRecord["receipt_scan"],
): Promise<HandlerResult<AdminHealthRecord>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  const health = await repository.getHealth();
  return { ok: true, status: 200, body: receiptScan ? { ...health, receipt_scan: receiptScan } : health };
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
  "user.merge",
  "user.export",
  "user.delete",
  "group.archive",
  "group.unarchive",
  "group.delete",
  "group.restore",
  "group.transfer_owner",
  "group.view",
  "expense.update",
  "expense.delete",
  "expense.restore",
  "error.status",
  "notification.send",
  "notification.delete",
  "feedback.reply",
  "catalog.category",
  "catalog.currency",
  "catalog.rate_set",
  "catalog.rate_clear",
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

const ERROR_GROUP_STATUSES: readonly AdminErrorGroupStatus[] = ["open", "resolved"];

/** An unknown/absent status means "any", matching the RPC's ''/'all' handling. */
export function normalizeErrorStatusFilter(status: string | undefined): string {
  return (ERROR_GROUP_STATUSES as readonly string[]).includes(status ?? "") ? (status as string) : "all";
}

export type AdminErrorListQuery = AdminListQuery & {
  status?: string;
  fingerprint?: string;
};

export async function handleAdminListErrorGroups(
  repository: AdminRepository,
  context: AuthenticatedContext,
  query: AdminErrorListQuery = {},
): Promise<HandlerResult<AdminErrorGroupListRecord>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  const { search, limit, offset } = normalizeAdminListQuery(query);
  const page = await repository.listErrorGroups(search, normalizeErrorStatusFilter(query.status), limit, offset);
  return { ok: true, status: 200, body: page };
}

export async function handleAdminListErrors(
  repository: AdminRepository,
  context: AuthenticatedContext,
  query: AdminErrorListQuery = {},
): Promise<HandlerResult<AdminErrorListRecord>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  const { search, limit, offset } = normalizeAdminListQuery(query);
  const page = await repository.listErrors(search, (query.fingerprint ?? "").trim(), limit, offset);
  return { ok: true, status: 200, body: page };
}

export async function handleAdminSetErrorGroupStatus(
  repository: AdminRepository,
  context: AuthenticatedContext,
  fingerprint: string,
  status: string | undefined,
): Promise<HandlerResult<{ fingerprint: string; status: string }>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  if (!(ERROR_GROUP_STATUSES as readonly string[]).includes(status ?? "")) {
    return {
      ok: false,
      status: 400,
      body: {
        error: {
          code: "MALFORMED_REQUEST",
          message: `status must be one of: ${ERROR_GROUP_STATUSES.join(", ")}`,
          request_id: "req_admin",
        },
      },
    };
  }

  const result = await repository.setErrorGroupStatus(
    { id: context.user.id, email: context.user.email },
    fingerprint,
    status as AdminErrorGroupStatus,
  );

  if (!result) {
    return adminNotFound("Error group not found.");
  }

  return { ok: true, status: 200, body: result };
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

/**
 * The support actions - the writes that used to mean opening a SQL client.
 *
 * Two rank lines run through them. Correcting or removing an expense and moving
 * a group's ownership sit at admin, alongside the other reversible writes.
 * Merging and deleting an account sit at owner: a merge retires one of the two
 * identities and a deletion is the only action in the console with nothing
 * behind it to restore from.
 */

/** A date the RPC's `date` parameter will accept, rather than one Postgres has to guess at. */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function adminBadRequest(message: string): HandlerResult<never> {
  return {
    ok: false,
    status: 400,
    body: { error: { code: "INVALID_ADMIN", message, request_id: "req_admin" } },
  };
}

export async function handleAdminSetExpenseDeleted(
  repository: AdminRepository,
  context: AuthenticatedContext,
  groupId: string,
  expenseId: string,
  deleted: boolean,
): Promise<HandlerResult<AdminExpenseWriteResult>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!adminRoleAtLeast(role, ADMIN_ROLE_RANK.admin)) {
    return adminForbidden("This action requires an admin or owner role.");
  }

  if (!isUuid(groupId) || !isUuid(expenseId)) {
    return adminNotFound("Expense not found.");
  }

  const result = await repository.setExpenseDeleted(
    { id: context.user.id, email: context.user.email },
    groupId,
    expenseId,
    deleted,
  );

  if (!result) {
    return adminNotFound("Expense not found.");
  }

  return { ok: true, status: 200, body: result };
}

/**
 * Screen the patch before it reaches the RPC.
 *
 * An empty patch is rejected rather than allowed through as a no-op: it would
 * still bump the row's version and write an audit entry saying an admin changed
 * an expense, which is a false statement about what happened.
 */
export function normalizeExpenseMetaPatch(
  body: { title?: unknown; category?: unknown; expense_date?: unknown; note?: unknown } = {},
): { ok: true; patch: AdminExpenseMetaPatch } | { ok: false; message: string } {
  const patch: AdminExpenseMetaPatch = {};

  if (body.title !== undefined) {
    if (typeof body.title !== "string" || body.title.trim() === "") {
      return { ok: false, message: "title must be a non-empty string." };
    }
    patch.title = body.title.trim();
  }

  if (body.category !== undefined) {
    if (typeof body.category !== "string" || body.category.trim() === "") {
      return { ok: false, message: "category must be a non-empty string." };
    }
    patch.category = body.category.trim();
  }

  if (body.expense_date !== undefined) {
    if (typeof body.expense_date !== "string" || !ISO_DATE_RE.test(body.expense_date)) {
      return { ok: false, message: "expense_date must be a YYYY-MM-DD string." };
    }
    patch.expense_date = body.expense_date;
  }

  // "" is meaningful here - it is how a note is cleared - so only a non-string
  // is a bad value.
  if (body.note !== undefined) {
    if (typeof body.note !== "string") {
      return { ok: false, message: "note must be a string." };
    }
    patch.note = body.note;
  }

  if (Object.keys(patch).length === 0) {
    return { ok: false, message: "Nothing to change." };
  }

  return { ok: true, patch };
}

export async function handleAdminUpdateExpenseMeta(
  repository: AdminRepository,
  context: AuthenticatedContext,
  groupId: string,
  expenseId: string,
  body: { title?: unknown; category?: unknown; expense_date?: unknown; note?: unknown } = {},
): Promise<HandlerResult<AdminExpenseWriteResult>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!adminRoleAtLeast(role, ADMIN_ROLE_RANK.admin)) {
    return adminForbidden("This action requires an admin or owner role.");
  }

  if (!isUuid(groupId) || !isUuid(expenseId)) {
    return adminNotFound("Expense not found.");
  }

  const normalized = normalizeExpenseMetaPatch(body);

  if (!normalized.ok) {
    return adminBadRequest(normalized.message);
  }

  const result = await repository.updateExpenseMeta(
    { id: context.user.id, email: context.user.email },
    groupId,
    expenseId,
    normalized.patch,
  );

  if (!result) {
    return adminNotFound("Expense not found.");
  }

  return { ok: true, status: 200, body: result };
}

export async function handleAdminTransferGroupOwner(
  repository: AdminRepository,
  context: AuthenticatedContext,
  groupId: string,
  memberId: string | undefined,
): Promise<HandlerResult<Extract<AdminTransferOwnerResult, { ok: true }>>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!adminRoleAtLeast(role, ADMIN_ROLE_RANK.admin)) {
    return adminForbidden("This action requires an admin or owner role.");
  }

  if (!isUuid(groupId)) {
    return adminNotFound("Group not found.");
  }

  if (!memberId || !isUuid(memberId)) {
    return adminNotFound("Member not found.");
  }

  const result = await repository.transferGroupOwner(
    { id: context.user.id, email: context.user.email },
    groupId,
    memberId,
  );

  if (!result.ok) {
    if (result.error === "GROUP_NOT_FOUND") {
      return adminNotFound("Group not found.");
    }
    if (result.error === "MEMBER_NOT_FOUND") {
      return adminNotFound("Member not found in this group.");
    }
    // MEMBER_NOT_CLAIMED - a well-formed request that the data refuses, which
    // is what 409 is for. The console explains it as "this member has no
    // account yet".
    return adminConflict("This member has never been claimed by a login and cannot own the group.");
  }

  return { ok: true, status: 200, body: result };
}

export async function handleAdminMergeUsers(
  repository: AdminRepository,
  context: AuthenticatedContext,
  sourceUserId: string,
  targetUserId: string | undefined,
): Promise<HandlerResult<Extract<AdminMergeUsersResult, { ok: true }> | { error: string; groups: AdminMergeConflictGroup[] }>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!adminRoleAtLeast(role, ADMIN_ROLE_RANK.owner)) {
    return adminForbidden("Merging accounts requires an owner role.");
  }

  if (!isUuid(sourceUserId)) {
    return adminNotFound("User not found.");
  }

  if (!targetUserId || !isUuid(targetUserId)) {
    return adminBadRequest("target_user_id must be a user id.");
  }

  // The account being retired ends this call disabled. Doing that to yourself
  // locks you out mid-operation, so it is refused here rather than discovered.
  if (sourceUserId === context.user.id) {
    return adminConflict("You cannot merge your own account away.");
  }

  const result = await repository.mergeUsers(
    { id: context.user.id, email: context.user.email },
    sourceUserId,
    targetUserId,
  );

  if (!result.ok) {
    if (result.error === "USER_NOT_FOUND") {
      return adminNotFound("User not found.");
    }
    if (result.error === "SAME_USER") {
      return adminBadRequest("Source and target must be different accounts.");
    }
    if (result.error === "SOURCE_IS_ADMIN") {
      return adminConflict("Remove the console role from this account before merging it.");
    }
    // GROUP_OVERLAP - the conflicting groups travel with the error so the
    // console can name them instead of saying "merge failed".
    return {
      ok: false,
      status: 409,
      body: {
        error: {
          code: "ADMIN_CONFLICT",
          message: "Both accounts are members of the same group; merge them by hand or remove one membership first.",
          request_id: "req_admin",
          details: { groups: result.groups ?? [] },
        },
      },
    };
  }

  return { ok: true, status: 200, body: result };
}

export async function handleAdminExportUser(
  repository: AdminRepository,
  context: AuthenticatedContext,
  userId: string,
): Promise<HandlerResult<AdminUserExportRecord>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!adminRoleAtLeast(role, ADMIN_ROLE_RANK.admin)) {
    return adminForbidden("This action requires an admin or owner role.");
  }

  if (!isUuid(userId)) {
    return adminNotFound("User not found.");
  }

  const document = await repository.exportUser({ id: context.user.id, email: context.user.email }, userId);

  if (!document) {
    return adminNotFound("User not found.");
  }

  return { ok: true, status: 200, body: document };
}

export async function handleAdminDeleteUser(
  repository: AdminRepository,
  context: AuthenticatedContext,
  userId: string,
): Promise<HandlerResult<Extract<AdminDeleteUserResult, { ok: true }>>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!adminRoleAtLeast(role, ADMIN_ROLE_RANK.owner)) {
    return adminForbidden("Deleting an account requires an owner role.");
  }

  if (!isUuid(userId)) {
    return adminNotFound("User not found.");
  }

  // Self-deletion goes through the account page, which knows to clear the
  // session afterwards. Doing it here would delete the identity behind the
  // request that is still running.
  if (userId === context.user.id) {
    return adminConflict("Delete your own account from the account page, not the console.");
  }

  const result = await repository.deleteUser({ id: context.user.id, email: context.user.email }, userId);

  if (!result) {
    return adminNotFound("User not found.");
  }

  if (!result.ok) {
    return adminConflict(
      result.reason === "last_admin_owner"
        ? "This is the last console owner; hand ownership over before deleting the account."
        : `Account deletion refused: ${result.reason}`,
    );
  }

  return { ok: true, status: 200, body: result };
}

/**
 * In-app messages, sent from the console.
 *
 * Admin rather than support to send: an announcement reaches every account at
 * once and cannot be recalled. Replying to a piece of feedback is the opposite
 * - it goes to exactly the person who wrote in, it is the job support exists to
 * do, and leaving it at owner/admin is how the queue silently stops being
 * answered.
 */

const NOTIFICATION_AUDIENCES: readonly AdminNotificationAudience[] = ["user", "group", "active", "all"];

/** Titles and bodies are bounded here so the RPC is never the first thing to notice. */
const NOTIFICATION_TITLE_MAX = 80;
const NOTIFICATION_BODY_MAX = 1000;

export type AdminSendNotificationBody = {
  audience?: unknown;
  target?: unknown;
  title?: unknown;
  body?: unknown;
  link?: unknown;
};

export function normalizeNotificationRequest(
  body: AdminSendNotificationBody = {},
):
  | {
      ok: true;
      audience: AdminNotificationAudience;
      target: string | null;
      message: { title: string; body: string; link: string | null };
    }
  | { ok: false; message: string } {
  const audience = typeof body.audience === "string" ? body.audience : "";

  if (!(NOTIFICATION_AUDIENCES as readonly string[]).includes(audience)) {
    return { ok: false, message: `audience must be one of: ${NOTIFICATION_AUDIENCES.join(", ")}` };
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  const text = typeof body.body === "string" ? body.body.trim() : "";

  if (!title || !text) {
    return { ok: false, message: "title and body are required." };
  }

  if (title.length > NOTIFICATION_TITLE_MAX || text.length > NOTIFICATION_BODY_MAX) {
    return {
      ok: false,
      message: `title must be at most ${NOTIFICATION_TITLE_MAX} characters and body at most ${NOTIFICATION_BODY_MAX}.`,
    };
  }

  const needsTarget = audience === "user" || audience === "group";
  const target = typeof body.target === "string" && body.target ? body.target : null;

  if (needsTarget && (!target || !isUuid(target))) {
    return { ok: false, message: "target must be a user or group id for this audience." };
  }

  // A link is an in-app path, never a URL. Anything that could navigate off the
  // origin is refused rather than stripped: a notification that quietly drops
  // the destination it was given is worse than one that was not sent.
  const rawLink = typeof body.link === "string" ? body.link.trim() : "";

  if (rawLink && !/^\/[^/\\]/.test(rawLink)) {
    return { ok: false, message: "link must be an in-app path starting with a single '/'." };
  }

  return {
    ok: true,
    audience: audience as AdminNotificationAudience,
    target: needsTarget ? target : null,
    message: { title, body: text, link: rawLink || null },
  };
}

export async function handleAdminSendNotification(
  repository: AdminRepository,
  context: AuthenticatedContext,
  body: AdminSendNotificationBody = {},
): Promise<HandlerResult<Extract<AdminSendNotificationResult, { ok: true }>>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!adminRoleAtLeast(role, ADMIN_ROLE_RANK.admin)) {
    return adminForbidden("Sending notifications requires an admin or owner role.");
  }

  const normalized = normalizeNotificationRequest(body);

  if (!normalized.ok) {
    return adminBadRequest(normalized.message);
  }

  const result = await repository.sendNotification(
    { id: context.user.id, email: context.user.email },
    normalized.audience,
    normalized.target,
    normalized.message,
  );

  if (!result.ok) {
    if (result.error === "TARGET_NOT_FOUND") {
      return adminNotFound("That user or group does not exist.");
    }
    // EMPTY_MESSAGE / INVALID_AUDIENCE / TARGET_REQUIRED are all screened
    // above; the RPC re-checks them, so reaching here means the two disagree.
    return adminBadRequest("The notification was rejected by the server.");
  }

  return { ok: true, status: 200, body: result };
}

/**
 * What the console has sent, newest first.
 *
 * Support-level: knowing what was announced is the first thing anybody needs
 * when a user asks about a message. Recalling one is a write, and sits at admin
 * with the rest of them.
 */
export async function handleAdminListSentNotifications(
  repository: AdminRepository,
  context: AuthenticatedContext,
  query: AdminListQuery = {},
): Promise<HandlerResult<AdminSentNotificationListRecord>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  const { limit, offset } = normalizeAdminListQuery(query);
  return { ok: true, status: 200, body: await repository.listSentNotifications(limit, offset) };
}

export async function handleAdminDeleteNotificationBatch(
  repository: AdminRepository,
  context: AuthenticatedContext,
  batchId: string,
): Promise<HandlerResult<AdminDeleteNotificationResult>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!adminRoleAtLeast(role, ADMIN_ROLE_RANK.admin)) {
    return adminForbidden("Recalling a notification requires an admin or owner role.");
  }

  if (!isUuid(batchId)) {
    return adminNotFound("Notification not found.");
  }

  const result = await repository.deleteNotificationBatch(
    { id: context.user.id, email: context.user.email },
    batchId,
  );

  if (!result) {
    return adminNotFound("Notification not found.");
  }

  return { ok: true, status: 200, body: result };
}

export async function handleAdminReplyFeedback(
  repository: AdminRepository,
  context: AuthenticatedContext,
  feedbackId: string,
  message: unknown,
): Promise<HandlerResult<Extract<AdminReplyFeedbackResult, { ok: true }>>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  if (!isUuid(feedbackId)) {
    return adminNotFound("Feedback not found.");
  }

  const text = typeof message === "string" ? message.trim() : "";

  if (!text) {
    return adminBadRequest("message is required.");
  }

  if (text.length > NOTIFICATION_BODY_MAX) {
    return adminBadRequest(`message must be at most ${NOTIFICATION_BODY_MAX} characters.`);
  }

  const result = await repository.replyFeedback({ id: context.user.id, email: context.user.email }, feedbackId, text);

  if (!result.ok) {
    if (result.error === "NOT_FOUND") {
      return adminNotFound("Feedback not found.");
    }
    if (result.error === "NO_ACCOUNT") {
      return adminConflict("This feedback was sent without signing in, so there is no inbox to reply to.");
    }
    return adminBadRequest("message is required.");
  }

  return { ok: true, status: 200, body: result };
}

/**
 * Master data: the category list, the currency list, and manual exchange rates.
 *
 * Reading is support-level - "which categories exist" is the first thing to
 * check when somebody reports a missing one. Writing is admin, because every
 * write here changes what every user sees in the composer.
 */

const HEX_COLOR_RE = /^#[0-9a-f]{6}$/i;
const CATEGORY_KEY_RE = /^[a-z][a-z0-9_]{0,30}$/;
const CURRENCY_CODE_RE = /^[A-Z]{3}$/;

/** sort_order is a display position, not an id: out-of-range values are clamped. */
function normalizeSortOrder(raw: unknown): number {
  const value = Number(raw);
  return Number.isFinite(value) ? Math.min(Math.max(Math.trunc(value), 0), 9999) : 100;
}

export async function handleAdminGetCatalog(
  repository: AdminRepository,
  context: AuthenticatedContext,
): Promise<HandlerResult<AdminCatalogRecord>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  return { ok: true, status: 200, body: await repository.getCatalog() };
}

export async function handleAdminSaveCategory(
  repository: AdminRepository,
  context: AuthenticatedContext,
  key: string,
  body: { label?: unknown; color?: unknown; sort_order?: unknown; enabled?: unknown } = {},
): Promise<HandlerResult<Extract<AdminSaveCategoryResult, { ok: true }>>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!adminRoleAtLeast(role, ADMIN_ROLE_RANK.admin)) {
    return adminForbidden("This action requires an admin or owner role.");
  }

  const normalizedKey = key.trim().toLowerCase();

  // The key is what expenses.category holds, so it is validated here as well as
  // in the RPC: a bad one would create a category nothing can ever be filed
  // under.
  if (!CATEGORY_KEY_RE.test(normalizedKey)) {
    return adminBadRequest("key must be lower-case letters, digits and underscores, starting with a letter.");
  }

  const label = typeof body.label === "string" ? body.label.trim() : "";
  const color = typeof body.color === "string" ? body.color.trim() : "";

  if (!label) {
    return adminBadRequest("label is required.");
  }

  if (!HEX_COLOR_RE.test(color)) {
    return adminBadRequest("color must be a #rrggbb hex value.");
  }

  const result = await repository.saveCategory(
    { id: context.user.id, email: context.user.email },
    {
      key: normalizedKey,
      label,
      color: color.toLowerCase(),
      sort_order: normalizeSortOrder(body.sort_order),
      enabled: body.enabled !== false,
    },
  );

  if (!result.ok) {
    return adminBadRequest("The category was rejected by the server.");
  }

  return { ok: true, status: 200, body: result };
}

export async function handleAdminSaveCurrency(
  repository: AdminRepository,
  context: AuthenticatedContext,
  code: string,
  body: { label?: unknown; sort_order?: unknown; enabled?: unknown } = {},
): Promise<HandlerResult<Extract<AdminSaveCurrencyResult, { ok: true }>>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!adminRoleAtLeast(role, ADMIN_ROLE_RANK.admin)) {
    return adminForbidden("This action requires an admin or owner role.");
  }

  const normalizedCode = code.trim().toUpperCase();

  if (!CURRENCY_CODE_RE.test(normalizedCode)) {
    return adminBadRequest("code must be a three-letter currency code.");
  }

  const label = typeof body.label === "string" ? body.label.trim() : "";

  if (!label) {
    return adminBadRequest("label is required.");
  }

  const result = await repository.saveCurrency(
    { id: context.user.id, email: context.user.email },
    {
      code: normalizedCode,
      label,
      sort_order: normalizeSortOrder(body.sort_order),
      enabled: body.enabled !== false,
    },
  );

  if (!result.ok) {
    if (result.error === "CURRENCY_IN_USE") {
      return adminConflict("Expenses are still recorded in this currency, so it cannot be switched off.");
    }
    return adminBadRequest("The currency was rejected by the server.");
  }

  return { ok: true, status: 200, body: result };
}

export async function handleAdminSetRateOverride(
  repository: AdminRepository,
  context: AuthenticatedContext,
  body: { base?: unknown; quote?: unknown; rate?: unknown; note?: unknown } = {},
): Promise<HandlerResult<Extract<AdminRateOverrideResult, { ok: true }>>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!adminRoleAtLeast(role, ADMIN_ROLE_RANK.admin)) {
    return adminForbidden("This action requires an admin or owner role.");
  }

  const base = typeof body.base === "string" ? body.base.trim().toUpperCase() : "";
  const quote = typeof body.quote === "string" ? body.quote.trim().toUpperCase() : "";

  if (!CURRENCY_CODE_RE.test(base) || !CURRENCY_CODE_RE.test(quote)) {
    return adminBadRequest("base and quote must be three-letter currency codes.");
  }

  if (base === quote) {
    return adminBadRequest("base and quote must differ.");
  }

  // null clears the override; anything else has to be a usable positive number.
  // A rate of 0 or NaN would not fail loudly - it would quietly value one
  // currency at nothing.
  let rate: number | null = null;

  if (body.rate !== null && body.rate !== undefined && body.rate !== "") {
    const parsed = Number(body.rate);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return adminBadRequest("rate must be a positive number, or null to clear the override.");
    }
    rate = parsed;
  }

  const result = await repository.setRateOverride(
    { id: context.user.id, email: context.user.email },
    { base, quote, rate, note: typeof body.note === "string" ? body.note.trim() || null : null },
  );

  if (!result.ok) {
    return adminBadRequest("The rate override was rejected by the server.");
  }

  return { ok: true, status: 200, body: result };
}

/**
 * Read the receipt-recognition settings for the console.
 *
 * Support-level access is enough: knowing which model is live and whether the
 * feature is on is diagnostic information, and it is the first thing to check
 * when somebody reports "掃描沒反應". Changing it needs admin (below).
 */
export async function handleAdminGetReceiptScanSettings(
  repository: AdminRepository,
  settings: SettingsRepository,
  context: AuthenticatedContext,
  defaultModel: string,
  keys: ReceiptScanKeys,
): Promise<HandlerResult<AdminReceiptScanSettings>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!role) {
    return adminForbidden();
  }

  const saved = await settings.getReceiptScan(defaultModel);
  const models = describeModels(keys);
  return {
    ok: true,
    status: 200,
    body: { ...saved, configured: canRun(models, saved.model), models },
  };
}

/**
 * Change them. Admin or owner, matching the other actions that alter what the
 * product does rather than just reading it — this one can stop a paid feature
 * for every user at once, which is the point of it existing.
 */
export async function handleAdminSetReceiptScanSettings(
  repository: AdminRepository,
  settings: SettingsRepository,
  context: AuthenticatedContext,
  body: { enabled?: unknown; model?: unknown },
  defaultModel: string,
  keys: ReceiptScanKeys,
): Promise<HandlerResult<AdminReceiptScanSettings>> {
  const role = await repository.findAdminRole(context.user.id);

  if (!adminRoleAtLeast(role, ADMIN_ROLE_RANK.admin)) {
    return adminForbidden("This action requires an admin or owner role.");
  }

  const enabled = body?.enabled;
  const model = typeof body?.model === "string" ? body.model.trim() : "";

  // Reject an unknown model rather than storing it: a saved value the server
  // cannot call would turn every subsequent scan into a silent 503, and the
  // console would keep showing the setting as if it had taken effect.
  if (typeof enabled !== "boolean" || !isReceiptScanModel(model)) {
    return {
      ok: false,
      status: 400,
      body: {
        error: {
          code: "INVALID_ADMIN",
          message: `enabled must be a boolean and model one of: ${RECEIPT_SCAN_MODELS.map((entry) => entry.id).join(", ")}`,
          request_id: "req_admin",
        },
      },
    };
  }

  const saved = await settings.setReceiptScan(
    { id: context.user.id, email: context.user.email },
    enabled,
    model,
  );
  const models = describeModels(keys);
  return {
    ok: true,
    status: 200,
    body: { ...saved, configured: canRun(models, saved.model), models },
  };
}
