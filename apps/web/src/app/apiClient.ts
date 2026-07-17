import type {
  ConfirmSettlementRequest,
  AcceptInviteRequest,
  CreateVirtualMemberRequest,
  CreateExpenseRequest,
  CreateGroupRequest,
  CreateInviteRequest,
  RemoveGroupMemberRequest,
  RenameGroupMemberRequest,
  UpdateGroupRequest,
  UpdateMyAvatarRequest,
  UploadGroupImageRequest,
} from "../contracts/schemas";

type ApiClientOptions = {
  baseUrl?: string;
  fetcher?: typeof fetch;
};

export type GroupSummary = {
  id: string;
  name: string;
  currency: string;
  owner_member_id: string;
  cover_image_url?: string | null;
};

export type ArchivedGroupSummary = GroupSummary & {
  archived_at: string;
  /** The caller's own group_members.id for this archived group (see groupRepository.ts's ArchivedGroupRecord doc). */
  caller_member_id: string;
};

export type GroupMemberSummary = {
  id: string;
  group_id: string;
  user_id: string | null;
  display_name: string;
  role: "owner" | "member";
  status: "active" | "removed";
  avatar_url?: string | null;
};

export type ExpensePaymentSummary = {
  payer_member_id: string;
  amount_minor: number;
  currency: string;
};

export type ExpenseShareSummary = {
  member_id: string;
  share_type: string;
  share_value?: number;
  amount_minor: number;
};

export type ExpenseSummary = {
  id: string;
  group_id: string;
  title: string;
  kind: string;
  category?: string;
  amount_minor: number;
  currency: string;
  expense_date?: string;
  note?: string | null;
  transfer_to_member_id?: string | null;
  image_url?: string | null;
  created_at?: string;
  version: number;
  client_request_id: string;
  expense_payments?: ExpensePaymentSummary[];
  expense_shares?: ExpenseShareSummary[];
};

export type BalanceSummary = {
  memberId: string;
  balance: {
    amount_minor: number;
    currency: string;
  };
};

export type SettlementTransferSummary = {
  fromMemberId: string;
  toMemberId: string;
  amount: {
    amount_minor: number;
    currency: string;
  };
};

export type SpendByDaySummary = {
  day: string;
  total_minor: number;
};

export type SpendByCategorySummary = {
  category: string;
  total_minor: number;
};

export type MemberDaySharesSummary = {
  day: string;
  member_id: string;
  share_minor: number;
};

export type GroupDetail = {
  group: GroupSummary;
  members: GroupMemberSummary[];
  /** Capped to the server's expense window (newest first) - see expense_count for the true total. */
  expenses: ExpenseSummary[];
  balances: BalanceSummary[];
  /** All non-deleted entries in the group (not just kind="expense") - drives the "load more" paging UI. */
  expense_count: number;
  /** Sum of kind="expense" amount_minor only (excludes income/transfer). Server-authoritative 總支出. */
  spend_total_minor: number;
  /** Last 8 days of kind="expense" totals, keyed by expense_date. */
  spend_by_day: SpendByDaySummary[];
  /** All-time per-category kind="expense" totals, largest first. */
  spend_by_category: SpendByCategorySummary[];
  /** Last 8 days of per-member kind="expense" shares, keyed by expense_date. */
  member_day_shares: MemberDaySharesSummary[];
};

export type ExpensesPageResponse = {
  expenses: ExpenseSummary[];
};

export type EquoApiClient = ReturnType<typeof createApiClient>;

export type ApiClientError = Error & { code?: string };

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json();

  if (!response.ok) {
    const message = payload?.error?.message ?? "Request failed";
    const error: ApiClientError = new Error(message);
    error.code = payload?.error?.code;
    throw error;
  }

  return payload as T;
}

/**
 * The session travels in the `equo_session` cookie, which the server set at
 * login as HttpOnly, Secure, SameSite=Lax (see sessionToken.ts's
 * createSessionCookie). The browser attaches it to every same-origin request
 * here; JavaScript never sees it, so an XSS on this page cannot read it out.
 *
 * It used to ALSO be handed to the client in the login response body and kept
 * in localStorage, then sent back as a Bearer header - which handed the token
 * to exactly the attacker the HttpOnly flag exists to keep it away from, and
 * made the cookie's protection worth nothing. The server accepts either (see
 * getAuthToken), so dropping the Bearer half changes no server behaviour.
 */
export function createApiClient({ baseUrl = "/api/v1", fetcher = fetch }: ApiClientOptions = {}) {
  async function request<T>(path: string, init: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    };

    const response = await fetcher(`${baseUrl}${path}`, {
      ...init,
      credentials: "same-origin",
      headers,
    });

    return readJson<T>(response);
  }

  return {
    exchangeGoogleToken(idToken: string) {
      return request<{
        session: {
          token: string;
          expires_at: string;
          user: { id: string; email: string; display_name: string; avatar_url?: string | null };
        };
      }>("/auth/google", {
        method: "POST",
        body: JSON.stringify({ id_token: idToken }),
      });
    },
    exchangeSupabaseToken(accessToken: string) {
      return request<{
        session: {
          token: string;
          expires_at: string;
          user: { id: string; email: string; display_name: string; avatar_url?: string | null };
        };
      }>("/auth/supabase", {
        method: "POST",
        body: JSON.stringify({ access_token: accessToken }),
      });
    },
    createGroup(payload: CreateGroupRequest) {
      return request<{ group: GroupSummary; owner_member: GroupMemberSummary }>("/groups", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    listGroups() {
      return request<{ groups: GroupSummary[] }>("/groups", {
        method: "GET",
      });
    },
    listArchivedGroups() {
      return request<{ groups: ArchivedGroupSummary[] }>("/groups/archived", {
        method: "GET",
      });
    },
    getGroupDetail(groupId: string) {
      return request<GroupDetail>(`/groups/${groupId}`, {
        method: "GET",
      });
    },
    updateGroup(groupId: string, payload: UpdateGroupRequest) {
      return request<{ group: GroupSummary }>(`/groups/${groupId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    createVirtualMember(groupId: string, payload: CreateVirtualMemberRequest) {
      return request<{ member: GroupMemberSummary }>(`/groups/${groupId}/members`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    renameGroupMember(groupId: string, memberId: string, payload: RenameGroupMemberRequest) {
      return request<{ member: GroupMemberSummary }>(`/groups/${groupId}/members/${memberId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    removeGroupMember(groupId: string, memberId: string, payload: RemoveGroupMemberRequest) {
      return request<{ member: GroupMemberSummary }>(`/groups/${groupId}/members/${memberId}`, {
        method: "DELETE",
        body: JSON.stringify(payload),
      });
    },
    archiveGroup(groupId: string, payload: { client_request_id: string }) {
      return request<{ group: GroupSummary }>(`/groups/${groupId}/archive`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    unarchiveGroup(groupId: string, payload: { client_request_id: string }) {
      return request<{ group: GroupSummary }>(`/groups/${groupId}/unarchive`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    deleteGroup(groupId: string, payload: { client_request_id: string }) {
      return request<{ group: GroupSummary }>(`/groups/${groupId}`, {
        method: "DELETE",
        body: JSON.stringify(payload),
      });
    },
    createInvite(groupId: string, payload: CreateInviteRequest) {
      return request<{ invite: { token: string; max_uses: number } }>(`/groups/${groupId}/invites`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    acceptInvite(token: string, payload: AcceptInviteRequest) {
      return request<{ group: GroupSummary; member: GroupMemberSummary; claimed: boolean }>(
        `/invites/${token}/accept`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
    },
    createExpense(groupId: string, payload: CreateExpenseRequest) {
      return request<{ expense: { id: string; title: string; amount_minor: number; currency: string } }>(
        `/groups/${groupId}/expenses`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
    },
    /**
     * Edit an entry. The client used to do this as a DELETE followed by a
     * POST - if the POST failed, the entry was simply gone. The server now
     * replaces it inside one database transaction.
     */
    replaceExpense(groupId: string, expenseId: string, payload: CreateExpenseRequest) {
      return request<{ expense: { id: string; title: string; amount_minor: number; currency: string } }>(
        `/groups/${groupId}/expenses/${expenseId}`,
        {
          method: "PUT",
          body: JSON.stringify(payload),
        },
      );
    },
    deleteExpense(groupId: string, expenseId: string, payload: { client_request_id: string }) {
      return request<{ expense: { id: string } }>(`/groups/${groupId}/expenses/${expenseId}`, {
        method: "DELETE",
        body: JSON.stringify(payload),
      });
    },
    /**
     * The records-panel "load more" page: older-than-cursor expenses once the
     * client has exhausted the initial get_group_detail window. Omitting
     * cursor fetches the first page (mainly useful for tests/tools - the app
     * always has a loaded expense to derive a cursor from before this is
     * ever called for real).
     */
    listExpensesPage(
      groupId: string,
      options: { limit?: number; beforeDate?: string; beforeCreatedAt?: string } = {},
    ) {
      const params = new URLSearchParams();
      if (options.limit !== undefined) params.set("limit", String(options.limit));
      if (options.beforeDate) params.set("before_date", options.beforeDate);
      if (options.beforeCreatedAt) params.set("before_created_at", options.beforeCreatedAt);
      const query = params.toString();
      return request<ExpensesPageResponse>(`/groups/${groupId}/expenses${query ? `?${query}` : ""}`, {
        method: "GET",
      });
    },
    uploadGroupImage(groupId: string, payload: UploadGroupImageRequest) {
      return request<{ image: { url: string } }>(`/groups/${groupId}/images`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    updateMyAvatar(payload: UpdateMyAvatarRequest) {
      return request<{ avatar_url: string }>("/me/avatar", {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    calculateSettlement(groupId: string) {
      return request<{
        settlement: { id: string; settlement_version: number; status: string };
        transfers: SettlementTransferSummary[];
      }>(`/groups/${groupId}/settlement/calculate`, {
        method: "POST",
        body: JSON.stringify({ client_request_id: crypto.randomUUID() }),
      });
    },
    confirmSettlement(groupId: string, settlementId: string, payload: ConfirmSettlementRequest) {
      return request<{ settlement: { id: string; status: string } }>(
        `/groups/${groupId}/settlement/${settlementId}/confirm`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
    },
    createFeedback(payload: { type: string; message: string; contact?: string; page?: string }) {
      return request<{ feedback: { id: string } }>("/feedback", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    reportClientError(payload: { source: string; message: string; context?: string; page?: string }) {
      return request<{ ok: true }>("/errors", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    adminMe() {
      return request<AdminMeSummary>("/admin/me", { method: "GET" });
    },
    adminOverview() {
      return request<AdminOverviewSummary>("/admin/overview", { method: "GET" });
    },
    adminListUsers(options: AdminListOptions = {}) {
      return request<AdminUserListPage>(`/admin/users${adminListQuery(options)}`, { method: "GET" });
    },
    adminUserDetail(userId: string) {
      return request<AdminUserDetail>(`/admin/users/${userId}`, { method: "GET" });
    },
    adminListGroups(options: AdminGroupListOptions = {}) {
      return request<AdminGroupListPage>(`/admin/groups${adminListQuery(options)}`, { method: "GET" });
    },
    adminGroupDetail(groupId: string) {
      return request<AdminGroupDetail>(`/admin/groups/${groupId}`, { method: "GET" });
    },
    adminListGroupExpenses(groupId: string, options: AdminExpenseListOptions = {}) {
      const params = new URLSearchParams();
      if (options.limit !== undefined) params.set("limit", String(options.limit));
      if (options.offset !== undefined) params.set("offset", String(options.offset));
      if (options.includeDeleted) params.set("include_deleted", "true");
      const query = params.toString();
      return request<AdminExpensePage>(`/admin/groups/${groupId}/expenses${query ? `?${query}` : ""}`, {
        method: "GET",
      });
    },
    adminListAuditLogs(options: AdminListOptions = {}) {
      return request<AdminAuditLogPage>(`/admin/audit${adminListQuery(options)}`, { method: "GET" });
    },
    adminListFeedback(options: AdminListOptions & { status?: string } = {}) {
      const params = new URLSearchParams();
      if (options.limit !== undefined) params.set("limit", String(options.limit));
      if (options.offset !== undefined) params.set("offset", String(options.offset));
      if (options.status && options.status !== "all") params.set("status", options.status);
      const query = params.toString();
      return request<AdminFeedbackPage>(`/admin/feedback${query ? `?${query}` : ""}`, { method: "GET" });
    },
    adminSetFeedbackStatus(feedbackId: string, status: string) {
      return request<{ id: string; status: string }>(`/admin/feedback/${feedbackId}/status`, {
        method: "POST",
        body: JSON.stringify({ status }),
      });
    },
    adminListErrors(options: AdminListOptions = {}) {
      return request<AdminErrorPage>(`/admin/errors${adminListQuery(options)}`, { method: "GET" });
    },
    adminSetUserDisabled(userId: string, disabled: boolean) {
      return request<{ id: string; disabled_at: string | null }>(
        `/admin/users/${userId}/${disabled ? "disable" : "enable"}`,
        { method: "POST", body: JSON.stringify({}) },
      );
    },
    adminSetGroupArchived(groupId: string, archived: boolean) {
      return request<AdminGroupStateResponse>(`/admin/groups/${groupId}/${archived ? "archive" : "unarchive"}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
    adminSetGroupDeleted(groupId: string, deleted: boolean) {
      return request<AdminGroupStateResponse>(`/admin/groups/${groupId}/${deleted ? "delete" : "restore"}`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
  };
}

export type AdminListOptions = {
  search?: string;
  limit?: number;
  offset?: number;
};

export type AdminGroupFilterOption = "all" | "archived" | "empty" | "deleted";

export type AdminGroupListOptions = AdminListOptions & {
  filter?: AdminGroupFilterOption;
};

export type AdminGroupStateResponse = {
  id: string;
  archived_at: string | null;
  deleted_at: string | null;
};

function adminListQuery(options: AdminGroupListOptions): string {
  const params = new URLSearchParams();
  if (options.search) params.set("search", options.search);
  if (options.limit !== undefined) params.set("limit", String(options.limit));
  if (options.offset !== undefined) params.set("offset", String(options.offset));
  if (options.filter && options.filter !== "all") params.set("filter", options.filter);
  const query = params.toString();
  return query ? `?${query}` : "";
}

export type AdminMeSummary = {
  user: { id: string; email: string; display_name: string; avatar_url?: string | null };
  role: string;
};

export type AdminOverviewSummary = {
  user_count: number;
  active_users_7d: number;
  new_users_7d: number;
  group_count: number;
  active_groups_7d: number;
  expense_count: number;
  expenses_7d: number;
};

export type AdminUserRow = {
  id: string;
  email: string;
  display_name: string;
  avatar_url: string | null;
  created_at: string;
  last_seen_at: string;
  disabled_at: string | null;
  group_count: number;
  expense_count: number;
};

export type AdminUserListPage = {
  total: number;
  users: AdminUserRow[];
};

export type AdminUserGroupRow = {
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

export type AdminUserDetail = {
  user: AdminUserRow;
  groups: AdminUserGroupRow[];
};

export type AdminGroupRow = {
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

export type AdminGroupListPage = {
  total: number;
  groups: AdminGroupRow[];
};

export type AdminGroupMemberRow = {
  /** group_members.id - what an expense's payers/shares reference. */
  id: string;
  user_id: string | null;
  display_name: string | null;
  email: string | null;
  avatar_url: string | null;
  role: string;
  status: string;
  joined_at: string;
  expense_count: number;
  balance_minor: number;
};

export type AdminGroupDetail = {
  group: AdminGroupRow & {
    cover_image_url: string | null;
    deleted_expense_count: number;
  };
  members: AdminGroupMemberRow[];
};

export type AdminExpenseListOptions = {
  limit?: number;
  offset?: number;
  includeDeleted?: boolean;
};

export type AdminExpensePayer = {
  member_id: string;
  display_name: string | null;
  amount_minor: number;
  currency: string;
};

export type AdminExpenseShare = {
  member_id: string;
  display_name: string | null;
  share_type: string;
  share_value: number | null;
  amount_minor: number;
};

export type AdminExpenseRow = {
  id: string;
  title: string;
  kind: string;
  category: string;
  amount_minor: number | null;
  currency: string;
  expense_date: string;
  note: string | null;
  image_url: string | null;
  receipt_image_url: string | null;
  created_at: string;
  deleted_at: string | null;
  version: number;
  created_by_name: string | null;
  transfer_to_name: string | null;
  payers: AdminExpensePayer[];
  shares: AdminExpenseShare[];
};

export type AdminExpensePage = {
  total: number;
  expenses: AdminExpenseRow[];
};

export type AdminAuditLogRow = {
  id: string;
  admin_email: string | null;
  action: string;
  metadata: Record<string, unknown>;
  created_at: string;
};

export type AdminAuditLogPage = {
  total: number;
  logs: AdminAuditLogRow[];
};

export type AdminFeedbackRow = {
  id: string;
  user_email: string | null;
  type: string;
  message: string;
  contact: string | null;
  page: string | null;
  status: string;
  created_at: string;
};

export type AdminFeedbackPage = {
  total: number;
  feedback: AdminFeedbackRow[];
};

export type AdminErrorRow = {
  id: string;
  user_email: string | null;
  source: string;
  message: string;
  context: string | null;
  page: string | null;
  created_at: string;
};

export type AdminErrorPage = {
  total: number;
  errors: AdminErrorRow[];
};
