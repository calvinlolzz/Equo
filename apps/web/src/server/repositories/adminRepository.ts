export type AdminOverviewRecord = {
  user_count: number;
  active_users_7d: number;
  new_users_7d: number;
  group_count: number;
  active_groups_7d: number;
  expense_count: number;
  expenses_7d: number;
};

/** One day of the growth series. Days with no activity come back as zeros, never as gaps. */
export type AdminTrendPointRecord = {
  /** YYYY-MM-DD, bucketed in Asia/Taipei. */
  day: string;
  new_users: number;
  /** Users whose last-seen timestamp falls on this day. */
  active_users: number;
  new_groups: number;
  expenses: number;
};

export type AdminTrendsRecord = {
  /** The window actually returned, after the server clamped the request. */
  days: number;
  points: AdminTrendPointRecord[];
};

export type AdminHealthRecord = {
  /** null until the backup workflow has recorded its first success. */
  backup: { last_success_at: string; detail: Record<string, unknown> } | null;
  rate_limit: {
    /** Buckets counted within the last hour - live traffic, not all time. */
    active_buckets: number;
    blocked_24h: number;
  };
  errors: {
    last_24h: number;
    last_7d: number;
    latest_at: string | null;
  };
  feedback: {
    /** app_feedback rows still in the 'new' status. */
    open: number;
  };
};

export type AdminStorageRecord = {
  /** Objects in the equo-images bucket. */
  object_count: number;
  total_bytes: number;
  /** Bucket objects no image-URL column references - a leaked delete. */
  orphan_count: number;
  orphan_bytes: number;
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

export type AdminGroupDetailGroupRecord = AdminGroupSummaryRecord & {
  cover_image_url: string | null;
  /** Soft-deleted expenses, i.e. what the include-deleted listing adds. */
  deleted_expense_count: number;
};

export type AdminGroupMemberRecord = {
  /** group_members.id - what expenses reference, not the user id. */
  id: string;
  /** null for a member who was added by name and never claimed by a login. */
  user_id: string | null;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  role: string;
  status: string;
  joined_at: string;
  expense_count: number;
  /** Balance in the group's currency; positive means the group owes them. */
  balance_minor: number;
};

export type AdminGroupInviteRecord = {
  id: string;
  max_uses: number;
  use_count: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  created_by_name: string | null;
};

export type AdminGroupDetailRecord = {
  group: AdminGroupDetailGroupRecord;
  members: AdminGroupMemberRecord[];
  invites: AdminGroupInviteRecord[];
};

export type AdminExpensePayerRecord = {
  member_id: string;
  display_name: string | null;
  amount_minor: number;
  currency: string;
};

export type AdminExpenseShareRecord = {
  member_id: string;
  display_name: string | null;
  share_type: string;
  share_value: number | null;
  amount_minor: number;
};

export type AdminExpenseRecord = {
  id: string;
  title: string;
  kind: string;
  category: string;
  amount_minor: number | null;
  currency: string;
  expense_date: string;
  note: string | null;
  /** The photo attached to the expense, if any. */
  image_url: string | null;
  receipt_image_url: string | null;
  created_at: string;
  deleted_at: string | null;
  version: number;
  created_by_name: string | null;
  /** Only set for kind = 'transfer'. */
  transfer_to_name: string | null;
  payers: AdminExpensePayerRecord[];
  shares: AdminExpenseShareRecord[];
};

export type AdminExpenseListRecord = {
  total: number;
  expenses: AdminExpenseRecord[];
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
  /** The group this occurrence belongs to (see error_log_fingerprint). */
  fingerprint: string;
};

export type AdminErrorListRecord = {
  total: number;
  errors: AdminErrorRecord[];
};

/** app_error_group_status.status vocabulary (from its check constraint). */
export type AdminErrorGroupStatus = "open" | "resolved";

/** One distinct error, collapsed across every occurrence of it. */
export type AdminErrorGroupRecord = {
  fingerprint: string;
  source: string;
  /** The most recent wording seen for this group. */
  sample_message: string;
  last_page: string | null;
  occurrences: number;
  /** Distinct signed-in reporters; signed-out reports add nothing to it. */
  user_count: number;
  first_seen: string;
  last_seen: string;
  status: AdminErrorGroupStatus;
  status_updated_at: string | null;
  status_updated_by: string | null;
};

export type AdminErrorGroupListRecord = {
  total: number;
  groups: AdminErrorGroupRecord[];
};

export type AdminRoleName = "owner" | "admin" | "support";

export type AdminAccountRecord = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
  created_at: string;
};

/** set/remove return a discriminated result so the handler maps errors to status. */
export type AdminSetRoleResult =
  | { ok: true; admin: AdminAccountRecord }
  | { ok: false; error: "INVALID_ROLE" | "USER_NOT_FOUND" | "LAST_OWNER" };

export type AdminRemoveResult =
  | { ok: true; user_id: string }
  | { ok: false; error: "NOT_AN_ADMIN" | "LAST_OWNER" };

export type AdminRepository = {
  /** Returns the caller's app_admins.role, or null when they are not an admin. */
  findAdminRole(userId: string): Promise<string | null>;
  /** The full admin roster (owner-only feature). Admins are few, so unpaginated. */
  listAdmins(): Promise<AdminAccountRecord[]>;
  /** Grant or change an admin's role, keyed by the target's email. */
  setAdminRole(actor: AdminActor, targetEmail: string, role: string): Promise<AdminSetRoleResult>;
  /** Revoke an admin, keyed by user id. */
  removeAdmin(actor: AdminActor, userId: string): Promise<AdminRemoveResult>;
  getOverview(): Promise<AdminOverviewRecord>;
  /** Daily counts for the last `days` days (clamped server-side to 1..180). */
  getTrends(days: number): Promise<AdminTrendsRecord>;
  /** Backup freshness, rate-limiter activity, error volume - the ops card. */
  getHealth(): Promise<AdminHealthRecord>;
  getStorage(): Promise<AdminStorageRecord>;
  listUsers(search: string, limit: number, offset: number): Promise<AdminUserListRecord>;
  getUserDetail(userId: string): Promise<AdminUserDetailRecord | null>;
  listGroups(search: string, limit: number, offset: number, filter: AdminGroupFilter): Promise<AdminGroupListRecord>;
  /**
   * Group roster + aggregates. Records a 'group.view' audit row for the actor,
   * hence the actor param on a read. Returns null when the group does not
   * exist; soft-deleted groups are still returned so the console can inspect
   * one before restoring it.
   */
  getGroupDetail(actor: AdminActor, groupId: string): Promise<AdminGroupDetailRecord | null>;
  /**
   * Expense-level drill-down; includeDeleted adds soft-deleted expenses. Audits
   * the actor the same way getGroupDetail does - this is the endpoint that
   * actually exposes the financial data, and it is callable on its own.
   * Returns null when the group does not exist.
   */
  listGroupExpenses(
    actor: AdminActor,
    groupId: string,
    limit: number,
    offset: number,
    includeDeleted: boolean,
  ): Promise<AdminExpenseListRecord | null>;
  /** Disable (block login) or re-enable a user. Returns null when the user does not exist. */
  setUserDisabled(actor: AdminActor, userId: string, disabled: boolean): Promise<AdminUserDisabledResult | null>;
  /** Archive/unarchive a non-deleted group. Returns null when the group does not exist or is deleted. */
  setGroupArchived(actor: AdminActor, groupId: string, archived: boolean): Promise<AdminGroupStateResult | null>;
  /** Soft-delete or restore a group. Returns null when the group does not exist. */
  setGroupDeleted(actor: AdminActor, groupId: string, deleted: boolean): Promise<AdminGroupStateResult | null>;
  /** search matches admin email or the target name/email; action "" = any. */
  listAuditLogs(search: string, action: string, limit: number, offset: number): Promise<AdminAuditLogListRecord>;
  /** status "all" lists everything; a specific status filters to it. */
  listFeedback(limit: number, offset: number, status: string): Promise<AdminFeedbackListRecord>;
  /** Returns null when the feedback row does not exist. */
  setFeedbackStatus(
    actor: AdminActor,
    feedbackId: string,
    status: AdminFeedbackStatus,
  ): Promise<{ id: string; status: string } | null>;
  /**
   * Distinct errors rather than occurrences. search filters the underlying
   * rows before grouping (so the counts describe the filtered set); status
   * "all" lists everything.
   */
  listErrorGroups(
    search: string,
    status: string,
    limit: number,
    offset: number,
  ): Promise<AdminErrorGroupListRecord>;
  /**
   * The flat occurrence list. search matches message, context, page, or the
   * reporter's email; a non-empty fingerprint scopes it to one group.
   */
  listErrors(search: string, fingerprint: string, limit: number, offset: number): Promise<AdminErrorListRecord>;
  /** Mark a group handled (or reopen it). Returns null for a fingerprint no log row produces. */
  setErrorGroupStatus(
    actor: AdminActor,
    fingerprint: string,
    status: AdminErrorGroupStatus,
  ): Promise<{ fingerprint: string; status: string } | null>;
};
