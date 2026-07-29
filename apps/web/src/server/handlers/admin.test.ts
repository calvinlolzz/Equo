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
  normalizeAdminListQuery,
  normalizeErrorStatusFilter,
  normalizeGroupFilter,
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
