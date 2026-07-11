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

export type AdminRepository = {
  /** Returns the caller's app_admins.role, or null when they are not an admin. */
  findAdminRole(userId: string): Promise<string | null>;
  getOverview(): Promise<AdminOverviewRecord>;
  listUsers(search: string, limit: number, offset: number): Promise<AdminUserListRecord>;
  getUserDetail(userId: string): Promise<AdminUserDetailRecord | null>;
  listGroups(search: string, limit: number, offset: number): Promise<AdminGroupListRecord>;
};
