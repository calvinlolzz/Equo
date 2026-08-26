import { describe, expect, test } from "vitest";
import { blocksWrite, viewingAs, viewAsToken } from "./viewAs.js";
import { getAuthToken, type HttpRuntimeRequest } from "./httpTypes.js";
import { createSessionToken, createViewAsToken } from "../auth/sessionToken.js";

const SECRET = "test-secret";

const identity = {
  auth_user_id: "user_target",
  google_sub: "google_target",
  email: "target@example.com",
  display_name: "Target",
};

function request(overrides: Partial<HttpRuntimeRequest> = {}): HttpRuntimeRequest {
  return {
    method: "GET",
    path: "/api/v1/groups",
    headers: {},
    json: undefined,
    query: {},
    ...overrides,
  } as HttpRuntimeRequest;
}

function withCookies(cookies: string, overrides: Partial<HttpRuntimeRequest> = {}) {
  return request({ ...overrides, headers: { cookie: cookies, ...(overrides.headers ?? {}) } });
}

describe("which token the app authenticates with", () => {
  test("an ordinary session is used when there is no view-as cookie", () => {
    const session = createSessionToken(identity, SECRET);
    expect(getAuthToken(withCookies(`equo_session=${session}`))).toBe(session);
  });

  test("the view-as cookie wins while it is set", () => {
    // This one line is the whole feature: every read path resolves the caller
    // through getAuthToken, so preferring this token makes the entire app
    // render as the target user without a single route knowing why.
    const session = createSessionToken(identity, SECRET);
    const view = createViewAsToken(identity, "user_admin", SECRET);

    expect(getAuthToken(withCookies(`equo_session=${session}; equo_view_as=${view}`))).toBe(view);
  });

  test("the admin's own session is still there underneath", () => {
    // Separate cookies, so leaving the view is just dropping one of them - no
    // moment where a mistake signs the admin out of their own account.
    const session = createSessionToken(identity, SECRET);
    const view = createViewAsToken(identity, "user_admin", SECRET);
    const req = withCookies(`equo_session=${session}; equo_view_as=${view}`);

    expect(viewAsToken(req)).toBe(view);
    expect(req.headers.cookie).toContain(session);
  });
});

describe("viewingAs", () => {
  test("names the admin behind a view-as token", () => {
    const view = createViewAsToken(identity, "user_admin", SECRET);
    expect(viewingAs(withCookies(`equo_view_as=${view}`), SECRET)).toBe("user_admin");
  });

  test("an ordinary session is not view-as", () => {
    const session = createSessionToken(identity, SECRET);
    expect(viewingAs(withCookies(`equo_view_as=${session}`), SECRET)).toBeNull();
  });

  test("a token signed with another secret is rejected", () => {
    const forged = createViewAsToken(identity, "user_admin", "not-the-secret");
    expect(viewingAs(withCookies(`equo_view_as=${forged}`), SECRET)).toBeNull();
  });

  test("a tampered payload is rejected", () => {
    // Re-encoding the claim without re-signing must not work, or anybody could
    // hand themselves somebody else's identity.
    const view = createViewAsToken(identity, "user_admin", SECRET);
    const [version, payload, signature] = view.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    decoded.auth_user_id = "user_someone_else";
    const tampered = `${version}.${Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url")}.${signature}`;

    expect(viewingAs(withCookies(`equo_view_as=${tampered}`), SECRET)).toBeNull();
  });

  test("expires", () => {
    const issued = 1_000_000;
    const view = createViewAsToken(identity, "user_admin", SECRET, issued);

    expect(viewingAs(withCookies(`equo_view_as=${view}`), SECRET, issued + 14 * 60_000)).toBe("user_admin");
    // 15 minutes, not the session's seven days: a forgotten tab stops being a
    // live window into a stranger's ledger without anyone remembering.
    expect(viewingAs(withCookies(`equo_view_as=${view}`), SECRET, issued + 16 * 60_000)).toBeNull();
  });

  test("is null when the deployment has no signing secret", () => {
    const view = createViewAsToken(identity, "user_admin", SECRET);
    expect(viewingAs(withCookies(`equo_view_as=${view}`), undefined)).toBeNull();
  });
});

describe("the read-only gate", () => {
  const view = createViewAsToken(identity, "user_admin", SECRET);

  test.each([
    ["GET", "/api/v1/groups"],
    ["GET", "/api/v1/groups/g1"],
  ] as const)("reads are allowed (%s %s)", (method, path) => {
    expect(blocksWrite(withCookies(`equo_view_as=${view}`, { method, path }))).toBe(false);
  });

  test.each([
    ["POST", "/api/v1/groups/g1/expenses"],
    ["PUT", "/api/v1/groups/g1/expenses/e1"],
    ["DELETE", "/api/v1/groups/g1/expenses/e1"],
    ["PATCH", "/api/v1/me/avatar"],
    ["POST", "/api/v1/groups/g1/expenses/e1/comments"],
  ] as const)("writes are refused (%s %s)", (method, path) => {
    expect(blocksWrite(withCookies(`equo_view_as=${view}`, { method, path }))).toBe(true);
  });

  test("the admin console's own writes are refused too", () => {
    // An admin mid-view-as is holding somebody else's identity. "Disable this
    // user" issued from inside that is a confusing audit entry even where the
    // console would otherwise allow it.
    expect(
      blocksWrite(withCookies(`equo_view_as=${view}`, { method: "POST", path: "/api/v1/admin/users/u1/disabled" })),
    ).toBe(true);
  });

  test("LEAVING the view is allowed, or the exit would be the one locked door", () => {
    // The exit is a DELETE carrying the very cookie this gate reacts to. Same
    // shape of mistake as a maintenance mode that blocks its own off switch.
    expect(
      blocksWrite(withCookies(`equo_view_as=${view}`, { method: "DELETE", path: "/api/v1/admin/view-as" })),
    ).toBe(false);
  });

  test("an expired or forged cookie still cannot write", () => {
    // Fails CLOSED, unlike the maintenance gate: guessing wrong here writes to
    // a stranger's ledger under their name.
    const forged = createViewAsToken(identity, "user_admin", "not-the-secret");
    expect(
      blocksWrite(withCookies(`equo_view_as=${forged}`, { method: "POST", path: "/api/v1/groups/g1/expenses" })),
    ).toBe(true);
    expect(
      blocksWrite(withCookies("equo_view_as=garbage", { method: "POST", path: "/api/v1/groups/g1/expenses" })),
    ).toBe(true);
  });

  test("an ordinary session writes normally", () => {
    const session = createSessionToken(identity, SECRET);
    expect(
      blocksWrite(withCookies(`equo_session=${session}`, { method: "POST", path: "/api/v1/groups/g1/expenses" })),
    ).toBe(false);
  });

  test("no cookies at all is not view-as", () => {
    expect(blocksWrite(request({ method: "POST", path: "/api/v1/groups/g1/expenses" }))).toBe(false);
  });
});
