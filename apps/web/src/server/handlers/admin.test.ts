import { describe, expect, test } from "vitest";
import type { AdminRepository } from "../repositories/adminRepository.js";
import {
  ADMIN_LIST_DEFAULT_LIMIT,
  ADMIN_LIST_MAX_LIMIT,
  handleAdminListAuditLogs,
  handleAdminListGroups,
  handleAdminListUsers,
  handleAdminMe,
  handleAdminOverview,
  handleAdminSetGroupArchived,
  handleAdminSetGroupDeleted,
  handleAdminSetUserDisabled,
  handleAdminUserDetail,
  normalizeAdminListQuery,
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

function makeRepository(overrides: Partial<AdminRepository> = {}): AdminRepository {
  return {
    async findAdminRole(userId) {
      return userId === "user_admin" ? "owner" : null;
    },
    async getOverview() {
      return overview;
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
      handleAdminSetUserDisabled(repository, context, "user_alice", true),
      handleAdminSetGroupArchived(repository, context, "group_1", true),
      handleAdminSetGroupDeleted(repository, context, "group_1", true),
      handleAdminListAuditLogs(repository, context),
    ]);

    for (const result of results) {
      expect(result.ok).toBe(false);
      expect(result.status).toBe(403);
      expect((result.body as { error: { code: string } }).error.code).toBe("ADMIN_FORBIDDEN");
    }
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

    const result = await handleAdminUserDetail(repository, context, "user_missing");

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

  test("audit log listing returns the page for admins", async () => {
    const result = await handleAdminListAuditLogs(makeRepository(), context);

    expect(result.ok).toBe(true);
    expect((result.body as { total: number }).total).toBe(1);
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
