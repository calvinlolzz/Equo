import type {
  AcceptInviteRequest,
  CreateVirtualMemberRequest,
  CreateExpenseRequest,
  CreateGroupRequest,
  CreateInviteRequest,
  RemoveGroupMemberRequest,
  RenameGroupMemberRequest,
  UpdateGroupRequest,
  ScanReceiptRequest,
  ScanReceiptResponse,
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
  /** Only GET /groups fills this in — see groupRepository's GroupRecord. */
  unread_count?: number;
  /**
   * The caller's own balance in this group, in the group's currency (positive
   * = owed to them). Only GET /groups fills it in, and it is absent — not zero
   * — when the server could not compute it.
   */
  balance_minor?: number;
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
  /** 收款資訊 — free text saying where to send this member their money. */
  payment_note?: string | null;
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

/** 循環支出: a monthly template the nightly job turns into real expenses. */
export type RecurringExpense = {
  id: string;
  group_id: string;
  title: string;
  amount_minor: number;
  currency: string;
  category: string;
  note: string | null;
  payer_member_id: string;
  share_member_ids: string[];
  /** 1-28 — 29-31 are refused rather than clamped, since February has no 30th. */
  day_of_month: number;
  next_run_date: string;
  active: boolean;
  /** Set when the nightly run disabled the rule, e.g. its creator left the group. */
  last_error: string | null;
  last_run_at: string | null;
};

export type RecurringExpenseInput = {
  id?: string;
  title: string;
  amount_minor: number;
  currency?: string;
  category?: string;
  note?: string | null;
  payer_member_id: string;
  share_member_ids: string[];
  day_of_month: number;
  active?: boolean;
};

/** The records-panel filter as the API takes it; "" means "all" for each field. */
export type ExpenseSearchQuery = {
  q?: string;
  memberId?: string;
  category?: string;
  kind?: string;
  from?: string;
  to?: string;
  limit?: number;
  beforeDate?: string;
  beforeCreatedAt?: string;
};

export type ExpenseSearchResponse = {
  expenses: ExpenseSummary[];
  /** Matches across the whole history — NOT just the returned page. */
  match_count: number;
  match_total_minor: number;
  has_more: boolean;
};

/** 每年統計 / 每月統計 — the two bucketings the 分析 period picker offers. */
export type SpendPeriodKind = "year" | "month";

/** One selectable period: "2026" for a year, "2026-08" for a month. */
export type SpendPeriodSummary = {
  key: string;
  total_minor: number;
};

export type SpendCategoryBreakdown = {
  category: string;
  group_total_minor: number;
  /** The caller's own share of that category — their expense_shares rows. */
  personal_total_minor: number;
};

export type SpendBreakdown = {
  period_kind: SpendPeriodKind;
  /** Null only when the group has no spendable expenses at all. */
  period_key: string | null;
  currency: string;
  /** Newest first, capped server-side to 36 entries. */
  periods: SpendPeriodSummary[];
  group_total_minor: number;
  personal_total_minor: number;
  by_category: SpendCategoryBreakdown[];
};

export type ExchangeRatesResponse = {
  base: string;
  /** The upstream's publication date (YYYY-MM-DD). */
  date: string;
  /** quote code -> units of quote per 1 base; always carries base: 1. */
  rates: Record<string, number>;
  /** The upstream was unreachable and this is a kept-past-TTL copy. */
  stale: boolean;
};

export type EquoApiClient = ReturnType<typeof createApiClient>;

export type ApiClientError = Error & {
  code?: string;
  /**
   * The error body's optional `details`, passed through untouched. Only a
   * couple of refusals carry one (the groups that block an account merge); a
   * caller that ignores it still has `message`.
   */
  details?: Record<string, unknown>;
};

/**
 * The request never reached the server, as opposed to reaching it and being
 * rejected. Keyed on the code `request` tags fetch() rejections with, plus
 * navigator.onLine for the case where the browser knows it is offline -
 * never on the message, which is a browser-specific string.
 *
 * The distinction decides whether a failed write is queued for retry
 * (see offlineQueue.ts) or surfaced as an error, so it must not guess.
 */
export function isNetworkError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === "NETWORK_ERROR") return true;
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

async function readJson<T>(response: Response): Promise<T> {
  // A 5xx / gateway timeout can return an HTML error page or an empty body, so
  // response.json() throws an opaque SyntaxError ("Unexpected token '<'") that
  // would otherwise surface raw in the UI. Parse defensively and tag a code the
  // localizer (describeCloudActionError) can turn into friendly copy.
  let payload: { error?: { message?: string; code?: string; details?: Record<string, unknown> } } | null = null;
  let parseFailed = false;
  try {
    payload = await response.json();
  } catch {
    parseFailed = true;
  }

  if (!response.ok) {
    const error: ApiClientError = new Error(payload?.error?.message ?? "Request failed");
    error.code = payload?.error?.code ?? (response.status >= 500 ? "SERVER_ERROR" : undefined);
    if (payload?.error?.details) {
      error.details = payload.error.details;
    }
    throw error;
  }

  if (parseFailed) {
    const error: ApiClientError = new Error("Malformed server response");
    error.code = "SERVER_ERROR";
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

    let response: Response;
    try {
      response = await fetcher(`${baseUrl}${path}`, {
        ...init,
        credentials: "same-origin",
        headers,
      });
    } catch (cause) {
      // fetch() rejects (TypeError "Failed to fetch" / "Load failed") only on a
      // network-level failure — offline, DNS, CORS, connection reset. Tag it so
      // the UI shows "網路連線失敗" instead of the raw browser string.
      const error: ApiClientError = new Error(cause instanceof Error ? cause.message : "Network request failed");
      error.code = "NETWORK_ERROR";
      throw error;
    }

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
    /** Clears this group's unread badge for the caller. */
    markGroupRead(groupId: string) {
      return request<{ group_id: string; last_read_at: string }>(`/groups/${groupId}/read`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
    /**
     * Remind one member who owes the group. Rejects with NUDGE_COOLDOWN when
     * they were reminded recently and NUDGE_NOT_NEEDED when they owe nothing —
     * both are answers to show the user, not failures to retry.
     */
    nudgeMember(groupId: string, memberId: string) {
      return request<{ nudge: { status: string } }>(`/groups/${groupId}/members/${memberId}/nudge`, {
        method: "POST",
        body: JSON.stringify({}),
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
    listRecurring(groupId: string) {
      return request<{ recurring: RecurringExpense[] }>(`/groups/${groupId}/recurring`, { method: "GET" });
    },
    /** Creates, or updates when `payload.id` is set. */
    upsertRecurring(groupId: string, payload: RecurringExpenseInput) {
      return request<{ recurring: RecurringExpense }>(`/groups/${groupId}/recurring`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    deleteRecurring(groupId: string, id: string) {
      return request<{ deleted: true }>(`/groups/${groupId}/recurring/${id}`, { method: "DELETE" });
    },
    /**
     * The records-panel filter, run against the group's whole history rather
     * than the ~100 expenses the client happens to hold. `match_count` and
     * `match_total_minor` cover every match, so the summary line can state a
     * real number instead of "however many of these are in memory".
     */
    searchExpenses(groupId: string, search: ExpenseSearchQuery) {
      const params = new URLSearchParams();
      if (search.q) params.set("q", search.q);
      if (search.memberId) params.set("member_id", search.memberId);
      if (search.category) params.set("category", search.category);
      if (search.kind) params.set("kind", search.kind);
      if (search.from) params.set("from", search.from);
      if (search.to) params.set("to", search.to);
      if (search.limit !== undefined) params.set("limit", String(search.limit));
      if (search.beforeDate) params.set("before_date", search.beforeDate);
      if (search.beforeCreatedAt) params.set("before_created_at", search.beforeCreatedAt);
      const query = params.toString();
      return request<ExpenseSearchResponse>(`/groups/${groupId}/expenses/search${query ? `?${query}` : ""}`, {
        method: "GET",
      });
    },
    /**
     * 分析頁的期間統計. Server-side because the client only holds the newest
     * 100 expenses — a year total folded from that window would silently
     * under-report. Both the group and the personal figure come back together
     * so the 個人／群組 toggle never needs a round trip.
     */
    getSpendBreakdown(groupId: string, options: { kind?: SpendPeriodKind; key?: string } = {}) {
      const params = new URLSearchParams();
      if (options.kind) params.set("kind", options.kind);
      if (options.key) params.set("key", options.key);
      const query = params.toString();
      return request<SpendBreakdown>(`/groups/${groupId}/spend-breakdown${query ? `?${query}` : ""}`, {
        method: "GET",
      });
    },
    /** The VAPID public key, or {enabled:false} when this deployment has push off. */
    getPushPublicKey() {
      return request<{ enabled: boolean; public_key?: string }>("/push/public-key", { method: "GET" });
    },
    subscribePush(subscription: { endpoint: string; keys: { p256dh: string; auth: string }; user_agent: string }) {
      return request<{ ok: true }>("/push/subscribe", {
        method: "POST",
        body: JSON.stringify(subscription),
      });
    },
    unsubscribePush(endpoint: string) {
      return request<{ ok: true }>("/push/unsubscribe", {
        method: "POST",
        body: JSON.stringify({ endpoint }),
      });
    },
    /** Daily reference rates for the composer's 匯率 field, keyed on `base`. */
    getExchangeRates(base: string) {
      return request<ExchangeRatesResponse>(`/exchange-rates?base=${encodeURIComponent(base)}`, {
        method: "GET",
      });
    },
    uploadGroupImage(groupId: string, payload: UploadGroupImageRequest) {
      return request<{ image: { url: string } }>(`/groups/${groupId}/images`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    /**
     * Read a photographed receipt into composer fields. Rejects with a
     * RECEIPT_SCAN_UNAVAILABLE ApiRequestError when recognition is off or the
     * upstream failed — callers still have the photo, so that is a downgrade
     * rather than a failure.
     */
    scanReceipt(payload: ScanReceiptRequest) {
      return request<ScanReceiptResponse>("/receipts/scan", {
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
    deleteMyAccount() {
      return request<{ ok: true }>("/me", {
        method: "DELETE",
      });
    },
    setMemberPaymentNote(groupId: string, memberId: string, paymentNote: string) {
      return request<{ member: GroupMemberSummary }>(`/groups/${groupId}/members/${memberId}/payment-note`, {
        method: "PUT",
        body: JSON.stringify({ payment_note: paymentNote }),
      });
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
    adminStorage() {
      return request<AdminStorageSummary>("/admin/storage", { method: "GET" });
    },
    adminTrends(days: number) {
      return request<AdminTrendsSummary>(`/admin/trends?days=${days}`, { method: "GET" });
    },
    adminHealth() {
      return request<AdminHealthSummary>("/admin/health", { method: "GET" });
    },
    adminScanUsage(days: number) {
      return request<AdminScanUsage>(`/admin/scan-usage?days=${days}`, { method: "GET" });
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
    adminListAuditLogs(options: AdminListOptions & { action?: string } = {}) {
      const params = new URLSearchParams();
      if (options.search) params.set("search", options.search);
      if (options.action) params.set("action", options.action);
      if (options.limit !== undefined) params.set("limit", String(options.limit));
      if (options.offset !== undefined) params.set("offset", String(options.offset));
      const query = params.toString();
      return request<AdminAuditLogPage>(`/admin/audit${query ? `?${query}` : ""}`, { method: "GET" });
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
    adminListErrorGroups(options: AdminListOptions & { status?: string } = {}) {
      const params = new URLSearchParams(adminListQuery(options).replace(/^\?/, ""));
      if (options.status && options.status !== "all") params.set("status", options.status);
      const query = params.toString();
      return request<AdminErrorGroupPage>(`/admin/error-groups${query ? `?${query}` : ""}`, { method: "GET" });
    },
    adminListErrors(options: AdminListOptions & { fingerprint?: string } = {}) {
      const params = new URLSearchParams(adminListQuery(options).replace(/^\?/, ""));
      if (options.fingerprint) params.set("fingerprint", options.fingerprint);
      const query = params.toString();
      return request<AdminErrorPage>(`/admin/errors${query ? `?${query}` : ""}`, { method: "GET" });
    },
    adminSetErrorGroupStatus(fingerprint: string, status: string) {
      return request<{ fingerprint: string; status: string }>(
        `/admin/error-groups/${encodeURIComponent(fingerprint)}/status`,
        { method: "POST", body: JSON.stringify({ status }) },
      );
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
    /** The console's live view of receipt recognition (support+ may read). */
    adminGetReceiptScanSettings() {
      return request<AdminReceiptScanSettings>("/admin/settings/receipt-scan", { method: "GET" });
    },
    /** Change the kill switch and/or the model (admin+). */
    adminSetReceiptScanSettings(enabled: boolean, model: string) {
      return request<AdminReceiptScanSettings>("/admin/settings/receipt-scan", {
        method: "PUT",
        body: JSON.stringify({ enabled, model }),
      });
    },
    adminListAdmins() {
      return request<{ admins: AdminAccountRow[] }>("/admin/admins", { method: "GET" });
    },
    adminSetAdminRole(email: string, role: string) {
      return request<{ admin: AdminAccountRow }>("/admin/admins", {
        method: "POST",
        body: JSON.stringify({ email, role }),
      });
    },
    adminRemoveAdmin(userId: string) {
      return request<{ user_id: string }>(`/admin/admins/${userId}/remove`, {
        method: "POST",
        body: JSON.stringify({}),
      });
    },
    /** Soft-delete or restore one expense (admin+). */
    adminSetExpenseDeleted(groupId: string, expenseId: string, deleted: boolean) {
      return request<AdminExpenseWriteResult>(
        `/admin/groups/${groupId}/expenses/${expenseId}/${deleted ? "delete" : "restore"}`,
        { method: "POST", body: JSON.stringify({}) },
      );
    },
    /** Correct an expense's title/category/date/note (admin+). Money is not editable. */
    adminUpdateExpenseMeta(groupId: string, expenseId: string, patch: AdminExpenseMetaPatch) {
      return request<AdminExpenseWriteResult>(`/admin/groups/${groupId}/expenses/${expenseId}`, {
        method: "PATCH",
        body: JSON.stringify(patch),
      });
    },
    /** Hand a group to another member, by group_members.id (admin+). */
    adminTransferGroupOwner(groupId: string, memberId: string) {
      return request<AdminTransferOwnerResponse>(`/admin/groups/${groupId}/transfer-owner`, {
        method: "POST",
        body: JSON.stringify({ member_id: memberId }),
      });
    },
    /** Fold `userId`'s memberships into `targetUserId` and retire it (owner only). */
    adminMergeUsers(userId: string, targetUserId: string) {
      return request<AdminMergeUsersResponse>(`/admin/users/${userId}/merge`, {
        method: "POST",
        body: JSON.stringify({ target_user_id: targetUserId }),
      });
    },
    /** The subject-access document for one user (admin+). */
    adminExportUser(userId: string) {
      return request<Record<string, unknown>>(`/admin/users/${userId}/export`, { method: "GET" });
    },
    /** Run account deletion on someone's behalf (owner only, irreversible). */
    adminDeleteUser(userId: string) {
      return request<AdminDeleteUserResponse>(`/admin/users/${userId}`, { method: "DELETE" });
    },
    /** The category and currency lists the app renders itself from. */
    getCatalog() {
      return request<{ categories: Array<{ key: string; label: string; color: string }>; currencies: Array<{ code: string; label: string }> }>(
        "/catalog",
        { method: "GET" },
      );
    },
    /** Master data as the console sees it: disabled rows and rate overrides included (support+). */
    adminGetCatalog() {
      return request<AdminCatalogPayload>("/admin/catalog", { method: "GET" });
    },
    /** Create or update one category, keyed by its expenses.category value (admin+). */
    adminSaveCategory(key: string, input: { label: string; color: string; sort_order: number; enabled: boolean }) {
      return request<{ ok: true; category: AdminCatalogCategoryRow }>(
        `/admin/catalog/categories/${encodeURIComponent(key)}`,
        { method: "PUT", body: JSON.stringify(input) },
      );
    },
    adminSaveCurrency(code: string, input: { label: string; sort_order: number; enabled: boolean }) {
      return request<{ ok: true; currency: AdminCatalogCurrencyRow }>(
        `/admin/catalog/currencies/${encodeURIComponent(code)}`,
        { method: "PUT", body: JSON.stringify(input) },
      );
    },
    /** Set one pair's manual rate; `rate: null` clears it and follows the upstream again. */
    adminSetRateOverride(input: { base: string; quote: string; rate: number | null; note?: string }) {
      return request<{ ok: true; cleared: boolean; base: string; quote: string; rate?: number }>(
        "/admin/catalog/rates",
        { method: "PUT", body: JSON.stringify(input) },
      );
    },
    /** The signed-in user's own inbox, plus the unread count for the bell. */
    listNotifications() {
      return request<NotificationsPage>("/notifications", { method: "GET" });
    },
    /** Delete rows from the caller's own inbox; an empty list clears all of it. */
    deleteNotifications(ids: string[] = []) {
      return request<{ deleted: number; unread: number }>("/notifications", {
        method: "DELETE",
        body: JSON.stringify({ ids }),
      });
    },
    /** Everything the console has sent, one row per send (support+). */
    adminListSentNotifications(options: { limit?: number; offset?: number } = {}) {
      const params = new URLSearchParams();
      if (options.limit !== undefined) params.set("limit", String(options.limit));
      if (options.offset !== undefined) params.set("offset", String(options.offset));
      const query = params.toString();
      return request<AdminSentNotificationPage>(`/admin/notifications${query ? `?${query}` : ""}`, {
        method: "GET",
      });
    },
    /** Recall a send: remove every copy from every inbox (admin+). */
    adminDeleteNotificationBatch(batchId: string) {
      return request<{ ok: true; deleted: number; already_read: number; title: string }>(
        `/admin/notifications/${batchId}`,
        { method: "DELETE" },
      );
    },
    /** Mark rows read; an empty list means the whole inbox. */
    markNotificationsRead(ids: string[] = []) {
      return request<{ marked: number; unread: number }>("/notifications/read", {
        method: "POST",
        body: JSON.stringify({ ids }),
      });
    },
    /** Send an in-app message to one user, one group, recent users, or everyone (admin+). */
    adminSendNotification(input: AdminNotificationInput) {
      return request<{ ok: true; recipients: number }>("/admin/notifications", {
        method: "POST",
        body: JSON.stringify(input),
      });
    },
    /** Reply to a piece of feedback: the user gets an inbox item and the row closes. */
    adminReplyFeedback(feedbackId: string, message: string) {
      return request<{ ok: true; feedback_id: string; notification_id: string; status: string }>(
        `/admin/feedback/${feedbackId}/reply`,
        { method: "POST", body: JSON.stringify({ message }) },
      );
    },
  };
}

export type AdminCatalogCategoryRow = {
  key: string;
  label: string;
  color: string;
  sort_order: number;
  enabled: boolean;
  updated_at?: string;
  updated_by_email?: string | null;
  /** Live expenses filed under this key - what makes disabling it consequential. */
  expense_count?: number;
};

export type AdminCatalogCurrencyRow = {
  code: string;
  label: string;
  sort_order: number;
  enabled: boolean;
  updated_at?: string;
  updated_by_email?: string | null;
  expense_count?: number;
};

export type AdminRateOverrideRow = {
  base: string;
  quote: string;
  /** numeric(18,8) arrives as a string. */
  rate: string | number;
  note: string | null;
  updated_at: string;
  updated_by_email: string | null;
};

export type AdminCatalogPayload = {
  categories: AdminCatalogCategoryRow[];
  currencies: AdminCatalogCurrencyRow[];
  rate_overrides: AdminRateOverrideRow[];
};

export type NotificationRow = {
  id: string;
  kind: string;
  title: string;
  body: string;
  /** An in-app path, or null. */
  link: string | null;
  created_at: string;
  read_at: string | null;
};

export type NotificationsPage = {
  /** Unread across the whole inbox, not just the returned page. */
  unread: number;
  items: NotificationRow[];
};

export type AdminNotificationAudienceOption = "user" | "group" | "active" | "all";

export type AdminSentNotificationRow = {
  batch_id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  audience: string | null;
  created_by_email: string | null;
  created_at: string;
  recipients: number;
  /** How many recipients have opened it. */
  read_count: number;
};

export type AdminSentNotificationPage = {
  total: number;
  batches: AdminSentNotificationRow[];
};

export type AdminNotificationInput = {
  audience: AdminNotificationAudienceOption;
  /** A user id for 'user', a group id for 'group'; omitted otherwise. */
  target?: string;
  title: string;
  body: string;
  /** An in-app path such as /group/<id>. */
  link?: string;
};

export type AdminExpenseWriteResult = {
  id: string;
  title: string;
  category: string;
  expense_date: string;
  note: string | null;
  deleted_at: string | null;
  version: number;
};

/** Only the descriptive fields; an absent key means "leave alone". */
export type AdminExpenseMetaPatch = {
  title?: string;
  category?: string;
  expense_date?: string;
  /** "" clears the note. */
  note?: string;
};

export type AdminTransferOwnerResponse = {
  ok: true;
  group_id: string;
  owner_member_id: string;
  owner_user_id: string;
  owner_display_name: string | null;
};

export type AdminMergeUsersResponse = {
  ok: true;
  source_user_id: string;
  source_email: string | null;
  target_user_id: string;
  target_email: string | null;
  memberships_moved: number;
  groups_reowned: number;
};

export type AdminDeleteUserResponse = {
  ok: true;
  groups_reassigned: number;
  groups_deleted: number;
  memberships_anonymized: number;
};

export type AdminAccountRow = {
  user_id: string;
  email: string | null;
  display_name: string | null;
  avatar_url: string | null;
  role: string;
  created_at: string;
};

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

export type AdminStorageSummary = {
  object_count: number;
  total_bytes: number;
  orphan_count: number;
  orphan_bytes: number;
};

export type AdminTrendPoint = {
  /** YYYY-MM-DD in Asia/Taipei. Days with no activity are present as zeros. */
  day: string;
  new_users: number;
  active_users: number;
  new_groups: number;
  expenses: number;
};

export type AdminTrendsSummary = {
  days: number;
  points: AdminTrendPoint[];
};

export type AdminHealthSummary = {
  /** null until the backup workflow has recorded its first success. */
  backup: { last_success_at: string; detail: Record<string, unknown> } | null;
  /** Every ops_heartbeats row. Absent on an API deployed before this shipped. */
  jobs?: Array<{ kind: string; last_success_at: string; detail: Record<string, unknown> }>;
  /** Push delivery health. Absent on an API deployed before this shipped. */
  push?: {
    subscriptions: number;
    subscribed_users: number;
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
   * Free-plan usage against the two hard limits. The LIMITS are not here — they
   * belong to the billing plan, not the database (see FREE_PLAN_LIMITS).
   * Absent on an API deployed before this shipped.
   */
  quota?: {
    /** Sum over pg_database, matching the number Supabase enforces. */
    database_bytes: number;
    storage_bytes: number;
  };
  rate_limit: { active_buckets: number; blocked_24h: number };
  errors: {
    last_24h: number;
    last_7d: number;
    latest_at: string | null;
    /** Distinct unresolved errors from the last 30 days; absent before the migration that adds it. */
    open_groups?: number;
  };
  feedback: { open: number };
  /**
   * Receipt recognition's live configuration. Absent on an API deployed before
   * this shipped, so the tile is conditional rather than assumed.
   */
  receipt_scan?: { configured: boolean; enabled: boolean; model: string };
};

export type AdminReceiptScanModel = {
  id: string;
  provider: "anthropic" | "google";
  /** What choosing it costs, in the console's own words. */
  note: string;
  /** Does this deployment hold a key for the model's provider. */
  available: boolean;
};

export type AdminReceiptScanSettings = {
  enabled: boolean;
  model: string;
  updated_at: string | null;
  updated_by_email: string | null;
  /** Can the SELECTED model actually run here. False = its provider has no key. */
  configured: boolean;
  /** Every model this build knows, runnable or not. */
  models: AdminReceiptScanModel[];
};

/**
 * What receipt recognition actually did, and what it cost.
 *
 * Every spend figure is in millionths of a USD — one Haiku scan is about
 * US$0.0005, which rounds to zero in cents. Divide once at the point of display.
 */
export type AdminScanUsage = {
  days: number;
  summary: {
    scans: number;
    recognised: number;
    /** Answered, but could not read the photo. A camera problem, not an outage. */
    unrecognised: number;
    failed: number;
    users: number;
    cost_micros: number;
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
  top_users: Array<{ user_id: string | null; email: string; scans: number; failed: number; cost_micros: number }>;
  recent_failures: Array<{ created_at: string; model: string; failure_reason: string; email: string }>;
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

export type AdminGroupInvite = {
  id: string;
  max_uses: number;
  use_count: number;
  expires_at: string | null;
  revoked_at: string | null;
  created_at: string;
  created_by_name: string | null;
};

export type AdminGroupDetail = {
  group: AdminGroupRow & {
    cover_image_url: string | null;
    deleted_expense_count: number;
  };
  members: AdminGroupMemberRow[];
  invites: AdminGroupInvite[];
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
  fingerprint: string;
};

export type AdminErrorPage = {
  total: number;
  errors: AdminErrorRow[];
};

export type AdminErrorGroupRow = {
  fingerprint: string;
  source: string;
  sample_message: string;
  last_page: string | null;
  occurrences: number;
  user_count: number;
  first_seen: string;
  last_seen: string;
  status: "open" | "resolved";
  status_updated_at: string | null;
  status_updated_by: string | null;
};

export type AdminErrorGroupPage = {
  total: number;
  groups: AdminErrorGroupRow[];
};
