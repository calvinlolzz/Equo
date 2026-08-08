import { describe, expect, test, vi } from "vitest";
import { deleteRecurringRoute, listRecurringRoute, upsertRecurringRoute } from "./recurringRoutes.js";

/**
 * The routes are exercised through a fake PostgrestClient: everything that
 * matters here is the payload shaping and the sentinel-to-HTTP translation,
 * both of which sit between the HTTP layer and the RPC.
 */
function options(rpc: ReturnType<typeof vi.fn>) {
  return {
    client: { rpc } as never,
    verifier: {
      verify: async () => ({ sub: "google_1", email: "a@b.c", name: "A", picture: null }),
    } as never,
    idToken: "token",
  };
}

// buildAuthContext resolves the user from the token; stub the module boundary
// it goes through so these stay route-level tests.
vi.mock("../auth/routeContext.js", () => ({
  buildAuthContext: async () => ({ ok: true, context: { user: { id: "user_1" } } }),
}));

const rule = {
  id: "rec_1",
  group_id: "group_1",
  title: "房租",
  amount_minor: 1500000,
  currency: "TWD",
  category: "lodging",
  note: null,
  payer_member_id: "member_a",
  share_member_ids: ["member_a", "member_b"],
  day_of_month: 5,
  next_run_date: "2026-09-05",
  active: true,
  last_error: null,
  last_run_at: null,
};

const validBody = {
  title: "  房租  ",
  amount_minor: 1500000,
  payer_member_id: "member_a",
  share_member_ids: ["member_a", "member_b"],
  day_of_month: 5,
};

describe("listRecurringRoute", () => {
  test("returns the rules for a member", async () => {
    const rpc = vi.fn(async () => [rule]);

    const result = await listRecurringRoute(options(rpc), "group_1");

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ recurring: [rule] });
  });

  test("a null from the RPC is 403 — not-a-member and no-such-group are one answer", async () => {
    const rpc = vi.fn(async () => null);

    const result = await listRecurringRoute(options(rpc), "group_1");

    expect(result.status).toBe(403);
    expect(result.body).toMatchObject({ error: { code: "FORBIDDEN" } });
  });
});

describe("upsertRecurringRoute", () => {
  test("trims the title and creates with 201", async () => {
    const rpc = vi.fn(async () => rule);

    const result = await upsertRecurringRoute(options(rpc), "group_1", validBody);

    expect(result.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith(
      "upsert_recurring_expense",
      expect.objectContaining({
        p_group_id: "group_1",
        p_user_id: "user_1",
        p_payload: expect.objectContaining({ title: "房租", day_of_month: 5 }),
      }),
    );
  });

  test("an id makes it an update, answered 200", async () => {
    const rpc = vi.fn(async () => rule);

    const result = await upsertRecurringRoute(options(rpc), "group_1", { ...validBody, id: "rec_1" });

    expect(result.status).toBe(200);
  });

  test.each([
    ["no title", { ...validBody, title: "   " }],
    ["zero amount", { ...validBody, amount_minor: 0 }],
    ["fractional amount", { ...validBody, amount_minor: 10.5 }],
    ["no one to split with", { ...validBody, share_member_ids: [] }],
    ["day 0", { ...validBody, day_of_month: 0 }],
    ["day 29 — February has no 29th in most years", { ...validBody, day_of_month: 29 }],
    ["not an object", "nonsense"],
  ])("rejects %s before it reaches SQL", async (_label, body) => {
    const rpc = vi.fn(async () => rule);

    const result = await upsertRecurringRoute(options(rpc), "group_1", body);

    expect(result.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  test.each([
    ["NOT_A_GROUP_MEMBER", 403, "FORBIDDEN"],
    ["RECURRING_NOT_FOUND", 404, "NOT_FOUND"],
    ["INVALID_DAY_OF_MONTH", 400, "INVALID_DAY_OF_MONTH"],
    ["INVALID_SHARES", 400, "INVALID_SHARES"],
    ["INVALID_MEMBER: member_x", 400, "INVALID_MEMBER"],
  ])("translates the %s sentinel into %i", async (sentinel, status, code) => {
    const rpc = vi.fn(async () => {
      throw new Error(sentinel);
    });

    const result = await upsertRecurringRoute(options(rpc), "group_1", validBody);

    expect(result.status).toBe(status);
    expect(result.body).toMatchObject({ error: { code } });
  });

  test("an unrecognised failure is not swallowed as a 400", async () => {
    const rpc = vi.fn(async () => {
      throw new Error("connection reset");
    });

    await expect(upsertRecurringRoute(options(rpc), "group_1", validBody)).rejects.toThrow("connection reset");
  });
});

describe("deleteRecurringRoute", () => {
  test("deletes and reports it", async () => {
    const rpc = vi.fn(async () => true);

    const result = await deleteRecurringRoute(options(rpc), "group_1", "rec_1");

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ deleted: true });
  });

  test("a rule that was already gone is 404, not a silent success", async () => {
    const rpc = vi.fn(async () => false);

    const result = await deleteRecurringRoute(options(rpc), "group_1", "rec_1");

    expect(result.status).toBe(404);
  });
});
