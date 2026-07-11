import { describe, expect, test } from "vitest";
import type { AdminRepository } from "../repositories/adminRepository.js";
import {
  ADMIN_LIST_DEFAULT_LIMIT,
  ADMIN_LIST_MAX_LIMIT,
  handleAdminListGroups,
  handleAdminListUsers,
  handleAdminMe,
  handleAdminOverview,
  handleAdminUserDetail,
  normalizeAdminListQuery,
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

  test("list groups succeeds for admins", async () => {
    const result = await handleAdminListGroups(makeRepository(), context, { search: "trip" });

    expect(result.ok).toBe(true);
    expect(result.body).toEqual({ total: 0, groups: [] });
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
