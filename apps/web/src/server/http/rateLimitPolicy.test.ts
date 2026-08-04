import { describe, expect, test } from "vitest";
import { rateLimitBucket, resolveRateLimitRule } from "./rateLimitPolicy.js";

describe("resolveRateLimitRule", () => {
  test("leaves reads uncapped", () => {
    expect(resolveRateLimitRule("GET", "/api/v1/groups")).toBeNull();
    expect(resolveRateLimitRule("GET", "/api/v1/groups/group_1")).toBeNull();
  });

  test("caps the anonymous error intake by itself", () => {
    const rule = resolveRateLimitRule("POST", "/api/v1/errors");

    // Anonymous, so it must be keyed by address - there is no user to charge.
    expect(rule).toMatchObject({ name: "errors", scope: "ip" });
  });

  test("caps the login endpoints by address, tightly", () => {
    const google = resolveRateLimitRule("POST", "/api/v1/auth/google");
    const supabase = resolveRateLimitRule("POST", "/api/v1/auth/supabase");

    expect(google).toMatchObject({ name: "auth", scope: "ip" });
    expect(supabase).toMatchObject({ name: "auth", scope: "ip" });
    // Tighter than the general write budget, since this is where credentials
    // would be tested.
    expect(google!.limit).toBeLessThan(resolveRateLimitRule("POST", "/api/v1/groups")!.limit);
  });

  test("caps feedback per user", () => {
    expect(resolveRateLimitRule("POST", "/api/v1/feedback")).toMatchObject({ name: "feedback", scope: "user" });
  });

  test("gives receipt recognition its own, much smaller budget than ordinary writes", () => {
    const scan = resolveRateLimitRule("POST", "/api/v1/receipts/scan");

    expect(scan).toMatchObject({ name: "receiptScan", scope: "user" });
    // Its own bucket so a burst of scans can't be charged against - or paid for
    // out of - the shared write budget; this endpoint costs real money per call.
    const write = resolveRateLimitRule("POST", "/api/v1/groups")!;
    expect(scan!.name).not.toBe(write.name);
    expect(scan!.limit / scan!.windowSeconds).toBeLessThan(write.limit / write.windowSeconds);
  });

  test("gives payment reminders their own budget", () => {
    const nudge = resolveRateLimitRule("POST", "/api/v1/groups/group_1/members/member_2/nudge");
    const write = resolveRateLimitRule("POST", "/api/v1/groups")!;

    expect(nudge).toMatchObject({ name: "nudge", scope: "user" });
    // The per-recipient cooldown lives in the database; this bucket is what
    // stops one account spraying reminders across every group it is in, so it
    // has to be far tighter than the general write budget.
    expect(nudge!.limit / nudge!.windowSeconds).toBeLessThan(write.limit / write.windowSeconds);
  });

  test.each([
    ["POST", "/api/v1/groups"],
    ["PATCH", "/api/v1/groups/group_1"],
    ["PUT", "/api/v1/groups/group_1/expenses/expense_1"],
    ["DELETE", "/api/v1/groups/group_1/expenses/expense_1"],
    ["POST", "/api/v1/groups/group_1/images"],
  ] as const)("every other write falls back to the general budget (%s %s)", (method, path) => {
    expect(resolveRateLimitRule(method, path)).toMatchObject({ name: "write", scope: "user" });
  });

  test("an unknown write path is still capped", () => {
    // Matched on method and path alone, never on whether the route exists, so
    // probing for endpoints spends the same budget as using them.
    expect(resolveRateLimitRule("POST", "/api/v1/nope/nothing/here")).toMatchObject({ name: "write" });
  });

  test("every rule has a positive limit and window", () => {
    const rules = [
      resolveRateLimitRule("POST", "/api/v1/errors"),
      resolveRateLimitRule("POST", "/api/v1/auth/google"),
      resolveRateLimitRule("POST", "/api/v1/feedback"),
      resolveRateLimitRule("POST", "/api/v1/groups"),
    ];

    for (const rule of rules) {
      expect(rule!.limit).toBeGreaterThan(0);
      expect(rule!.windowSeconds).toBeGreaterThan(0);
    }
  });
});

describe("rateLimitBucket", () => {
  const userRule = { name: "write", limit: 10, windowSeconds: 60, scope: "user" } as const;
  const ipRule = { name: "errors", limit: 10, windowSeconds: 60, scope: "ip" } as const;

  test("charges a user-scoped rule to the user", () => {
    expect(rateLimitBucket(userRule, { userId: "user_alice", ip: "1.2.3.4" })).toBe("write:u:user_alice");
  });

  test("a user-scoped rule falls back to the address when there is no session", () => {
    // Otherwise an unauthenticated caller would get an uncapped ride up to the
    // point the route turns it away.
    expect(rateLimitBucket(userRule, { userId: null, ip: "1.2.3.4" })).toBe("write:ip:1.2.3.4");
  });

  test("an ip-scoped rule ignores the session entirely", () => {
    expect(rateLimitBucket(ipRule, { userId: "user_alice", ip: "1.2.3.4" })).toBe("errors:ip:1.2.3.4");
  });

  test("rules keep separate budgets for the same identity", () => {
    // Filing feedback must not spend the budget for recording expenses.
    const a = rateLimitBucket(userRule, { userId: "user_alice", ip: "" });
    const b = rateLimitBucket({ ...userRule, name: "feedback" }, { userId: "user_alice", ip: "" });

    expect(a).not.toBe(b);
  });

  test("no user and no address means no bucket at all", () => {
    // A shared placeholder bucket would let one anonymous caller lock out
    // every other one.
    expect(rateLimitBucket(ipRule, { userId: null, ip: "" })).toBeNull();
    expect(rateLimitBucket(userRule, { userId: null, ip: "" })).toBeNull();
  });
});
