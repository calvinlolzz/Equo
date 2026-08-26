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
  /**
   * Every ops_heartbeats row, db_backup included. Which jobs are EXPECTED (and
   * how stale is too stale) is the console's call, not the database's — a job
   * that has never run has no row here at all, and that absence is exactly the
   * failure worth showing.
   *
   * Optional so a console deployed ahead of the migration renders without it.
   */
  jobs?: Array<{ kind: string; last_success_at: string; detail: Record<string, unknown> }>;
  /**
   * Push delivery, whose failure mode is silence: nothing else in the product
   * reports "the notification did not arrive". Optional so a console deployed
   * ahead of the migration renders without it.
   */
  push?: {
    subscriptions: number;
    subscribed_users: number;
    /** owner+admin count, and how many of them could actually be reached. */
    admins: number;
    subscribed_admins: number;
    sent_7d: number;
    failed_7d: number;
    pruned_7d: number;
    last_delivery_at: string | null;
  };
  /**
   * 循環支出 rules that switched themselves off. `broken` counts rules with a
   * stored error; a user pausing their own rule is not a fault and is not
   * counted here. Absent on an API deployed before this shipped.
   */
  recurring?: {
    rules: number;
    active: number;
    broken: number;
    /** Newest failure first, capped at 10. */
    broken_rules: Array<{
      id: string;
      title: string;
      group_id: string;
      group_name: string | null;
      last_error: string | null;
      last_run_at: string | null;
      active: boolean;
    }>;
  };
  /**
   * Receipt recognition's live configuration. `configured` is a property of the
   * deployment (is ANTHROPIC_API_KEY set) and `enabled` is the console's own
   * switch — kept apart because the fixes are completely different, and both
   * fail silently in the app: either way it just stops auto-filling.
   *
   * Optional so a console deployed ahead of this change still renders.
   */
  receipt_scan?: { configured: boolean; enabled: boolean; model: string };
  /**
   * Free-plan usage against the two hard limits. The LIMITS are not here — they
   * belong to the billing plan, not the database (see FREE_PLAN_LIMITS).
   * Absent on an API deployed before this shipped.
   */
  quota?: {
    /** Sum over pg_database, matching the number Supabase enforces. */
    database_bytes: number;
    storage_bytes: number;
  };
  rate_limit: {
    /** Buckets counted within the last hour - live traffic, not all time. */
    active_buckets: number;
    blocked_24h: number;
  };
  errors: {
    last_24h: number;
    last_7d: number;
    latest_at: string | null;
    /**
     * Distinct errors from the last 30 days still marked open. The unit an
     * inbox needs - "312 occurrences" says nothing about whether anyone has
     * looked at them. Optional so a console deployed ahead of the migration
     * that adds it renders without the tile rather than crashing.
     */
    open_groups?: number;
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

/**
 * Receipt recognition's usage ledger, rolled up for the console.
 *
 * Spend is carried in millionths of a USD everywhere below. A single Haiku scan
 * costs about US$0.0005, which rounds to zero in cents; the client divides once
 * at the point of display.
 */
export type AdminScanUsageRecord = {
  /** The window actually returned, after the server clamped the request. */
  days: number;
  summary: {
    scans: number;
    recognised: number;
    /** The model answered and said it could not read the photo. A camera problem, not an outage. */
    unrecognised: number;
    failed: number;
    /** Distinct users who scanned in the window. */
    users: number;
    cost_micros: number;
    /** Median and p95 upstream latency; null when nothing was scanned. */
    p50_ms: number | null;
    p95_ms: number | null;
    latest_at: string | null;
  };
  by_day: Array<{ day: string; scans: number; failed: number; cost_micros: number }>;
  by_model: Array<{
    model: string;
    provider: string;
    scans: number;
    failed: number;
    cost_micros: number;
    p50_ms: number | null;
  }>;
  /** The ten heaviest users — enough to spot one runaway client. */
  top_users: Array<{ user_id: string | null; email: string; scans: number; failed: number; cost_micros: number }>;
  recent_failures: Array<{ created_at: string; model: string; failure_reason: string; email: string }>;
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

/** What the expense writes return: the row as it now stands, not the whole detail. */
export type AdminExpenseWriteResult = {
  id: string;
  title: string;
  category: string;
  expense_date: string;
  note: string | null;
  deleted_at: string | null;
  version: number;
};

/**
 * The descriptive fields an admin may correct. Money is absent on purpose -
 * amounts, payers and shares only make sense changed together, and the RPC
 * refuses to pretend otherwise.
 *
 * undefined means "leave alone" for every field. note additionally accepts ""
 * to clear it, which is why the RPC takes null and "" as different values.
 */
export type AdminExpenseMetaPatch = {
  title?: string;
  category?: string;
  expense_date?: string;
  note?: string;
};

export type AdminTransferOwnerResult =
  | {
      ok: true;
      group_id: string;
      owner_member_id: string;
      owner_user_id: string;
      owner_display_name: string | null;
    }
  | { ok: false; error: "GROUP_NOT_FOUND" | "MEMBER_NOT_FOUND" | "MEMBER_NOT_CLAIMED" };

/** The groups both accounts are in, which is what makes a merge impossible. */
export type AdminMergeConflictGroup = {
  group_id: string;
  name: string;
};

export type AdminMergeUsersResult =
  | {
      ok: true;
      source_user_id: string;
      source_email: string | null;
      target_user_id: string;
      target_email: string | null;
      memberships_moved: number;
      groups_reowned: number;
    }
  | {
      ok: false;
      error: "SAME_USER" | "USER_NOT_FOUND" | "SOURCE_IS_ADMIN" | "GROUP_OVERLAP";
      groups?: AdminMergeConflictGroup[];
    };

/**
 * The subject-access document, passed through as-is. Deliberately not typed
 * field by field: it is a file handed to a person, and pinning its shape here
 * would mean editing three layers to add a section to it.
 */
export type AdminUserExportRecord = Record<string, unknown>;

/** Who a console message goes to. See admin_console_send_notification. */
export type AdminNotificationAudience = "user" | "group" | "active" | "all";

export type AdminSendNotificationResult =
  | { ok: true; recipients: number }
  | { ok: false; error: "EMPTY_MESSAGE" | "INVALID_AUDIENCE" | "TARGET_REQUIRED" | "TARGET_NOT_FOUND" };

/** One send, collapsed back from its per-recipient rows. */
export type AdminSentNotificationRecord = {
  batch_id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  /** null for rows that predate the column. */
  audience: string | null;
  created_by_email: string | null;
  created_at: string;
  recipients: number;
  /** How many of those have opened it - the number that says whether it landed. */
  read_count: number;
};

export type AdminSentNotificationListRecord = {
  total: number;
  batches: AdminSentNotificationRecord[];
};

export type AdminDeleteNotificationResult = {
  ok: true;
  deleted: number;
  /** People who had already opened it. A recall does not un-read those. */
  already_read: number;
  title: string;
};

export type AdminReplyFeedbackResult =
  | { ok: true; feedback_id: string; notification_id: string; status: string }
  /** NO_ACCOUNT: the feedback was submitted signed-out, so there is nobody to reply to. */
  | { ok: false; error: "EMPTY_MESSAGE" | "NOT_FOUND" | "NO_ACCOUNT" };

export type AdminDeleteUserResult =
  | { ok: true; groups_reassigned: number; groups_deleted: number; memberships_anonymized: number }
  /** delete_my_account's own refusal, currently only 'last_admin_owner'. */
  | { ok: false; reason: string };

/**
 * Master data as the console sees it: disabled rows included, plus how many
 * live expenses each row is carrying - the number that decides whether a
 * change is harmless.
 */
export type AdminCatalogCategoryRecord = {
  key: string;
  label: string;
  color: string;
  sort_order: number;
  enabled: boolean;
  updated_at: string;
  updated_by_email: string | null;
  expense_count: number;
};

export type AdminCatalogCurrencyRecord = {
  code: string;
  label: string;
  sort_order: number;
  enabled: boolean;
  updated_at: string;
  updated_by_email: string | null;
  expense_count: number;
};

export type AdminRateOverrideRecord = {
  base: string;
  quote: string;
  /** Units of quote per 1 base. Arrives as a string from numeric(18,8). */
  rate: string | number;
  note: string | null;
  updated_at: string;
  updated_by_email: string | null;
};

export type AdminCatalogRecord = {
  categories: AdminCatalogCategoryRecord[];
  currencies: AdminCatalogCurrencyRecord[];
  rate_overrides: AdminRateOverrideRecord[];
};

export type AdminSaveCategoryResult =
  | { ok: true; category: { key: string; label: string; color: string; sort_order: number; enabled: boolean } }
  | { ok: false; error: "INVALID_KEY" | "INVALID_LABEL" | "INVALID_COLOR" };

export type AdminSaveCurrencyResult =
  | { ok: true; currency: { code: string; label: string; sort_order: number; enabled: boolean } }
  /** CURRENCY_IN_USE: live expenses are still denominated in it. */
  | { ok: false; error: "INVALID_CODE" | "INVALID_LABEL" | "CURRENCY_IN_USE" };

export type AdminRateOverrideResult =
  | { ok: true; cleared: boolean; base: string; quote: string; rate?: number }
  | { ok: false; error: "INVALID_CODE" | "SAME_CURRENCY" | "INVALID_RATE" };

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
  /** Receipt-scan volume, outcomes, latency and spend for the last `days` days. */
  getReceiptScanUsage(days: number): Promise<AdminScanUsageRecord>;
  listUsers(search: string, limit: number, offset: number): Promise<AdminUserListRecord>;
  getUserDetail(userId: string): Promise<AdminUserDetailRecord | null>;
  /**
   * Record that an admin opened a read-only view as this user.
   *
   * Only the START is recorded. The end can be a button, a closed tab, or the
   * token simply lapsing, and the first two are unobservable - a log that
   * captures one of three endings is worse than one that captures none, because
   * it reads as complete. The real boundary is the token's expiry, which is
   * written into the entry.
   */
  logViewAs(
    actor: { id: string; email: string },
    targetUserId: string,
    expiresAt: string,
  ): Promise<{ target_user_id: string; target_email: string }>;
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
  /**
   * Soft-delete or restore one expense. Scoped by group as well as id so a
   * mistyped expense id cannot reach into another group's ledger. Returns null
   * when the pair names no row.
   */
  setExpenseDeleted(
    actor: AdminActor,
    groupId: string,
    expenseId: string,
    deleted: boolean,
  ): Promise<AdminExpenseWriteResult | null>;
  /** Correct an expense's descriptive fields. Returns null when the pair names no row. */
  updateExpenseMeta(
    actor: AdminActor,
    groupId: string,
    expenseId: string,
    patch: AdminExpenseMetaPatch,
  ): Promise<AdminExpenseWriteResult | null>;
  /** Hand a group's ownership to one of its members (by group_members.id). */
  transferGroupOwner(actor: AdminActor, groupId: string, memberId: string): Promise<AdminTransferOwnerResult>;
  /** Move source's memberships onto target and disable source. */
  mergeUsers(actor: AdminActor, sourceUserId: string, targetUserId: string): Promise<AdminMergeUsersResult>;
  /** The subject-access document for one user. Returns null when the user does not exist. */
  exportUser(actor: AdminActor, userId: string): Promise<AdminUserExportRecord | null>;
  /** Run account deletion on someone's behalf. Returns null when the user does not exist. */
  deleteUser(actor: AdminActor, userId: string): Promise<AdminDeleteUserResult | null>;
  /** Send one in-app message to an audience. `target` is a user or group id, or null. */
  sendNotification(
    actor: AdminActor,
    audience: AdminNotificationAudience,
    target: string | null,
    message: { title: string; body: string; link: string | null },
  ): Promise<AdminSendNotificationResult>;
  /** Reply to a piece of feedback: notification + status change in one transaction. */
  replyFeedback(actor: AdminActor, feedbackId: string, message: string): Promise<AdminReplyFeedbackResult>;
  /** Everything the console has sent, one row per send. */
  listSentNotifications(limit: number, offset: number): Promise<AdminSentNotificationListRecord>;
  /** Recall a send: remove every copy. Returns null when the batch no longer exists. */
  deleteNotificationBatch(actor: AdminActor, batchId: string): Promise<AdminDeleteNotificationResult | null>;
  /** Master data including disabled rows and the rate overrides. */
  getCatalog(): Promise<AdminCatalogRecord>;
  /** Upsert one category. The key is the identity; there is no rename. */
  saveCategory(
    actor: AdminActor,
    category: { key: string; label: string; color: string; sort_order: number; enabled: boolean },
  ): Promise<AdminSaveCategoryResult>;
  saveCurrency(
    actor: AdminActor,
    currency: { code: string; label: string; sort_order: number; enabled: boolean },
  ): Promise<AdminSaveCurrencyResult>;
  /** Set one pair's manual rate, or clear it by passing null. */
  setRateOverride(
    actor: AdminActor,
    pair: { base: string; quote: string; rate: number | null; note: string | null },
  ): Promise<AdminRateOverrideResult>;
};
