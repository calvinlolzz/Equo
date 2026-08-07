import { describe, expect, test, vi } from "vitest";
import { handleGetSpendBreakdown, parseSpendPeriod } from "./spend.js";
import type { SpendBreakdownRecord, SpendRepository } from "../repositories/spendRepository.js";
import type { AuthenticatedContext } from "../auth/session.js";

const context = { user: { id: "user_1" } } as AuthenticatedContext;

const breakdown: SpendBreakdownRecord = {
  period_kind: "year",
  period_key: "2026",
  currency: "TWD",
  periods: [{ key: "2026", total_minor: 725000 }],
  group_total_minor: 725000,
  personal_total_minor: 300000,
  by_category: [{ category: "general", group_total_minor: 725000, personal_total_minor: 300000 }],
};

function repositoryReturning(result: SpendBreakdownRecord | null) {
  const getSpendBreakdown = vi.fn(async () => result);
  return { repository: { getSpendBreakdown } satisfies SpendRepository, getSpendBreakdown };
}

describe("parseSpendPeriod", () => {
  test("defaults to years and accepts the two key shapes", () => {
    expect(parseSpendPeriod(undefined, undefined)).toEqual({ periodKind: "year", periodKey: null });
    expect(parseSpendPeriod("year", "2024")).toEqual({ periodKind: "year", periodKey: "2024" });
    expect(parseSpendPeriod("month", "2026-08")).toEqual({ periodKind: "month", periodKey: "2026-08" });
  });

  test("folds an unknown kind to years rather than erroring", () => {
    expect(parseSpendPeriod("decade", "2024")).toEqual({ periodKind: "year", periodKey: "2024" });
  });

  test("drops a key that does not match its kind, so the server picks the newest period", () => {
    expect(parseSpendPeriod("year", "2026-08").periodKey).toBeNull();
    expect(parseSpendPeriod("month", "2026").periodKey).toBeNull();
    expect(parseSpendPeriod("month", "2026-13").periodKey).toBeNull();
    expect(parseSpendPeriod("year", "'; drop table expenses; --").periodKey).toBeNull();
  });
});

describe("handleGetSpendBreakdown", () => {
  test("passes the parsed period through to the repository", async () => {
    const { repository, getSpendBreakdown } = repositoryReturning(breakdown);

    const result = await handleGetSpendBreakdown(repository, context, "group_1", { kind: "month", key: "2026-08" });

    expect(getSpendBreakdown).toHaveBeenCalledWith("user_1", "group_1", "month", "2026-08");
    expect(result.ok).toBe(true);
    expect(result.status).toBe(200);
    expect(result.body).toEqual(breakdown);
  });

  test("normalises a bad key to null before it reaches SQL", async () => {
    const { repository, getSpendBreakdown } = repositoryReturning(breakdown);

    await handleGetSpendBreakdown(repository, context, "group_1", { kind: "month", key: "whenever" });

    expect(getSpendBreakdown).toHaveBeenCalledWith("user_1", "group_1", "month", null);
  });

  test("a null from the RPC is 403 - non-member and missing group are one answer", async () => {
    const { repository } = repositoryReturning(null);

    const result = await handleGetSpendBreakdown(repository, context, "group_1", {});

    expect(result.ok).toBe(false);
    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ error: { code: "FORBIDDEN" } });
  });
});
