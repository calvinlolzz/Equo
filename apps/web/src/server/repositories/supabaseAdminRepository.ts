import type { PostgrestClient } from "../db/postgrestClient.js";
import type {
  AdminAuditLogListRecord,
  AdminErrorListRecord,
  AdminExpenseListRecord,
  AdminFeedbackListRecord,
  AdminGroupDetailRecord,
  AdminGroupListRecord,
  AdminGroupStateResult,
  AdminOverviewRecord,
  AdminRepository,
  AdminStorageRecord,
  AdminUserDetailRecord,
  AdminUserDisabledResult,
  AdminUserListRecord,
} from "./adminRepository.js";

/**
 * Admin reads and writes all go through admin_console_* Postgres functions
 * (defined in the baseline migration) rather than table access: the queries are
 * cross-table aggregates PostgREST can't express, the
 * writes have to be audited atomically alongside the change they record, and
 * keeping them in SQL functions makes the service-role-only EXECUTE grant the
 * single enforcement point.
 */
export function createSupabaseAdminRepository(client: PostgrestClient): AdminRepository {
  return {
    async findAdminRole(userId) {
      const role = await client.rpc<string | null>("admin_console_role", { p_user_id: userId });
      return role ?? null;
    },

    getOverview() {
      return client.rpc<AdminOverviewRecord>("admin_console_overview", {});
    },

    getStorage() {
      return client.rpc<AdminStorageRecord>("admin_console_storage", {});
    },

    listUsers(search, limit, offset) {
      return client.rpc<AdminUserListRecord>("admin_console_users", {
        p_search: search,
        p_limit: limit,
        p_offset: offset,
      });
    },

    async getUserDetail(userId) {
      const detail = await client.rpc<AdminUserDetailRecord | null>("admin_console_user_detail", {
        p_user_id: userId,
      });
      return detail ?? null;
    },

    listGroups(search, limit, offset, filter) {
      return client.rpc<AdminGroupListRecord>("admin_console_groups", {
        p_search: search,
        p_limit: limit,
        p_offset: offset,
        p_filter: filter,
      });
    },

    async getGroupDetail(actor, groupId) {
      const detail = await client.rpc<AdminGroupDetailRecord | null>("admin_console_group_detail", {
        p_actor: actor.id,
        p_actor_email: actor.email,
        p_group_id: groupId,
      });
      return detail ?? null;
    },

    async listGroupExpenses(actor, groupId, limit, offset, includeDeleted) {
      const page = await client.rpc<AdminExpenseListRecord | null>("admin_console_group_expenses", {
        p_actor: actor.id,
        p_actor_email: actor.email,
        p_group_id: groupId,
        p_limit: limit,
        p_offset: offset,
        p_include_deleted: includeDeleted,
      });
      return page ?? null;
    },

    async setUserDisabled(actor, userId, disabled) {
      const result = await client.rpc<AdminUserDisabledResult | null>("admin_console_set_user_disabled", {
        p_actor: actor.id,
        p_actor_email: actor.email,
        p_user_id: userId,
        p_disabled: disabled,
      });
      return result ?? null;
    },

    async setGroupArchived(actor, groupId, archived) {
      const result = await client.rpc<AdminGroupStateResult | null>("admin_console_set_group_archived", {
        p_actor: actor.id,
        p_actor_email: actor.email,
        p_group_id: groupId,
        p_archived: archived,
      });
      return result ?? null;
    },

    async setGroupDeleted(actor, groupId, deleted) {
      const result = await client.rpc<AdminGroupStateResult | null>("admin_console_set_group_deleted", {
        p_actor: actor.id,
        p_actor_email: actor.email,
        p_group_id: groupId,
        p_deleted: deleted,
      });
      return result ?? null;
    },

    listAuditLogs(search, action, limit, offset) {
      return client.rpc<AdminAuditLogListRecord>("admin_console_audit_logs", {
        p_search: search,
        p_action: action,
        p_limit: limit,
        p_offset: offset,
      });
    },

    listFeedback(limit, offset, status) {
      return client.rpc<AdminFeedbackListRecord>("admin_console_feedback", {
        p_limit: limit,
        p_offset: offset,
        p_status: status,
      });
    },

    async setFeedbackStatus(actor, feedbackId, status) {
      const result = await client.rpc<{ id: string; status: string } | null>(
        "admin_console_set_feedback_status",
        {
          p_actor: actor.id,
          p_actor_email: actor.email,
          p_feedback_id: feedbackId,
          p_status: status,
        },
      );
      return result ?? null;
    },

    listErrors(search, limit, offset) {
      return client.rpc<AdminErrorListRecord>("admin_console_errors", {
        p_search: search,
        p_limit: limit,
        p_offset: offset,
      });
    },
  };
}
