import { describe, expect, test } from "vitest";
import type { AdminRepository } from "../repositories/adminRepository.js";
import {
  ADMIN_LIST_DEFAULT_LIMIT,
  ADMIN_LIST_MAX_LIMIT,
  handleAdminGroupDetail,
  handleAdminListGroupExpenses,
  handleAdminListAuditLogs,
  handleAdminListErrorGroups,
  handleAdminListErrors,
  handleAdminListFeedback,
  handleAdminListGroups,
  handleAdminListUsers,
  handleAdminSetFeedbackStatus,
  handleAdminMe,
  handleAdminOverview,
  handleAdminReceiptScanUsage,
  handleAdminStorage,
  handleAdminTrends,
  handleAdminHealth,
  resolveTrendDays,
  handleAdminSetGroupArchived,
  handleAdminSetGroupDeleted,
  handleAdminSetUserDisabled,
  handleAdminUserDetail,
  handleAdminListAdmins,
  handleAdminSetAdminRole,
  handleAdminRemoveAdmin,
  handleAdminSetErrorGroupStatus,
  handleAdminDeleteUser,
  handleAdminExportUser,
  handleAdminMergeUsers,
  handleAdminSetExpenseDeleted,
  handleAdminTransferGroupOwner,
  handleAdminUpdateExpenseMeta,
  handleAdminDeleteNotificationBatch,
  handleAdminListSentNotifications,
  handleAdminReplyFeedback,
  handleAdminSendNotification,
  handleAdminGetCatalog,
  handleAdminSaveCategory,
  handleAdminSaveCurrency,
  handleAdminSetRateOverride,
  normalizeAdminListQuery,
  normalizeErrorStatusFilter,
  normalizeExpenseMetaPatch,
  normalizeGroupFilter,
  normalizeNotificationRequest,
} from "./admin.js";

const context = {
  user: {
    id: "user_admin",
    google_sub: "google-admin",
    email: "admin@example.com",
    display_name: "Admin",
  },
};

// The group/user drill-down handlers screen ids as uuids before the RPC, so the
// success-path tests use real uuids; the friendly labels stay for readability.
const GROUP_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";

const overview = {
  user_count: 5,
  active_users_7d: 3,
  new_users_7d: 1,
  group_count: 27,
  active_groups_7d: 4,
  expense_count: 32,
  expenses_7d: 6,
};

const userSummary = {
  id: "user_alice",
  email: "alice@example.com",
  display_name: "Alice",
  avatar_url: null,
  created_at: "2026-07-01T00:00:00.000Z",
  last_seen_at: "2026-07-10T00:00:00.000Z",
  disabled_at: null,
  group_count: 2,
  expense_count: 9,
};

const groupDetailSummary = {
  id: "group_1",
  name: "Trip",
  currency: "TWD",
  created_at: "2026-07-01T00:00:00.000Z",
  archived_at: null,
  deleted_at: null,
  member_count: 2,
  expense_count: 4,
  deleted_expense_count: 1,
  spend_total_minor: 12_000,
  last_expense_at: "2026-07-10T00:00:00.000Z",
  owner_display_name: "Alice",
  cover_image_url: null,
};

const EXPENSE_ID = "33333333-3333-4333-8333-333333333333";
const MEMBER_ID = "44444444-4444-4444-8444-444444444444";

const expenseWrite = {
  id: EXPENSE_ID,
  title: "晚餐",
  category: "food",
  expense_date: "2026-08-01",
  note: null as string | null,
  deleted_at: null as string | null,
  version: 2,
};

const adminAccount = {
  user_id: "user_admin",
  email: "admin@example.com",
  display_name: "Admin",
  avatar_url: null,
  role: "owner",
  created_at: "2026-07-01T00:00:00.000Z",
};

function makeRepository(overrides: Partial<AdminRepository> = {}): AdminRepository {
  return {
    async findAdminRole(userId) {
      return userId === "user_admin" ? "owner" : null;
    },
    async logViewAs(_actor, targetUserId) {
      return { target_user_id: targetUserId, target_email: "target@example.com" };
    },
    async getRetention(period) {
      return { period, total_users: 8, never_active: 3, cohorts: [] };
    },
    async listAdmins() {
      return [adminAccount];
    },
    async setAdminRole(_actor, _email, role) {
      return { ok: true, admin: { ...adminAccount, role } };
    },
    async removeAdmin(_actor, userId) {
      return { ok: true, user_id: userId };
    },
    async getOverview() {
      return overview;
    },
    async getStorage() {
      return { object_count: 13, total_bytes: 861938, orphan_count: 0, orphan_bytes: 0 };
    },
    async getTrends(days) {
      return {
        days,
        points: [{ day: "2026-07-29", new_users: 1, active_users: 2, new_groups: 0, expenses: 4 }],
      };
    },
    async getReceiptScanUsage(days) {
      return {
        days,
        summary: {
          scans: 3,
          recognised: 1,
          unrecognised: 1,
          failed: 1,
          users: 2,
          cost_micros: 2850,
          p50_ms: 4400,
          p95_ms: 12000,
          latest_at: "2026-08-24T01:00:00.000Z",
        },
        by_day: [{ day: "2026-08-24", scans: 3, failed: 1, cost_micros: 2850 }],
        by_model: [
          {
            model: "claude-haiku-4-5",
            provider: "anthropic",
            scans: 2,
            failed: 1,
            cost_micros: 2850,
            p50_ms: 4400,
          },
        ],
        top_users: [
          { user_id: "user_1", email: "one@example.com", scans: 2, failed: 0, cost_micros: 2850 },
        ],
        recent_failures: [
          {
            created_at: "2026-08-24T01:00:00.000Z",
            model: "claude-haiku-4-5",
            failure_reason: "upstream returned 429",
            email: "one@example.com",
          },
        ],
      };
    },
    async getHealth() {
      return {
        backup: { last_success_at: "2026-07-29T02:30:00.000Z", detail: { bytes: 1024 } },
        rate_limit: { active_buckets: 0, blocked_24h: 0 },
        errors: { last_24h: 0, last_7d: 0, latest_at: null },
        feedback: { open: 1 },
      };
    },
    async listUsers() {
      return { total: 1, users: [userSummary] };
    },
    async getUserDetail() {
      return { user: userSummary, groups: [] };
    },
    async listGroups() {
      return { total: 0, groups: [] };
    },
    async getGroupDetail() {
      return { group: groupDetailSummary, members: [], invites: [] };
    },
    async listGroupExpenses() {
      return { total: 0, expenses: [] };
    },
    async setUserDisabled(_actor, userId, disabled) {
      return { id: userId, disabled_at: disabled ? "2026-07-11T00:00:00.000Z" : null };
    },
    async setGroupArchived(_actor, groupId, archived) {
      return { id: groupId, archived_at: archived ? "2026-07-11T00:00:00.000Z" : null, deleted_at: null };
    },
    async setGroupDeleted(_actor, groupId, deleted) {
      return { id: groupId, archived_at: null, deleted_at: deleted ? "2026-07-11T00:00:00.000Z" : null };
    },
    async listAuditLogs() {
      return {
        total: 1,
        logs: [
          {
            id: "log_1",
            admin_email: "admin@example.com",
            action: "user.disable",
            metadata: { email: "alice@example.com" },
            created_at: "2026-07-11T00:00:00.000Z",
          },
        ],
      };
    },
    async listFeedback() {
      return { total: 0, feedback: [] };
    },
    async setFeedbackStatus(_actor, feedbackId, status) {
      return { id: feedbackId, status };
    },
    async listErrors() {
      return { total: 0, errors: [] };
    },
    async listErrorGroups() {
      return { total: 0, groups: [] };
    },
    async setErrorGroupStatus(_actor, fingerprint, status) {
      return { fingerprint, status };
    },
    async setExpenseDeleted(_actor, _groupId, expenseId, deleted) {
      return { ...expenseWrite, id: expenseId, deleted_at: deleted ? "2026-08-05T00:00:00.000Z" : null };
    },
    async updateExpenseMeta(_actor, _groupId, expenseId, patch) {
      return { ...expenseWrite, id: expenseId, ...patch };
    },
    async transferGroupOwner(_actor, groupId, memberId) {
      return {
        ok: true,
        group_id: groupId,
        owner_member_id: memberId,
        owner_user_id: USER_ID,
        owner_display_name: "Bob",
      };
    },
    async mergeUsers(_actor, sourceUserId, targetUserId) {
      return {
        ok: true,
        source_user_id: sourceUserId,
        source_email: "old@example.com",
        target_user_id: targetUserId,
        target_email: "new@example.com",
        memberships_moved: 2,
        groups_reowned: 1,
      };
    },
    async exportUser(_actor, userId) {
      return { user: { id: userId }, memberships: [], expenses: [], feedback: [] };
    },
    async deleteUser() {
      return { ok: true, groups_reassigned: 1, groups_deleted: 0, memberships_anonymized: 3 };
    },
    async sendNotification() {
      return { ok: true, recipients: 7 };
    },
    async replyFeedback(_actor, feedbackId) {
      return { ok: true, feedback_id: feedbackId, notification_id: "notification_1", status: "done" };
    },
    async listSentNotifications() {
      return { total: 0, batches: [] };
    },
    async deleteNotificationBatch() {
      return { ok: true as const, deleted: 4, already_read: 1, title: "維護通知" };
    },
    async getCatalog() {
      return { categories: [], currencies: [], rate_overrides: [] };
    },
    async saveCategory(_actor, category) {
      return { ok: true, category };
    },
    async saveCurrency(_actor, currency) {
      return { ok: true, currency };
    },
    async setRateOverride(_actor, pair) {
      return pair.rate === null
        ? { ok: true, cleared: true, base: pair.base, quote: pair.quote }
        : { ok: true, cleared: false, base: pair.base, quote: pair.quote, rate: pair.rate };
    },
    ...overrides,
  };
}

describe("admin handlers", () => {
  test("every endpoint rejects non-admin callers with 403 ADMIN_FORBIDDEN", async () => {
    const repository = makeRepository({
      async findAdminRole() {
        return null;
      },
    });

    const results = await Promise.all([
      handleAdminMe(repository, context),
      handleAdminOverview(repository, context),
      handleAdminListUsers(repository, context),
      handleAdminUserDetail(repository, context, "user_alice"),
      handleAdminListGroups(repository, context),
      handleAdminStorage(repository, context),
      handleAdminTrends(repository, context, "30"),
      handleAdminReceiptScanUsage(repository, context, "30"),
      handleAdminHealth(repository, context),
      handleAdminGroupDetail(repository, context, "group_1"),
      handleAdminListGroupExpenses(repository, context, "group_1"),
      handleAdminSetUserDisabled(repository, context, "user_alice", true),
      handleAdminSetGroupArchived(repository, context, "group_1", true),
      handleAdminSetGroupDeleted(repository, context, "group_1", true),
      handleAdminListAuditLogs(repository, context),
      handleAdminListFeedback(repository, context),
      handleAdminSetFeedbackStatus(repository, context, "feedback_1", "done"),
      handleAdminListErrors(repository, context),
      handleAdminListErrorGroups(repository, context),
      handleAdminSetErrorGroupStatus(repository, context, "fp_1", "resolved"),
      handleAdminListAdmins(repository, context),
      handleAdminSetAdminRole(repository, context, "x@example.com", "admin"),
      handleAdminRemoveAdmin(repository, context, "11111111-1111-4111-8111-111111111111"),
    ]);

    for (const result of results) {
      expect(result.ok).toBe(false);
      expect(result.status).toBe(403);
      expect((result.body as { error: { code: string } }).error.code).toBe("ADMIN_FORBIDDEN");
    }
  });

  test("scan usage answers the requested window, not an arbitrary one", async () => {
    const wide = await handleAdminReceiptScanUsage(makeRepository(), context, "90");
    expect((wide.body as { days: number }).days).toBe(90);

    // A hand-typed p_days is a free knob for scanning the whole table, so
    // anything that is not one of the console's own buttons falls back to 30.
    const bogus = await handleAdminReceiptScanUsage(makeRepository(), context, "137");
    expect((bogus.body as { days: number }).days).toBe(30);
  });

  test("trends returns the requested window", async () => {
    const result = await handleAdminTrends(makeRepository(), context, "90");

    expect(result.ok).toBe(true);
    expect((result.body as { days: number }).days).toBe(90);
  });

  test("health returns the ops card payload", async () => {
    const result = await handleAdminHealth(makeRepository(), context);

    expect(result.ok).toBe(true);
    expect(result.body).toMatchObject({ feedback: { open: 1 } });
  });

  test("admin me returns the caller identity with their admin role", async () => {
    const result = await handleAdminMe(makeRepository(), context);

    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({
      user: {
        id: "user_admin",
        email: "admin@example.com",
        display_name: "Admin",
        avatar_url: null,
      },
      role: "owner",
    });
  });

  test("admin overview returns the repository aggregates", async () => {
    const result = await handleAdminOverview(makeRepository(), context);

    expect(result.ok).toBe(true);
    expect(result.body).toEqual(overview);
  });

  test("admin storage returns the bucket stats", async () => {
    const result = await handleAdminStorage(makeRepository(), context);

    expect(result.ok).toBe(true);
    expect(result.body).toEqual({ object_count: 13, total_bytes: 861938, orphan_count: 0, orphan_bytes: 0 });
  });

  test("list users forwards normalized query params to the repository", async () => {
    let received: { search: string; limit: number; offset: number } | null = null;
    const repository = makeRepository({
      async listUsers(search, limit, offset) {
        received = { search, limit, offset };
        return { total: 0, users: [] };
      },
    });

    const result = await handleAdminListUsers(repository, context, {
      search: "  alice ",
      limit: 999,
      offset: -5,
    });

    expect(result.ok).toBe(true);
    expect(received).toEqual({ search: "alice", limit: ADMIN_LIST_MAX_LIMIT, offset: 0 });
  });

  test("user detail returns 404 ADMIN_NOT_FOUND for unknown users", async () => {
    const repository = makeRepository({
      async getUserDetail() {
        return null;
      },
    });

    const result = await handleAdminUserDetail(repository, context, USER_ID);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect((result.body as { error: { code: string } }).error.code).toBe("ADMIN_NOT_FOUND");
  });

  test("list groups forwards the normalized filter to the repository", async () => {
    let received: string | null = null;
    const repository = makeRepository({
      async listGroups(_search, _limit, _offset, filter) {
        received = filter;
        return { total: 0, groups: [] };
      },
    });

    await handleAdminListGroups(repository, context, { filter: "deleted" });
    expect(received).toBe("deleted");

    await handleAdminListGroups(repository, context, { filter: "nonsense" });
    expect(received).toBe("all");
  });

  test("group detail passes the acting admin through, since the read is audited", async () => {
    let receivedActor = { id: "", email: "" };
    let receivedGroupId = "";
    const repository = makeRepository({
      async getGroupDetail(actor, groupId) {
        receivedActor = actor;
        receivedGroupId = groupId;
        return { group: groupDetailSummary, members: [], invites: [] };
      },
    });

    const result = await handleAdminGroupDetail(repository, context, GROUP_ID);

    expect(result.ok).toBe(true);
    expect(result.body).toEqual({ group: groupDetailSummary, members: [], invites: [] });
    expect(receivedActor).toEqual({ id: "user_admin", email: "admin@example.com" });
    expect(receivedGroupId).toBe(GROUP_ID);
  });

  test("a malformed (non-uuid) id is treated as not found, not passed to the RPC", async () => {
    let rpcCalled = false;
    const repository = makeRepository({
      async getGroupDetail() {
        rpcCalled = true;
        return { group: groupDetailSummary, members: [], invites: [] };
      },
      async getUserDetail() {
        rpcCalled = true;
        return { user: userSummary, groups: [] };
      },
      async listGroupExpenses() {
        rpcCalled = true;
        return { total: 0, expenses: [] };
      },
    });

    const results = await Promise.all([
      handleAdminGroupDetail(repository, context, "not-a-uuid"),
      handleAdminListGroupExpenses(repository, context, "123"),
      handleAdminUserDetail(repository, context, "../etc/passwd"),
    ]);

    for (const result of results) {
      expect(result.ok).toBe(false);
      expect(result.status).toBe(404);
      expect((result.body as { error: { code: string } }).error.code).toBe("ADMIN_NOT_FOUND");
    }
    // The guard short-circuits before the RPC, so PostgREST never sees the bad id.
    expect(rpcCalled).toBe(false);
  });

  test("group detail returns 404 ADMIN_NOT_FOUND for unknown groups", async () => {
    const repository = makeRepository({
      async getGroupDetail() {
        return null;
      },
    });

    const result = await handleAdminGroupDetail(repository, context, GROUP_ID);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect((result.body as { error: { code: string } }).error.code).toBe("ADMIN_NOT_FOUND");
  });

  test("group expenses pass the acting admin through, since the read is audited too", async () => {
    let receivedActor = { id: "", email: "" };
    const repository = makeRepository({
      async listGroupExpenses(actor) {
        receivedActor = actor;
        return { total: 0, expenses: [] };
      },
    });

    await handleAdminListGroupExpenses(repository, context, GROUP_ID);

    expect(receivedActor).toEqual({ id: "user_admin", email: "admin@example.com" });
  });

  test("group expenses return 404 ADMIN_NOT_FOUND for unknown groups", async () => {
    const repository = makeRepository({
      async listGroupExpenses() {
        return null;
      },
    });

    const result = await handleAdminListGroupExpenses(repository, context, GROUP_ID);

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect((result.body as { error: { code: string } }).error.code).toBe("ADMIN_NOT_FOUND");
  });

  test("group expenses default to hiding deleted rows and only include them when asked", async () => {
    let receivedIncludeDeleted: boolean | null = null;
    const repository = makeRepository({
      async listGroupExpenses(_actor, _groupId, _limit, _offset, includeDeleted) {
        receivedIncludeDeleted = includeDeleted;
        return { total: 0, expenses: [] };
      },
    });

    await handleAdminListGroupExpenses(repository, context, GROUP_ID);
    expect(receivedIncludeDeleted).toBe(false);

    await handleAdminListGroupExpenses(repository, context, GROUP_ID, { include_deleted: true });
    expect(receivedIncludeDeleted).toBe(true);
  });

  test("group expenses forward the group id and clamp the pagination", async () => {
    let received = { groupId: "", limit: 0, offset: 0 };
    const repository = makeRepository({
      async listGroupExpenses(_actor, groupId, limit, offset) {
        received = { groupId, limit, offset };
        return { total: 0, expenses: [] };
      },
    });

    await handleAdminListGroupExpenses(repository, context, GROUP_ID, { limit: 5000, offset: -3 });

    expect(received).toEqual({ groupId: GROUP_ID, limit: ADMIN_LIST_MAX_LIMIT, offset: 0 });
  });

  test("disable user passes the acting admin and returns the new state", async () => {
    let actorEmail = "";
    const repository = makeRepository({
      async setUserDisabled(actor, userId, disabled) {
        actorEmail = actor.email;
        return { id: userId, disabled_at: disabled ? "2026-07-11T00:00:00.000Z" : null };
      },
    });

    const result = await handleAdminSetUserDisabled(repository, context, "user_alice", true);

    expect(result.ok).toBe(true);
    expect(result.body).toEqual({ id: "user_alice", disabled_at: "2026-07-11T00:00:00.000Z" });
    expect(actorEmail).toBe("admin@example.com");
  });

  test("feedback status updates validate the status vocabulary", async () => {
    const valid = await handleAdminSetFeedbackStatus(makeRepository(), context, "feedback_1", "reviewing");
    expect(valid.ok).toBe(true);
    expect(valid.body).toEqual({ id: "feedback_1", status: "reviewing" });

    const invalid = await handleAdminSetFeedbackStatus(makeRepository(), context, "feedback_1", "archived");
    expect(invalid.ok).toBe(false);
    expect(invalid.status).toBe(400);
    expect((invalid.body as { error: { code: string } }).error.code).toBe("INVALID_FEEDBACK");
  });

  test("feedback list forwards the status filter, defaulting unknowns to all", async () => {
    let received: string | null = null;
    const repository = makeRepository({
      async listFeedback(_limit, _offset, status) {
        received = status;
        return { total: 0, feedback: [] };
      },
    });

    await handleAdminListFeedback(repository, context, { status: "reviewing" });
    expect(received).toBe("reviewing");

    await handleAdminListFeedback(repository, context, { status: "weird" });
    expect(received).toBe("all");
  });

  test("audit log listing returns the page for admins", async () => {
    const result = await handleAdminListAuditLogs(makeRepository(), context);

    expect(result.ok).toBe(true);
    expect((result.body as { total: number }).total).toBe(1);
  });

  test("audit listing forwards the trimmed search and a known action, dropping unknown actions", async () => {
    let received = { search: "", action: "", limit: 0, offset: 0 };
    const repository = makeRepository({
      async listAuditLogs(search, action, limit, offset) {
        received = { search, action, limit, offset };
        return { total: 0, logs: [] };
      },
    });

    await handleAdminListAuditLogs(repository, context, { search: "  alice  ", action: "group.delete" });
    expect(received).toMatchObject({ search: "alice", action: "group.delete" });

    // An action outside the known vocabulary collapses to "" (= any), never leaks through.
    await handleAdminListAuditLogs(repository, context, { action: "sql; drop" });
    expect(received.action).toBe("");
  });

  test("error listing forwards the trimmed search to the repository", async () => {
    let receivedSearch = "?";
    const repository = makeRepository({
      async listErrors(search) {
        receivedSearch = search;
        return { total: 0, errors: [] };
      },
    });

    await handleAdminListErrors(repository, context, { search: "  boom  " });
    expect(receivedSearch).toBe("boom");
  });

  test("error listing scopes to one group when a fingerprint is given", async () => {
    let received = "?";
    const repository = makeRepository({
      async listErrors(_search, fingerprint) {
        received = fingerprint;
        return { total: 0, errors: [] };
      },
    });

    await handleAdminListErrors(repository, context, { fingerprint: " fp_1 " });
    expect(received).toBe("fp_1");

    await handleAdminListErrors(repository, context, {});
    // Empty means "every group", not "a group whose fingerprint is the empty
    // string" - the RPC treats it as no filter.
    expect(received).toBe("");
  });

  test("an unknown error status filter falls back to all rather than matching nothing", () => {
    expect(normalizeErrorStatusFilter("open")).toBe("open");
    expect(normalizeErrorStatusFilter("resolved")).toBe("resolved");
    expect(normalizeErrorStatusFilter("wishful")).toBe("all");
    expect(normalizeErrorStatusFilter(undefined)).toBe("all");
  });

  test("error groups forward the normalized search and status", async () => {
    let received: { search: string; status: string } = { search: "?", status: "?" };
    const repository = makeRepository({
      async listErrorGroups(search, status) {
        received = { search, status };
        return { total: 0, groups: [] };
      },
    });

    await handleAdminListErrorGroups(repository, context, { search: "  boom  ", status: "resolved" });
    expect(received).toEqual({ search: "boom", status: "resolved" });
  });

  test("marking an error group refuses a status outside the vocabulary", async () => {
    const result = await handleAdminSetErrorGroupStatus(makeRepository(), context, "fp_1", "ignored");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(400);
    expect((result.body as { error: { code: string } }).error.code).toBe("MALFORMED_REQUEST");
  });

  test("marking an error group that no log row produces is a 404", async () => {
    const repository = makeRepository({
      async setErrorGroupStatus() {
        return null;
      },
    });

    const result = await handleAdminSetErrorGroupStatus(repository, context, "fp_gone", "resolved");

    expect(result.ok).toBe(false);
    expect(result.status).toBe(404);
    expect((result.body as { error: { code: string } }).error.code).toBe("ADMIN_NOT_FOUND");
  });

  test("marking an error group passes the authenticated actor, never a request value", async () => {
    let receivedActor = { id: "?", email: "?" };
    const repository = makeRepository({
      async setErrorGroupStatus(actor, fingerprint, status) {
        receivedActor = actor;
        return { fingerprint, status };
      },
    });

    const result = await handleAdminSetErrorGroupStatus(repository, context, "fp_1", "resolved");

    expect(result.ok).toBe(true);
    expect(receivedActor).toEqual({ id: "user_admin", email: "admin@example.com" });
  });

  test("group operations return 404 ADMIN_NOT_FOUND for unknown groups", async () => {
    const repository = makeRepository({
      async setGroupArchived() {
        return null;
      },
      async setGroupDeleted() {
        return null;
      },
    });

    const archived = await handleAdminSetGroupArchived(repository, context, "group_missing", true);
    const deleted = await handleAdminSetGroupDeleted(repository, context, "group_missing", true);

    for (const result of [archived, deleted]) {
      expect(result.ok).toBe(false);
      expect(result.status).toBe(404);
      expect((result.body as { error: { code: string } }).error.code).toBe("ADMIN_NOT_FOUND");
    }
  });
});

describe("admin role gating", () => {
  const supportContext = { user: { ...context.user, id: "user_support" } };

  function supportRepo(overrides: Partial<AdminRepository> = {}): AdminRepository {
    return makeRepository({
      async findAdminRole(userId) {
        return userId === "user_support" ? "support" : null;
      },
      ...overrides,
    });
  }

  test("a support role cannot perform destructive user/group writes", async () => {
    const repository = supportRepo();

    const results = await Promise.all([
      handleAdminSetUserDisabled(repository, supportContext, "user_x", true),
      handleAdminSetGroupArchived(repository, supportContext, "group_x", true),
      handleAdminSetGroupDeleted(repository, supportContext, "group_x", true),
    ]);

    for (const result of results) {
      expect(result.ok).toBe(false);
      expect(result.status).toBe(403);
      expect((result.body as { error: { code: string } }).error.code).toBe("ADMIN_FORBIDDEN");
    }
  });

  test("a support role can still read and triage feedback", async () => {
    const repository = supportRepo();

    const overview = await handleAdminOverview(repository, supportContext);
    const feedback = await handleAdminSetFeedbackStatus(repository, supportContext, "feedback_1", "done");

    expect(overview.ok).toBe(true);
    expect(feedback.ok).toBe(true);
  });

  test("managing admins is owner-only - support and admin roles are refused", async () => {
    for (const role of ["support", "admin"]) {
      const repository = makeRepository({
        async findAdminRole() {
          return role;
        },
      });

      const list = await handleAdminListAdmins(repository, context);
      const set = await handleAdminSetAdminRole(repository, context, "x@example.com", "admin");
      const remove = await handleAdminRemoveAdmin(repository, context, "11111111-1111-4111-8111-111111111111");

      for (const result of [list, set, remove]) {
        expect(result.ok).toBe(false);
        expect(result.status).toBe(403);
      }
    }
  });
});

describe("admin management", () => {
  test("owner lists admins", async () => {
    const result = await handleAdminListAdmins(makeRepository(), context);

    expect(result.ok).toBe(true);
    expect((result.body as { admins: unknown[] }).admins).toHaveLength(1);
  });

  test("set role validates email and role before hitting the repository", async () => {
    let called = false;
    const repository = makeRepository({
      async setAdminRole(_actor, _email, role) {
        called = true;
        return { ok: true, admin: { ...adminAccount, role } };
      },
    });

    const noEmail = await handleAdminSetAdminRole(repository, context, "  ", "admin");
    const badRole = await handleAdminSetAdminRole(repository, context, "x@example.com", "superuser");

    expect(noEmail.status).toBe(400);
    expect(badRole.status).toBe(400);
    expect(called).toBe(false);
  });

  test("set role maps repository failures to status codes", async () => {
    const notFound = await handleAdminSetAdminRole(
      makeRepository({ async setAdminRole() { return { ok: false, error: "USER_NOT_FOUND" }; } }),
      context,
      "ghost@example.com",
      "admin",
    );
    const lastOwner = await handleAdminSetAdminRole(
      makeRepository({ async setAdminRole() { return { ok: false, error: "LAST_OWNER" }; } }),
      context,
      "owner@example.com",
      "support",
    );

    expect(notFound.status).toBe(404);
    expect((notFound.body as { error: { code: string } }).error.code).toBe("ADMIN_NOT_FOUND");
    expect(lastOwner.status).toBe(409);
    expect((lastOwner.body as { error: { code: string } }).error.code).toBe("ADMIN_CONFLICT");
  });

  test("remove screens malformed ids and maps last-owner to 409", async () => {
    const badId = await handleAdminRemoveAdmin(makeRepository(), context, "not-a-uuid");
    const lastOwner = await handleAdminRemoveAdmin(
      makeRepository({ async removeAdmin() { return { ok: false, error: "LAST_OWNER" }; } }),
      context,
      "11111111-1111-4111-8111-111111111111",
    );

    expect(badId.status).toBe(404);
    expect(lastOwner.status).toBe(409);
    expect((lastOwner.body as { error: { code: string } }).error.code).toBe("ADMIN_CONFLICT");
  });
});

describe("normalizeGroupFilter", () => {
  test("accepts known filters and falls back to all", () => {
    expect(normalizeGroupFilter("deleted")).toBe("deleted");
    expect(normalizeGroupFilter("empty")).toBe("empty");
    expect(normalizeGroupFilter("archived")).toBe("archived");
    expect(normalizeGroupFilter(undefined)).toBe("all");
    expect(normalizeGroupFilter("bogus")).toBe("all");
  });
});

describe("normalizeAdminListQuery", () => {
  test("applies defaults for an empty query", () => {
    expect(normalizeAdminListQuery()).toEqual({ search: "", limit: ADMIN_LIST_DEFAULT_LIMIT, offset: 0 });
  });

  test("clamps limit and offset and trims search", () => {
    expect(normalizeAdminListQuery({ search: " bob ", limit: 0, offset: 10.9 })).toEqual({
      search: "bob",
      limit: 1,
      offset: 10,
    });
    expect(normalizeAdminListQuery({ limit: Number.NaN, offset: Number.NaN })).toEqual({
      search: "",
      limit: ADMIN_LIST_DEFAULT_LIMIT,
      offset: 0,
    });
  });
});

describe("resolveTrendDays", () => {
  test("accepts the windows the console offers", () => {
    expect(resolveTrendDays("7")).toBe(7);
    expect(resolveTrendDays("30")).toBe(30);
    expect(resolveTrendDays("90")).toBe(90);
  });

  test("anything else falls back to 30 rather than being clamped", () => {
    // An arbitrary p_days is a free knob for scanning the whole history, so
    // unknown values are not honoured at all.
    for (const raw of [undefined, "", "abc", "0", "-1", "365", "31", "1e9"]) {
      expect(resolveTrendDays(raw)).toBe(30);
    }
  });
});

describe("support actions", () => {
  const supportContext = { user: { ...context.user, id: "user_support" } };

  /** A console account whose rank is exactly `role`. */
  function repositoryAsRole(role: string, overrides: Partial<AdminRepository> = {}) {
    return makeRepository({ async findAdminRole() { return role; }, ...overrides });
  }

  test("expense writes and owner transfer need admin; support is refused", async () => {
    const repository = repositoryAsRole("support");

    const results = await Promise.all([
      handleAdminSetExpenseDeleted(repository, supportContext, GROUP_ID, EXPENSE_ID, true),
      handleAdminUpdateExpenseMeta(repository, supportContext, GROUP_ID, EXPENSE_ID, { title: "x" }),
      handleAdminTransferGroupOwner(repository, supportContext, GROUP_ID, MEMBER_ID),
      handleAdminExportUser(repository, supportContext, USER_ID),
    ]);

    for (const result of results) {
      expect(result.status).toBe(403);
    }
  });

  test("merge and delete need owner; admin is refused", async () => {
    const repository = repositoryAsRole("admin");

    const merge = await handleAdminMergeUsers(repository, supportContext, USER_ID, GROUP_ID);
    const remove = await handleAdminDeleteUser(repository, supportContext, USER_ID);

    expect(merge.status).toBe(403);
    expect(remove.status).toBe(403);
  });

  test("soft-deleting an expense returns the row and restoring clears deleted_at", async () => {
    const repository = makeRepository();

    const deleted = await handleAdminSetExpenseDeleted(repository, context, GROUP_ID, EXPENSE_ID, true);
    const restored = await handleAdminSetExpenseDeleted(repository, context, GROUP_ID, EXPENSE_ID, false);

    expect((deleted.body as { deleted_at: string | null }).deleted_at).not.toBeNull();
    expect((restored.body as { deleted_at: string | null }).deleted_at).toBeNull();
  });

  test("a non-uuid group or expense id is a 404 rather than reaching the RPC", async () => {
    let called = false;
    const repository = makeRepository({
      async setExpenseDeleted(_actor, _groupId, expenseId, deleted) {
        called = true;
        return { ...expenseWrite, id: expenseId, deleted_at: deleted ? "x" : null };
      },
    });

    const result = await handleAdminSetExpenseDeleted(repository, context, "group_1", EXPENSE_ID, true);

    expect(result.status).toBe(404);
    expect(called).toBe(false);
  });

  test("an expense the group does not have is a 404", async () => {
    const repository = makeRepository({ async setExpenseDeleted() { return null; } });
    const result = await handleAdminSetExpenseDeleted(repository, context, GROUP_ID, EXPENSE_ID, true);

    expect(result.status).toBe(404);
  });

  test("the meta patch carries only the fields that were sent", async () => {
    let seen: unknown;
    const repository = makeRepository({
      async updateExpenseMeta(_actor, _groupId, expenseId, patch) {
        seen = patch;
        return { ...expenseWrite, id: expenseId, ...patch };
      },
    });

    await handleAdminUpdateExpenseMeta(repository, context, GROUP_ID, EXPENSE_ID, {
      title: "  改過的標題  ",
      note: "",
      amount_minor: 999,
    } as Record<string, unknown>);

    // title trimmed, note kept as "" (that is how a note is cleared), and the
    // money field dropped entirely rather than passed through.
    expect(seen).toEqual({ title: "改過的標題", note: "" });
  });

  test("an empty patch is rejected instead of bumping the row for nothing", async () => {
    let called = false;
    const repository = makeRepository({
      async updateExpenseMeta(_actor, _groupId, expenseId) {
        called = true;
        return { ...expenseWrite, id: expenseId };
      },
    });

    const result = await handleAdminUpdateExpenseMeta(repository, context, GROUP_ID, EXPENSE_ID, {});

    expect(result.status).toBe(400);
    expect(called).toBe(false);
  });

  test("a malformed date is rejected before the RPC sees it", () => {
    expect(normalizeExpenseMetaPatch({ expense_date: "2026/08/01" }).ok).toBe(false);
    expect(normalizeExpenseMetaPatch({ expense_date: "2026-08-01" })).toEqual({
      ok: true,
      patch: { expense_date: "2026-08-01" },
    });
    expect(normalizeExpenseMetaPatch({ title: "   " }).ok).toBe(false);
  });

  test("transferring to an unclaimed member is a 409, not a 404", async () => {
    const repository = makeRepository({
      async transferGroupOwner() {
        return { ok: false, error: "MEMBER_NOT_CLAIMED" };
      },
    });

    const result = await handleAdminTransferGroupOwner(repository, context, GROUP_ID, MEMBER_ID);

    expect(result.status).toBe(409);
    expect((result.body as { error: { code: string } }).error.code).toBe("ADMIN_CONFLICT");
  });

  test("a merge blocked by a shared group answers 409 and names the groups", async () => {
    const repository = makeRepository({
      async mergeUsers() {
        return { ok: false, error: "GROUP_OVERLAP", groups: [{ group_id: GROUP_ID, name: "Trip" }] };
      },
    });

    const result = await handleAdminMergeUsers(repository, context, USER_ID, MEMBER_ID);

    expect(result.status).toBe(409);
    expect((result.body as { error: { details?: { groups: unknown[] } } }).error.details).toEqual({
      groups: [{ group_id: GROUP_ID, name: "Trip" }],
    });
  });

  test("an admin cannot merge or delete their own account away", async () => {
    const selfContext = { user: { ...context.user, id: USER_ID } };
    const repository = makeRepository({ async findAdminRole() { return "owner"; } });

    const merge = await handleAdminMergeUsers(repository, selfContext, USER_ID, MEMBER_ID);
    const remove = await handleAdminDeleteUser(repository, selfContext, USER_ID);

    expect(merge.status).toBe(409);
    expect(remove.status).toBe(409);
  });

  test("deleting the last console owner surfaces the RPC's refusal as 409", async () => {
    const repository = makeRepository({
      async deleteUser() {
        return { ok: false, reason: "last_admin_owner" };
      },
    });

    const result = await handleAdminDeleteUser(repository, context, USER_ID);

    expect(result.status).toBe(409);
    expect((result.body as { error: { message: string } }).error.message).toContain("owner");
  });

  test("export returns the document as-is", async () => {
    const result = await handleAdminExportUser(makeRepository(), context, USER_ID);

    expect(result.status).toBe(200);
    expect((result.body as { user: { id: string } }).user.id).toBe(USER_ID);
  });
});

describe("in-app notifications", () => {
  const FEEDBACK_ID = "55555555-5555-4555-8555-555555555555";

  test("sending needs admin; support is refused", async () => {
    const repository = makeRepository({ async findAdminRole() { return "support"; } });
    const result = await handleAdminSendNotification(repository, context, {
      audience: "all",
      title: "維護通知",
      body: "今晚 11 點會短暫維護。",
    });

    expect(result.status).toBe(403);
  });

  test("replying is support-level work, so support may do it", async () => {
    const repository = makeRepository({ async findAdminRole() { return "support"; } });
    const result = await handleAdminReplyFeedback(repository, context, FEEDBACK_ID, "已修好了，謝謝回報！");

    expect(result.status).toBe(200);
  });

  test("an audience that needs a target is rejected without one", () => {
    expect(normalizeNotificationRequest({ audience: "user", title: "t", body: "b" }).ok).toBe(false);
    expect(normalizeNotificationRequest({ audience: "group", title: "t", body: "b", target: "nope" }).ok).toBe(false);
    expect(normalizeNotificationRequest({ audience: "all", title: "t", body: "b" }).ok).toBe(true);
  });

  test("a target sent with a broadcast audience is dropped, not forwarded", () => {
    const normalized = normalizeNotificationRequest({
      audience: "all",
      title: "t",
      body: "b",
      target: "22222222-2222-4222-8222-222222222222",
    });

    expect(normalized).toEqual({
      ok: true,
      audience: "all",
      target: null,
      message: { title: "t", body: "b", link: null },
    });
  });

  test("a link has to be an in-app path", () => {
    // Anything that could navigate off-origin is refused rather than stripped:
    // silently dropping the destination would send a notification that does
    // not do what the sender wrote.
    for (const link of ["https://evil.example/x", "//evil.example", "\\evil", "group/1"]) {
      expect(normalizeNotificationRequest({ audience: "all", title: "t", body: "b", link }).ok).toBe(false);
    }

    const ok = normalizeNotificationRequest({ audience: "all", title: "t", body: "b", link: " /group/abc " });
    expect(ok.ok === true && ok.message.link).toBe("/group/abc");
  });

  test("an empty title or body never reaches the RPC", async () => {
    let called = false;
    const repository = makeRepository({
      async sendNotification() {
        called = true;
        return { ok: true, recipients: 1 };
      },
    });

    const result = await handleAdminSendNotification(repository, context, {
      audience: "all",
      title: "   ",
      body: "有內容",
    });

    expect(result.status).toBe(400);
    expect(called).toBe(false);
  });

  test("replying to signed-out feedback is a 409 that explains why", async () => {
    const repository = makeRepository({
      async replyFeedback() {
        return { ok: false, error: "NO_ACCOUNT" };
      },
    });

    const result = await handleAdminReplyFeedback(repository, context, FEEDBACK_ID, "回覆內容");

    expect(result.status).toBe(409);
    expect((result.body as { error: { code: string } }).error.code).toBe("ADMIN_CONFLICT");
  });

  test("an empty reply is rejected before the RPC", async () => {
    const result = await handleAdminReplyFeedback(makeRepository(), context, FEEDBACK_ID, "   ");
    expect(result.status).toBe(400);
  });
});

describe("master data", () => {
  test("reading is support-level, writing is not", async () => {
    const repository = makeRepository({ async findAdminRole() { return "support"; } });

    const read = await handleAdminGetCatalog(repository, context);
    const write = await handleAdminSaveCategory(repository, context, "medical", {
      label: "醫療",
      color: "#aa1122",
    });

    expect(read.status).toBe(200);
    expect(write.status).toBe(403);
  });

  test("a key that cannot be stored on an expense is refused", async () => {
    // "MEDICAL" is not here on purpose - it is lower-cased first, and the other
    // test pins that down.
    for (const key of ["3medical", "medical-care", "medical care", "", "a".repeat(40)]) {
      const result = await handleAdminSaveCategory(makeRepository(), context, key, {
        label: "醫療",
        color: "#aa1122",
      });
      expect(result.status).toBe(400);
    }
  });

  test("the colour has to be a hex the donut can draw", async () => {
    const bad = await handleAdminSaveCategory(makeRepository(), context, "medical", {
      label: "醫療",
      color: "red",
    });
    expect(bad.status).toBe(400);
  });

  test("the key is lower-cased and sort_order clamped before the RPC", async () => {
    let seen: unknown;
    const repository = makeRepository({
      async saveCategory(_actor, category) {
        seen = category;
        return { ok: true, category };
      },
    });

    await handleAdminSaveCategory(repository, context, "MEDICAL", {
      label: "  醫療  ",
      color: "#AA1122",
      sort_order: 99999,
    });

    expect(seen).toEqual({ key: "medical", label: "醫療", color: "#aa1122", sort_order: 9999, enabled: true });
  });

  test("switching off a currency people are still using is a 409", async () => {
    const repository = makeRepository({
      async saveCurrency() {
        return { ok: false, error: "CURRENCY_IN_USE" };
      },
    });

    const result = await handleAdminSaveCurrency(repository, context, "JPY", { label: "日圓", enabled: false });

    expect(result.status).toBe(409);
  });

  test("a rate override needs two different, well-formed codes", async () => {
    const repository = makeRepository();

    expect((await handleAdminSetRateOverride(repository, context, { base: "TWD", quote: "TWD", rate: 1 })).status).toBe(400);
    expect((await handleAdminSetRateOverride(repository, context, { base: "TW", quote: "JPY", rate: 1 })).status).toBe(400);
    // A zero rate would not fail loudly - it would value a currency at nothing.
    expect((await handleAdminSetRateOverride(repository, context, { base: "TWD", quote: "JPY", rate: 0 })).status).toBe(400);
    expect((await handleAdminSetRateOverride(repository, context, { base: "TWD", quote: "JPY", rate: "abc" })).status).toBe(400);
  });

  test("a null rate clears the override rather than being rejected as missing", async () => {
    let seen: unknown;
    const repository = makeRepository({
      async setRateOverride(_actor, pair) {
        seen = pair;
        return { ok: true, cleared: true, base: pair.base, quote: pair.quote };
      },
    });

    const result = await handleAdminSetRateOverride(repository, context, {
      base: "twd",
      quote: "jpy",
      rate: null,
      note: "  ",
    });

    expect(result.status).toBe(200);
    expect(seen).toEqual({ base: "TWD", quote: "JPY", rate: null, note: null });
  });
});

describe("managing what was sent", () => {
  const BATCH_ID = "66666666-6666-4666-8666-666666666666";

  test("reading the sent list is support-level, recalling is not", async () => {
    const repository = makeRepository({ async findAdminRole() { return "support"; } });

    const read = await handleAdminListSentNotifications(repository, context);
    const recall = await handleAdminDeleteNotificationBatch(repository, context, BATCH_ID);

    expect(read.status).toBe(200);
    expect(recall.status).toBe(403);
  });

  test("a batch that no longer exists is a 404", async () => {
    const repository = makeRepository({ async deleteNotificationBatch() { return null; } });
    const result = await handleAdminDeleteNotificationBatch(repository, context, BATCH_ID);

    expect(result.status).toBe(404);
  });

  test("a non-uuid batch id never reaches the RPC", async () => {
    let called = false;
    const repository = makeRepository({
      async deleteNotificationBatch() {
        called = true;
        return { ok: true as const, deleted: 1, already_read: 0, title: "x" };
      },
    });

    const result = await handleAdminDeleteNotificationBatch(repository, context, "not-a-uuid");

    expect(result.status).toBe(404);
    expect(called).toBe(false);
  });

  test("recalling reports how many had already read it", async () => {
    const result = await handleAdminDeleteNotificationBatch(makeRepository(), context, BATCH_ID);

    // The recall does not un-read those, so the number has to survive to the
    // caller rather than being folded into "deleted".
    expect(result.body).toMatchObject({ deleted: 4, already_read: 1 });
  });
});
