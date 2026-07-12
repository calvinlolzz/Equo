export type AdminOverviewRecord = {
  user_count: number;
  active_users_7d: number;
  new_users_7d: number;
  group_count: number;
  active_groups_7d: number;
  expense_count: number;
  expenses_7d: number;
};

export type AdminUserSummaryRecord = {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
  /** users.updated_at - refreshed on every login upsert, so it doubles as "last seen". */
  last_seen_at: string;
  /** users.deleted_at - non-null means the account is disabled and cannot log in. */
  disabled_at: string | null;
  group_count: number;
  expense_count: number;
};

export type AdminUserListRecord = {
  total: number;
  users: AdminUserSummaryRecord[];
};

export type AdminUserGroupRecord = {
  id: string;
  name: string;
  currency: string;
  role: string;
  member_status: string;
  joined_at: string;
  archived_at: string | null;
  member_count: number;
  expense_count: number;
  spend_total_minor: number;
  last_expense_at: string | null;
};

export type AdminUserDetailRecord = {
  user: AdminUserSummaryRecord;
  groups: AdminUserGroupRecord[];
};

export type AdminGroupSummaryRecord = {
  id: string;
  name: string;
  currency: string;
  created_at: string;
  archived_at: string | null;
  deleted_at: string | null;
  member_count: number;
  expense_count: number;
  spend_total_minor: number;
  last_expense_at: string | null;
  owner_display_name: string | null;
};

export type AdminGroupListRecord = {
  total: number;
  groups: AdminGroupSummaryRecord[];
};

/** 'all' = non-deleted, 'empty' = non-deleted with zero live expenses, 'deleted' = soft-deleted only. */
export type AdminGroupFilter = "all" | "archived" | "empty" | "deleted";

/** Who performed an admin write - recorded in admin_audit_logs by the RPC. */
export type AdminActor = {
  id: string;
  email: string;
};

export type AdminUserDisabledResult = {
  id: string;
  disabled_at: string | null;
};

export type AdminGroupStateResult = {
  id: string;
  archived_at: string | null;
  deleted_at: string | null;
};

export type AdminAuditLogRecord = {
  id: string;
  admin_email: string | null;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AdminAuditLogListRecord = {
  total: number;
  logs: AdminAuditLogRecord[];
};

export type AdminFeedbackRecord = {
  id: string;
  user_email: string | null;
  type: string;
  message: string;
  contact: string | null;
  page: string | null;
  status: string;
  created_at: string;
};

export type AdminFeedbackListRecord = {
  total: number;
  feedback: AdminFeedbackRecord[];
};

/** app_feedback.status vocabulary (from its check constraint). */
export type AdminFeedbackStatus = "new" | "reviewing" | "done";

export type AdminErrorRecord = {
  id: string;
  user_email: string | null;
  source: string;
  message: string;
  context: string | null;
  page: string | null;
  created_at: string;
};

export type AdminErrorListRecord = {
  total: number;
  errors: AdminErrorRecord[];
};

export type AdminRepository = {
  /** Returns the caller's app_admins.role, or null when they are not an admin. */
  findAdminRole(userId: string): Promise<string | null>;
  getOverview(): Promise<AdminOverviewRecord>;
  listUsers(search: string, limit: number, offset: number): Promise<AdminUserListRecord>;
  getUserDetail(userId: string): Promise<AdminUserDetailRecord | null>;
  listGroups(search: string, limit: number, offset: number, filter: AdminGroupFilter): Promise<AdminGroupListRecord>;
  /** Disable (block login) or re-enable a user. Returns null when the user does not exist. */
  setUserDisabled(actor: AdminActor, userId: string, disabled: boolean): Promise<AdminUserDisabledResult | null>;
  /** Archive/unarchive a non-deleted group. Returns null when the group does not exist or is deleted. */
  setGroupArchived(actor: AdminActor, groupId: string, archived: boolean): Promise<AdminGroupStateResult | null>;
  /** Soft-delete or restore a group. Returns null when the group does not exist. */
  setGroupDeleted(actor: AdminActor, groupId: string, deleted: boolean): Promise<AdminGroupStateResult | null>;
  listAuditLogs(limit: number, offset: number): Promise<AdminAuditLogListRecord>;
  /** status "all" lists everything; a specific status filters to it. */
  listFeedback(limit: number, offset: number, status: string): Promise<AdminFeedbackListRecord>;
  /** Returns null when the feedback row does not exist. */
  setFeedbackStatus(
    actor: AdminActor,
    feedbackId: string,
    status: AdminFeedbackStatus,
  ): Promise<{ id: string; status: string } | null>;
  listErrors(limit: number, offset: number): Promise<AdminErrorListRecord>;
};
