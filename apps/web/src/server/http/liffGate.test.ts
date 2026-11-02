import { describe, expect, test, vi } from "vitest";
import { createFakePostgrest } from "../db/fakePostgrest.js";
import { createLiffToken, LIFF_SESSION_TTL_MS } from "../auth/liffToken.js";
import { createSessionToken } from "../auth/sessionToken.js";
import { filterGroupsForLiff, liffClaimsOf, liffGate, liffTokenOf, verifyLiffForRequest } from "./liffGate.js";
import type { HttpRuntimeRequest } from "./httpTypes.js";

const SECRET = "gate-secret";
const NOW = 5_000_000;
const LEDGER = "0b8f2c1e-5a41-4f0a-9d2e-3c6b7a8d9e10";
const OTHER = "11111111-2222-4333-8444-555555555555";
const HASH = "c".repeat(64);

const claims = {
  auth_user_id: "user_alice",
  google_sub: "google_alice",
  email: "alice@example.com",
  display_name: "Alice",
  ledger_id: LEDGER,
  line_sub_hash: HASH,
};

const token = createLiffToken(claims, SECRET, NOW);

function request(overrides: Partial<HttpRuntimeRequest> = {}): HttpRuntimeRequest {
  return {
    method: "GET",
    path: `/api/v1/groups/${LEDGER}/expenses`,
    headers: { authorization: `Bearer ${token}` },
    ...overrides,
  };
}

/** `client()` answers "live"; `client(x)` answers x, even when x is undefined. */
function client(...answer: [] | [unknown]) {
  const live: unknown = answer.length === 0 ? true : answer[0];

  return createFakePostgrest({
    rpc: (fn) => {
      if (fn === "line_liff_link_live") {
        if (live instanceof Error) throw live;
        return live;
      }
      throw new Error(`Unexpected rpc ${fn}`);
    },
  });
}

describe("liffTokenOf / liffClaimsOf", () => {
  test("finds a LIFF token wherever getAuthToken looks: bearer, view-as cookie, session cookie", () => {
    expect(liffTokenOf(request())).toBe(token);
    expect(liffTokenOf(request({ headers: { cookie: `equo_session=${token}` } }))).toBe(token);
    expect(liffTokenOf(request({ headers: { cookie: `equo_view_as=${token}` } }))).toBe(token);
  });

  test("is null for a normal session, a Google token, or nothing", () => {
    const session = createSessionToken(
      { auth_user_id: "u", google_sub: "g", email: "e@x.com", display_name: "D" },
      SECRET,
      NOW,
    );

    expect(liffTokenOf(request({ headers: { authorization: `Bearer ${session}` } }))).toBeNull();
    expect(liffTokenOf(request({ headers: { authorization: "Bearer google-token" } }))).toBeNull();
    expect(liffTokenOf(request({ headers: {} }))).toBeNull();
  });

  test("claims are only returned for a token that verifies", () => {
    expect(liffClaimsOf(request(), SECRET, NOW)).toMatchObject({ ledger_id: LEDGER, auth_user_id: "user_alice" });
    expect(liffClaimsOf(request(), "another-secret", NOW)).toBeNull();
    expect(liffClaimsOf(request(), undefined, NOW)).toBeNull();
    expect(liffClaimsOf(request(), SECRET, NOW + LIFF_SESSION_TTL_MS)).toBeNull();
  });
});

describe("verifyLiffForRequest - the route-level check, independent of the gate", () => {
  test("an in-scope request yields a resolved, LIFF-scoped identity", () => {
    expect(verifyLiffForRequest(token, request(), SECRET, NOW)).toMatchObject({
      resolved_user_id: "user_alice",
      scope: "liff",
      liff_ledger_id: LEDGER,
    });
  });

  // [MV]: let this fall through (or skip liffAllows) and a route reached around the gate serves a LINE session anything.
  test.each([
    ["DELETE", "/api/v1/me"],
    ["GET", "/api/v1/admin/me"],
    ["PATCH", `/api/v1/groups/${LEDGER}`],
    ["GET", `/api/v1/groups/${OTHER}/expenses`],
    ["POST", "/api/v1/groups"],
  ] as const)("refuses %s %s even though the token is genuine", (method, path) => {
    expect(verifyLiffForRequest(token, request({ method, path }), SECRET, NOW)).toBeNull();
  });

  test("refuses an expired, foreign or unsigned token, and a deployment with no secret", () => {
    expect(verifyLiffForRequest(token, request(), SECRET, NOW + LIFF_SESSION_TTL_MS)).toBeNull();
    expect(verifyLiffForRequest(token, request(), "another-secret", NOW)).toBeNull();
    expect(verifyLiffForRequest("equoL1.a.b", request(), SECRET, NOW)).toBeNull();
    expect(verifyLiffForRequest(token, request(), undefined, NOW)).toBeNull();
  });
});

describe("liffGate", () => {
  const gate = (c: ReturnType<typeof client>, req = request(), now = NOW) =>
    liffGate({ client: c, sessionSecret: SECRET, now }, req);

  test("does nothing for a request that carries no LIFF token, and asks the database nothing", async () => {
    const c = client();

    expect(await gate(c, request({ headers: { authorization: "Bearer google-token" } }))).toBeNull();
    expect(await gate(c, request({ headers: {} }))).toBeNull();
    expect(c.calls).toEqual([]);
  });

  test("lets a valid, in-scope, live request through, after exactly one liveness check", async () => {
    const c = client();

    expect(await gate(c)).toBeNull();
    expect(c.calls).toEqual([
      { op: "rpc", fn: "line_liff_link_live", args: { p_user: "user_alice", p_ledger: LEDGER, p_line_sub_hash: HASH } },
    ]);
  });

  test("401 for an invalid or expired token, without touching the database", async () => {
    const c = client();

    for (const req of [
      request({ headers: { authorization: "Bearer equoL1.junk.junk" } }),
      request({ headers: { authorization: `Bearer ${token}x` } }),
    ]) {
      const response = await gate(c, req);
      expect(response?.status).toBe(401);
      expect((response?.body as { error: { code: string } }).error.code).toBe("UNAUTHENTICATED");
    }

    expect((await gate(c, request(), NOW + LIFF_SESSION_TTL_MS))?.status).toBe(401);
    expect(await liffGate({ client: c, sessionSecret: undefined, now: NOW }, request())).toMatchObject({ status: 401 });
    expect(c.calls).toEqual([]);
  });

  test("403 LIFF_SCOPE outside the allowlist, before the database is asked anything", async () => {
    const c = client();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await gate(c, request({ method: "DELETE", path: "/api/v1/me" }));

    expect(response?.status).toBe(403);
    expect((response?.body as { error: { code: string } }).error.code).toBe("LIFF_SCOPE");
    expect(c.calls).toEqual([]);
    warn.mockRestore();
  });

  test("the scope log names the method and path with ids blanked, and never the token", async () => {
    const c = client();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await gate(c, request({ method: "PATCH", path: `/api/v1/groups/${LEDGER}` }));

    const logged = warn.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(logged).toContain("PATCH /api/v1/groups/:id");
    expect(logged).not.toContain(LEDGER);
    expect(logged).not.toContain(token);
    warn.mockRestore();
  });

  // [MV]: drop the liveness check and unlinking leaves the token working until it expires.
  test.each([false, null, undefined, "true", 1, {}, []])("401 when the link is no longer live (database said %j)", async (answer) => {
    const response = await gate(client(answer));

    expect(response?.status).toBe(401);
    expect((response?.body as { error: { code: string } }).error.code).toBe("UNAUTHENTICATED");
  });

  test("503 LINE_UNAVAILABLE when the liveness check itself fails - fail closed, retryable", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await gate(client(new Error("connection refused")));

    expect(response?.status).toBe(503);
    expect((response?.body as { error: { code: string } }).error.code).toBe("LINE_UNAVAILABLE");
    error.mockRestore();
  });

  test("a LIFF token in a cookie is gated exactly like one in the Authorization header", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const cookie = request({ headers: { cookie: `equo_session=${token}` }, method: "DELETE", path: "/api/v1/me" });

    expect((await gate(client(), cookie))?.status).toBe(403);
    expect((await gate(client(false), request({ headers: { cookie: `equo_session=${token}` } })))?.status).toBe(401);
    warn.mockRestore();
  });

  test("never logs the token, the user id, or the hash", async () => {
    const logs = [vi.spyOn(console, "error"), vi.spyOn(console, "warn"), vi.spyOn(console, "log")].map((spy) =>
      spy.mockImplementation(() => undefined),
    );

    await gate(client(new Error("boom")));
    await gate(client(), request({ method: "DELETE", path: "/api/v1/me" }));

    const logged = logs.flatMap((spy) => spy.mock.calls.map((call) => call.join(" "))).join("\n");
    for (const secret of [token, HASH, "user_alice", "alice@example.com"]) {
      expect(logged).not.toContain(secret);
    }
    logs.forEach((spy) => spy.mockRestore());
  });
});

describe("filterGroupsForLiff", () => {
  const groups = [
    { id: LEDGER, name: "我的帳本", kind: "personal" },
    { id: OTHER, name: "Tokyo Trip", kind: "shared" },
    { id: "group_3", name: "Osaka" },
  ];

  test("keeps only the token's ledger", () => {
    expect(filterGroupsForLiff({ groups }, LEDGER)).toEqual({ groups: [groups[0]] });
  });

  test("empties the list when the ledger is not in it, or the id is missing", () => {
    expect(filterGroupsForLiff({ groups }, "nope")).toEqual({ groups: [] });
    expect(filterGroupsForLiff({ groups }, "")).toEqual({ groups: [] });
  });

  test("anything that is not a list of groups becomes an empty list, never a pass-through", () => {
    for (const body of [null, undefined, {}, { groups: "x" }, { groups: { id: LEDGER } }, "str", []]) {
      expect(filterGroupsForLiff(body, LEDGER), JSON.stringify(body)).toEqual({ groups: [] });
    }
  });

  test("drops malformed rows instead of throwing on them", () => {
    expect(filterGroupsForLiff({ groups: [null, "x", { id: LEDGER }] }, LEDGER)).toEqual({ groups: [{ id: LEDGER }] });
  });
});
