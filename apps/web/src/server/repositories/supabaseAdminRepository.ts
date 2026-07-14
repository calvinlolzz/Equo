import type { PostgrestClient } from "../db/postgrestClient.js";
import type {
  AdminAuditLogListRecord,
  AdminErrorListRecord,
  AdminFeedbackListRecord,
  AdminGroupListRecord,
  AdminGroupStateResult,
  AdminOverviewRecord,
  AdminRepository,
  AdminUserDetailRecord,
  AdminUserDisabledResult,
  AdminUserListRecord,
} from "./adminRepository.js";

/**
 * Admin reads and writes all go through admin_console_* Postgres functions (see
 * supabase/migrations/20260711120000_admin_console_v2.sql) rather than table
 * access: the queries are cross-table aggregates PostgREST can't express, the
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

    listAuditLogs(limit, offset) {
      return client.rpc<AdminAuditLogListRecord>("admin_console_audit_logs", {
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

    listErrors(limit, offset) {
      return client.rpc<AdminErrorListRecord>("admin_console_errors", {
        p_limit: limit,
        p_offset: offset,
      });
    },
  };
}
