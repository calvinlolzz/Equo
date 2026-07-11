import type {
  AdminAuditLogListRecord,
  AdminGroupListRecord,
  AdminGroupStateResult,
  AdminOverviewRecord,
  AdminRepository,
  AdminUserDetailRecord,
  AdminUserDisabledResult,
  AdminUserListRecord,
} from "./adminRepository.js";
import type { SupabaseQueryClient } from "./supabaseGroupRepository.js";

/**
 * Admin reads all go through admin_console_* Postgres functions (see
 * supabase/migrations/20260711120000_admin_console_v2.sql) rather than table
 * selects: the queries are cross-table aggregates that PostgREST can't
 * express, and keeping them in SQL functions means the service-role-only
 * EXECUTE grant is the single enforcement point. The SQL strings below are
 * matched by name in supabaseQueryClient.ts and forwarded as RPC calls.
 */
export function createSupabaseAdminRepository(client: SupabaseQueryClient): AdminRepository {
  return {
    async findAdminRole(userId) {
      const role = await client.maybeOne<string | null>(
        `select public.admin_console_role($1)`,
        [userId],
      );
      return role ?? null;
    },

    async getOverview() {
      return client.one<AdminOverviewRecord>(`select public.admin_console_overview()`, []);
    },

    async listUsers(search, limit, offset) {
      return client.one<AdminUserListRecord>(
        `select public.admin_console_users($1, $2, $3)`,
        [search, limit, offset],
      );
    },

    async getUserDetail(userId) {
      return client.maybeOne<AdminUserDetailRecord>(
        `select public.admin_console_user_detail($1)`,
        [userId],
      );
    },

    async listGroups(search, limit, offset, filter) {
      return client.one<AdminGroupListRecord>(
        `select public.admin_console_groups($1, $2, $3, $4)`,
        [search, limit, offset, filter],
      );
    },

    async setUserDisabled(actor, userId, disabled) {
      return client.maybeOne<AdminUserDisabledResult>(
        `select public.admin_console_set_user_disabled($1, $2, $3, $4)`,
        [actor.id, actor.email, userId, disabled],
      );
    },

    async setGroupArchived(actor, groupId, archived) {
      return client.maybeOne<AdminGroupStateResult>(
        `select public.admin_console_set_group_archived($1, $2, $3, $4)`,
        [actor.id, actor.email, groupId, archived],
      );
    },

    async setGroupDeleted(actor, groupId, deleted) {
      return client.maybeOne<AdminGroupStateResult>(
        `select public.admin_console_set_group_deleted($1, $2, $3, $4)`,
        [actor.id, actor.email, groupId, deleted],
      );
    },

    async listAuditLogs(limit, offset) {
      return client.one<AdminAuditLogListRecord>(
        `select public.admin_console_audit_logs($1, $2)`,
        [limit, offset],
      );
    },
  };
}
