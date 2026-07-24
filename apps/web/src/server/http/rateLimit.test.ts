import { describe, expect, test, vi } from "vitest";
import { createFakePostgrest } from "../db/fakePostgrest.js";
import { createSessionToken } from "../auth/sessionToken.js";
import { enforceRateLimit } from "./rateLimit.js";
import type { HttpRuntimeRequest } from "./httpTypes.js";

const SECRET = "test-session-secret";

function request(overrides: Partial<HttpRuntimeRequest> = {}): HttpRuntimeRequest {
  return {
    method: "POST",
    path: "/api/v1/groups",
    headers: { "x-forwarded-for": "203.0.113.9" },
    ...overrides,
  };
}

/**
 * A real signed session cookie. The token encodes auth_user_id only, and
 * verifySessionToken hands it back as resolved_user_id — so that is the id the
 * bucket is keyed by. It is the stable per-account id, not a per-session one,
 * which is what makes it usable as a counter key at all.
 */
function sessionCookie(): string {
  const token = createSessionToken(
    {
      auth_user_id: "user_alice",
      google_sub: "sub_alice",
      email: "alice@example.com",
      display_name: "Alice",
    } as Parameters<typeof createSessionToken>[0],
    SECRET,
  );
  return `equo_session=${token}`;
}

/** A counter that always answers `allowed`, recording what it was asked. */
function allowingClient() {
  return createFakePostgrest({ rpc: () => ({ allowed: true, retry_after: 1 }) });
}

describe("enforceRateLimit", () => {
  test("does not count a read at all", async () => {
    const client = allowingClient();

    const decision = await enforceRateLimit({ client, sessionSecret: SECRET }, request({ method: "GET" }));

    expect(decision).toEqual({ allowed: true });
    // No round-trip: capping reads would put a database call on the app's
    // hottest path.
    expect(client.rpcCall("consume_rate_limit")).toBeUndefined();
  });

  test("charges a write to the logged-in user", async () => {
    const client = allowingClient();

    await enforceRateLimit({ client, sessionSecret: SECRET }, request({ headers: { cookie: sessionCookie() } }));

    expect(client.rpcCall("consume_rate_limit")?.args).toMatchObject({ p_bucket: "write:u:user_alice" });
  });

  test("charges an anonymous error report to its address", async () => {
    const client = allowingClient();

    await enforceRateLimit({ client, sessionSecret: SECRET }, request({ path: "/api/v1/errors" }));

    expect(client.rpcCall("consume_rate_limit")?.args).toMatchObject({ p_bucket: "errors:ip:203.0.113.9" });
  });

  test("takes only the first x-forwarded-for entry", async () => {
    const client = allowingClient();

    await enforceRateLimit(
      { client, sessionSecret: SECRET },
      request({ path: "/api/v1/errors", headers: { "x-forwarded-for": "198.51.100.7, 10.0.0.1, 10.0.0.2" } }),
    );

    expect(client.rpcCall("consume_rate_limit")?.args).toMatchObject({ p_bucket: "errors:ip:198.51.100.7" });
  });

  test("blocks with the counter's own retry hint once over the limit", async () => {
    const client = createFakePostgrest({ rpc: () => ({ allowed: false, retry_after: 42 }) });

    const decision = await enforceRateLimit({ client, sessionSecret: SECRET }, request());

    expect(decision).toEqual({ allowed: false, retryAfterSeconds: 42 });
  });

  test("never reports a retry hint of zero", async () => {
    // Retry-After: 0 reads as "go ahead now", which would turn a blocked
    // client into a tight retry loop against the endpoint it just overran.
    const client = createFakePostgrest({ rpc: () => ({ allowed: false, retry_after: 0 }) });

    const decision = await enforceRateLimit({ client, sessionSecret: SECRET }, request());

    expect(decision).toEqual({ allowed: false, retryAfterSeconds: 1 });
  });

  test("fails open when the counter is unreachable", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const client = createFakePostgrest({
      rpc: () => {
        throw new Error("connection refused");
      },
    });

    const decision = await enforceRateLimit({ client, sessionSecret: SECRET }, request());

    // A database blip must not become a site-wide 429 - that would be a worse
    // outage than the flood this guards against.
    expect(decision).toEqual({ allowed: true });
    // ...but a limiter that has quietly stopped limiting must be visible.
    expect(logged).toHaveBeenCalled();
    logged.mockRestore();
  });

  test("skips counting when there is neither a session nor an address", async () => {
    const client = allowingClient();

    const decision = await enforceRateLimit({ client, sessionSecret: SECRET }, request({ headers: {} }));

    expect(decision).toEqual({ allowed: true });
    expect(client.rpcCall("consume_rate_limit")).toBeUndefined();
  });

  test("a forged session token charges the address, not the claimed user", async () => {
    const client = allowingClient();

    await enforceRateLimit(
      { client, sessionSecret: SECRET },
      request({ headers: { cookie: "equo_session=not.a.real.token", "x-forwarded-for": "203.0.113.9" } }),
    );

    expect(client.rpcCall("consume_rate_limit")?.args).toMatchObject({ p_bucket: "write:ip:203.0.113.9" });
  });

  test("passes the rule's own limit and window through to the counter", async () => {
    const client = allowingClient();

    await enforceRateLimit({ client, sessionSecret: SECRET }, request({ path: "/api/v1/auth/google" }));

    const args = client.rpcCall("consume_rate_limit")?.args as { p_limit: number; p_window_seconds: number };
    expect(args.p_limit).toBeGreaterThan(0);
    expect(args.p_window_seconds).toBeGreaterThan(0);
  });
});
