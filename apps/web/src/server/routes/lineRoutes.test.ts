import { describe, expect, test } from "vitest";
import { createFakePostgrest } from "../db/fakePostgrest.js";
import { sha256Hex } from "../line/lineCrypto.js";
import { getMyLineLinkRoute, startLineLinkRoute, unlinkMyLineRoute } from "./lineRoutes.js";

const verifier = async (idToken: string) => ({
  auth_user_id: idToken,
  google_sub: idToken,
  email: "alice@example.com",
  display_name: "Alice",
  resolved_user_id: idToken,
});

const unauthenticatedVerifier = async () => null;

function makeClient(rpcResult: Record<string, unknown> = {}) {
  return createFakePostgrest({
    select: (table) => (table === "users" ? [{ id: "user_alice", deleted_at: null }] : []),
    rpc: (fn) => {
      if (fn in rpcResult) return rpcResult[fn];
      throw new Error(`unexpected rpc ${fn}`);
    },
  });
}

const VALID_TOKEN = "abcd1234efgh5678";

describe("startLineLinkRoute", () => {
  test("400s a malformed link_token without authenticating or calling the RPC", async () => {
    const client = makeClient();
    const result = await startLineLinkRoute({ client, verifier, idToken: "user_alice" }, { link_token: "short" });

    expect(result.status).toBe(400);
    const body = result.body as { issues: Array<{ code: string }> };
    expect(body.issues[0].code).toBe("MALFORMED_REQUEST");
    expect(client.calls).toHaveLength(0);
  });

  test("400s a missing link_token", async () => {
    const client = makeClient();
    const result = await startLineLinkRoute({ client, verifier, idToken: "user_alice" }, {});
    expect(result.status).toBe(400);
  });

  test("401s an unauthenticated caller without calling the RPC", async () => {
    const client = makeClient();
    const result = await startLineLinkRoute(
      { client, verifier: unauthenticatedVerifier, idToken: "" },
      { link_token: VALID_TOKEN },
    );

    expect(result.status).toBe(401);
    expect(client.calls).toHaveLength(0);
  });

  test("410s with LINE_LINK_EXPIRED when the token is unknown/used/expired", async () => {
    const client = makeClient({ line_attach_link_request: { ok: false, reason: "expired" } });
    const result = await startLineLinkRoute({ client, verifier, idToken: "user_alice" }, { link_token: VALID_TOKEN });

    expect(result.status).toBe(410);
    const body = result.body as { error: { code: string } };
    expect(body.error.code).toBe("LINE_LINK_EXPIRED");
  });

  test("200s already_linked:true without a redirect when the pair is already linked", async () => {
    const client = makeClient({ line_attach_link_request: { ok: true, already_linked: true } });
    const result = await startLineLinkRoute({ client, verifier, idToken: "user_alice" }, { link_token: VALID_TOKEN });

    expect(result.status).toBe(200);
    expect(result.ok && result.body).toEqual({ already_linked: true });
  });

  test("success: redirect_url points at LINE's accountLink dialog and the nonce hash matches what was sent to the RPC", async () => {
    const client = makeClient({
      line_attach_link_request: { ok: true, already_linked: false, currently_linked: false },
    });

    const result = await startLineLinkRoute({ client, verifier, idToken: "user_alice" }, { link_token: VALID_TOKEN });

    expect(result.status).toBe(200);
    if (!result.ok) throw new Error("expected success");
    const body = result.body as { redirect_url: string; currently_linked: boolean };
    expect(body.redirect_url.startsWith("https://access.line.me/dialog/bot/accountLink?linkToken=")).toBe(true);
    expect(body.currently_linked).toBe(false);

    const url = new URL(body.redirect_url);
    const nonce = url.searchParams.get("nonce")!;
    const linkTokenInUrl = url.searchParams.get("linkToken")!;
    expect(linkTokenInUrl).toBe(VALID_TOKEN);

    const call = client.rpcCall("line_attach_link_request");
    expect(call?.args.p_nonce_hash).toBe(sha256Hex(nonce));
    expect(call?.args.p_link_token_hash).toBe(sha256Hex(VALID_TOKEN));
    expect(call?.args.p_user).toBe("user_alice");
  });

  // [MV]: the raw token and the raw nonce must never reach an RPC arg -
  // only their hashes. If a future edit passes either raw value through,
  // this goes red.
  test("the raw token and the raw nonce never appear in any RPC call", async () => {
    const client = makeClient({
      line_attach_link_request: { ok: true, already_linked: false, currently_linked: false },
    });

    const result = await startLineLinkRoute({ client, verifier, idToken: "user_alice" }, { link_token: VALID_TOKEN });
    if (!result.ok) throw new Error("expected success");
    const body = result.body as { redirect_url: string };
    const nonce = new URL(body.redirect_url).searchParams.get("nonce")!;

    for (const call of client.calls) {
      expect(JSON.stringify(call)).not.toContain(VALID_TOKEN);
      expect(JSON.stringify(call)).not.toContain(nonce);
    }
  });

  test("defaults locale to zh-Hant when absent or not a known locale", async () => {
    const client = makeClient({
      line_attach_link_request: { ok: true, already_linked: false, currently_linked: false },
    });

    await startLineLinkRoute({ client, verifier, idToken: "user_alice" }, { link_token: VALID_TOKEN, locale: "fr" });

    expect(client.rpcCall("line_attach_link_request")?.args.p_locale).toBe("zh-Hant");
  });

  test("accepts a valid locale as given", async () => {
    const client = makeClient({
      line_attach_link_request: { ok: true, already_linked: false, currently_linked: false },
    });

    await startLineLinkRoute({ client, verifier, idToken: "user_alice" }, { link_token: VALID_TOKEN, locale: "en" });

    expect(client.rpcCall("line_attach_link_request")?.args.p_locale).toBe("en");
  });
});

describe("getMyLineLinkRoute", () => {
  test("401s an unauthenticated caller", async () => {
    const client = makeClient();
    const result = await getMyLineLinkRoute({ client, verifier: unauthenticatedVerifier, idToken: "" });
    expect(result.status).toBe(401);
  });

  test("reports linked:false when there is no row", async () => {
    const client = createFakePostgrest({
      select: (table) => (table === "users" ? [{ id: "user_alice", deleted_at: null }] : []),
    });
    const result = await getMyLineLinkRoute({ client, verifier, idToken: "user_alice" });
    expect(result.status).toBe(200);
    expect(result.ok && result.body).toEqual({ linked: false, linked_at: null });
  });

  test("reports linked:true with the linked_at timestamp when a row exists", async () => {
    const client = createFakePostgrest({
      select: (table) =>
        table === "users" ? [{ id: "user_alice", deleted_at: null }] : [{ linked_at: "2026-09-29T00:00:00Z" }],
    });
    const result = await getMyLineLinkRoute({ client, verifier, idToken: "user_alice" });
    expect(result.status).toBe(200);
    expect(result.ok && result.body).toEqual({ linked: true, linked_at: "2026-09-29T00:00:00Z" });
  });
});

describe("unlinkMyLineRoute", () => {
  test("401s an unauthenticated caller without calling the RPC", async () => {
    const client = makeClient();
    const result = await unlinkMyLineRoute({ client, verifier: unauthenticatedVerifier, idToken: "" });
    expect(result.status).toBe(401);
    expect(client.calls).toHaveLength(0);
  });

  // The route never takes an id from the request - unlinkMyLineRoute's only
  // parameter is RouteOptions, so the RPC's p_user can only ever be the
  // authenticated caller's own id.
  test("passes the authenticated caller's own id to line_unlink_user", async () => {
    const client = makeClient({ line_unlink_user: { ok: true, unlinked: true } });
    const result = await unlinkMyLineRoute({ client, verifier, idToken: "user_alice" });

    expect(result.status).toBe(200);
    expect(result.ok && result.body).toEqual({ ok: true, unlinked: true });
    expect(client.rpcCall("line_unlink_user")?.args).toEqual({ p_user: "user_alice" });
  });
});
