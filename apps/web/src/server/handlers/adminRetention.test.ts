import { describe, expect, test, vi } from "vitest";
import { handleAdminRetention } from "./admin.js";
import type { AdminRepository, AdminRetentionRecord } from "../repositories/adminRepository.js";
import type { AuthenticatedContext } from "../auth/session.js";

const context = { user: { id: "user_admin", email: "admin@example.com" } } as AuthenticatedContext;

const record: AdminRetentionRecord = {
  period: "week",
  total_users: 8,
  never_active: 3,
  cohorts: [{ start: "2026-06-29", size: 2, retained: [2, 2, 1] }],
};

function makeRepository(role: string | null, getRetention = vi.fn(async () => record)) {
  return { findAdminRole: async () => role, getRetention } as unknown as AdminRepository;
}

describe("handleAdminRetention", () => {
  test("any admin role can read it, like trends and health", async () => {
    for (const role of ["support", "admin", "owner"]) {
      const result = await handleAdminRetention(makeRepository(role), context, "week", "12");
      expect(result.status).toBe(200);
    }
  });

  test("a non-admin gets 403", async () => {
    const result = await handleAdminRetention(makeRepository(null), context, "week", "12");
    expect(result.status).toBe(403);
  });

  test("passes week and month through", async () => {
    const getRetention = vi.fn(async () => record);
    await handleAdminRetention(makeRepository("owner", getRetention), context, "month", "6");
    expect(getRetention).toHaveBeenCalledWith("month", 6);
  });

  test.each([
    ["an unknown period", "fortnight"],
    ["no period", undefined],
    ["an empty period", ""],
  ])("%s falls back to week rather than erroring", async (_label, period) => {
    // A query string on a dashboard. A typo should show the dashboard, not a
    // 400 that makes the page look broken.
    const getRetention = vi.fn(async () => record);
    const result = await handleAdminRetention(makeRepository("owner", getRetention), context, period, "12");

    expect(result.status).toBe(200);
    expect(getRetention).toHaveBeenCalledWith("week", 12);
  });

  test.each([
    ["not a number", "many"],
    ["zero", "0"],
    ["negative", "-4"],
    ["over the cap", "999"],
    ["fractional", "2.5"],
  ])("%s falls back to the default window", async (_label, periods) => {
    const getRetention = vi.fn(async () => record);
    await handleAdminRetention(makeRepository("owner", getRetention), context, "week", periods);
    expect(getRetention).toHaveBeenCalledWith("week", 12);
  });

  test("a valid window is honoured", async () => {
    const getRetention = vi.fn(async () => record);
    await handleAdminRetention(makeRepository("owner", getRetention), context, "week", "52");
    expect(getRetention).toHaveBeenCalledWith("week", 52);
  });

  test("carries never_active through, which is the number that matters at a small sample", async () => {
    const result = await handleAdminRetention(makeRepository("owner"), context, "week", "12");
    expect(result.ok && result.body.never_active).toBe(3);
    expect(result.ok && result.body.total_users).toBe(8);
  });
});
