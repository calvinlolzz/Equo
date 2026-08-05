import type { PostgrestClient } from "../db/postgrestClient.js";
import type {
  AdminAccountRecord,
  AdminAuditLogListRecord,
  AdminCatalogRecord,
  AdminDeleteUserResult,
  AdminRateOverrideResult,
  AdminSaveCategoryResult,
  AdminSaveCurrencyResult,
  AdminExpenseWriteResult,
  AdminMergeUsersResult,
  AdminRemoveResult,
  AdminReplyFeedbackResult,
  AdminSendNotificationResult,
  AdminSetRoleResult,
  AdminTransferOwnerResult,
  AdminUserExportRecord,
  AdminErrorGroupListRecord,
  AdminErrorListRecord,
  AdminExpenseListRecord,
  AdminFeedbackListRecord,
  AdminGroupDetailRecord,
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

    listAdmins() {
      return client.rpc<AdminAccountRecord[]>("admin_console_admins", {});
    },

    setAdminRole(actor, targetEmail, role) {
      return client.rpc<AdminSetRoleResult>("admin_console_set_admin_role", {
        p_actor: actor.id,
        p_actor_email: actor.email,
        p_target_email: targetEmail,
        p_role: role,
      });
    },

    removeAdmin(actor, userId) {
      return client.rpc<AdminRemoveResult>("admin_console_remove_admin", {
        p_actor: actor.id,
        p_actor_email: actor.email,
        p_user_id: userId,
      });
    },

    getOverview() {
      return client.rpc<AdminOverviewRecord>("admin_console_overview", {});
    },

    getTrends(days) {
      return client.rpc<AdminTrendsRecord>("admin_console_trends", { p_days: days });
    },

    getHealth() {
      return client.rpc<AdminHealthRecord>("admin_console_health", {});
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

    listErrorGroups(search, status, limit, offset) {
      return client.rpc<AdminErrorGroupListRecord>("admin_console_error_groups", {
        p_search: search,
        p_status: status,
        p_limit: limit,
        p_offset: offset,
      });
    },

    listErrors(search, fingerprint, limit, offset) {
      return client.rpc<AdminErrorListRecord>("admin_console_errors", {
        p_search: search,
        p_fingerprint: fingerprint,
        p_limit: limit,
        p_offset: offset,
      });
    },

    async setErrorGroupStatus(actor, fingerprint, status) {
      const result = await client.rpc<{ fingerprint: string; status: string } | null>(
        "admin_console_set_error_group_status",
        {
          p_actor: actor.id,
          p_actor_email: actor.email,
          p_fingerprint: fingerprint,
          p_status: status,
        },
      );
      return result ?? null;
    },

    async setExpenseDeleted(actor, groupId, expenseId, deleted) {
      const result = await client.rpc<AdminExpenseWriteResult | null>("admin_console_set_expense_deleted", {
        p_actor: actor.id,
        p_actor_email: actor.email,
        p_group_id: groupId,
        p_expense_id: expenseId,
        p_deleted: deleted,
      });
      return result ?? null;
    },

    async updateExpenseMeta(actor, groupId, expenseId, patch) {
      // Every field is nullable in the RPC and null means "leave alone", so an
      // absent key has to arrive as an explicit null rather than be dropped -
      // PostgREST would otherwise report a missing argument.
      const result = await client.rpc<AdminExpenseWriteResult | null>("admin_console_update_expense_meta", {
        p_actor: actor.id,
        p_actor_email: actor.email,
        p_group_id: groupId,
        p_expense_id: expenseId,
        p_title: patch.title ?? null,
        p_category: patch.category ?? null,
        p_expense_date: patch.expense_date ?? null,
        p_note: patch.note ?? null,
      });
      return result ?? null;
    },

    transferGroupOwner(actor, groupId, memberId) {
      return client.rpc<AdminTransferOwnerResult>("admin_console_transfer_group_owner", {
        p_actor: actor.id,
        p_actor_email: actor.email,
        p_group_id: groupId,
        p_member_id: memberId,
      });
    },

    mergeUsers(actor, sourceUserId, targetUserId) {
      return client.rpc<AdminMergeUsersResult>("admin_console_merge_users", {
        p_actor: actor.id,
        p_actor_email: actor.email,
        p_source_user_id: sourceUserId,
        p_target_user_id: targetUserId,
      });
    },

    async exportUser(actor, userId) {
      const document = await client.rpc<AdminUserExportRecord | null>("admin_console_export_user", {
        p_actor: actor.id,
        p_actor_email: actor.email,
        p_user_id: userId,
      });
      return document ?? null;
    },

    async deleteUser(actor, userId) {
      const result = await client.rpc<AdminDeleteUserResult | null>("admin_console_delete_user", {
        p_actor: actor.id,
        p_actor_email: actor.email,
        p_user_id: userId,
      });
      return result ?? null;
    },

    sendNotification(actor, audience, target, message) {
      return client.rpc<AdminSendNotificationResult>("admin_console_send_notification", {
        p_actor: actor.id,
        p_actor_email: actor.email,
        p_audience: audience,
        p_target: target,
        p_title: message.title,
        p_body: message.body,
        p_link: message.link,
      });
    },

    replyFeedback(actor, feedbackId, message) {
      return client.rpc<AdminReplyFeedbackResult>("admin_console_reply_feedback", {
        p_actor: actor.id,
        p_actor_email: actor.email,
        p_feedback_id: feedbackId,
        p_message: message,
      });
    },

    getCatalog() {
      return client.rpc<AdminCatalogRecord>("admin_console_catalog", {});
    },

    saveCategory(actor, category) {
      return client.rpc<AdminSaveCategoryResult>("admin_console_save_category", {
        p_actor: actor.id,
        p_actor_email: actor.email,
        p_key: category.key,
        p_label: category.label,
        p_color: category.color,
        p_sort_order: category.sort_order,
        p_enabled: category.enabled,
      });
    },

    saveCurrency(actor, currency) {
      return client.rpc<AdminSaveCurrencyResult>("admin_console_save_currency", {
        p_actor: actor.id,
        p_actor_email: actor.email,
        p_code: currency.code,
        p_label: currency.label,
        p_sort_order: currency.sort_order,
        p_enabled: currency.enabled,
      });
    },

    setRateOverride(actor, pair) {
      return client.rpc<AdminRateOverrideResult>("admin_console_set_rate_override", {
        p_actor: actor.id,
        p_actor_email: actor.email,
        p_base: pair.base,
        p_quote: pair.quote,
        // null is meaningful here: it is how a pair goes back to following the
        // upstream feed.
        p_rate: pair.rate,
        p_note: pair.note,
      });
    },
  };
}
