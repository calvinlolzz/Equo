import { afterEach, describe, expect, test, vi } from "vitest";
import type { PostgrestClient } from "../db/postgrestClient.js";
import { LIFF_SESSION_TTL_MS, verifyLiffToken } from "../auth/liffToken.js";
import { verifySessionToken } from "../auth/sessionToken.js";
import { sha256Hex } from "../line/lineCrypto.js";
import type { LineIdTokenResult } from "../line/lineIdToken.js";
import { authLineRoute, liffConfigRoute } from "./lineLiffRoutes.js";

const SECRET = "session-secret";
const SUB = "U" + "a".repeat(32);
const NOW = 1_800_000_000_000;
const LEDGER = "0b8f2c1e-5a41-4f0a-9d2e-3c6b7a8d9e10";
const ID_TOKEN = "aaaa.bbbb.cccc";

const GOOD: LineIdTokenResult = {
  ok: true,
  claims: { iss: "https://access.line.me", sub: SUB, aud: "1234567890", exp: NOW / 1_000 + 3_000, iat: NOW / 1_000 - 60 },
};

const IDENTITY = {
  ok: true,
  user: { id: "user_alice", google_sub: "google_alice", email: "alice@example.com", display_name: "Alice", avatar_url: null },
  ledger_id: LEDGER,
  locale: "zh-Hant",
};

function setup(
  options: { identity?: unknown; limit?: unknown; verify?: LineIdTokenResult | Error; identityError?: Error; limitError?: Error } = {},
) {
  const rpcs: Array<{ fn: string; args: Record<string, unknown> }> = [];
  const client = {
    async rpc(fn: string, args: Record<string, unknown>) {
      rpcs.push({ fn, args });
      if (fn === "consume_rate_limit") {
        if (options.limitError) throw options.limitError;
        return options.limit ?? { allowed: true };
      }
      if (fn === "line_liff_identity") {
        if (options.identityError) throw options.identityError;
        return "identity" in options ? options.identity : IDENTITY;
      }
      throw new Error(`unexpected rpc ${fn}`);
    },
  } as unknown as PostgrestClient;
  const verifyIdToken = vi.fn(async (_idToken: string) => {
    if (options.verify instanceof Error) throw options.verify;
    return options.verify ?? GOOD;
  });

  return { client, rpcs, verifyIdToken, run: (body: unknown) => authLineRoute({ client, sessionSecret: SECRET, verifyIdToken, now: NOW }, body as never) };
}

const errorCode = (result: { body: unknown }) => (result.body as { error?: { code: string } }).error?.code;

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /auth/line - success", () => {
  test("answers with a LIFF token, the user, the ledger and the locale", async () => {
    const { run } = setup();

    const result = await run({ id_token: ID_TOKEN });

    expect(result.status).toBe(200);
    const session = (result.body as { session: Record<string, unknown> }).session;
    expect(Object.keys(session).sort()).toEqual(["expires_at", "ledger_id", "locale", "token", "user"]);
    expect(session.ledger_id).toBe(LEDGER);
    expect(session.locale).toBe("zh-Hant");
    expect(session.user).toEqual(IDENTITY.user);
    expect(session.expires_at).toBe(new Date(NOW + LIFF_SESSION_TTL_MS).toISOString());
  });

  test("the token verifies as a LIFF token for that user and ledger - and not as a session", async () => {
    const { run } = setup();

    const token = ((await run({ id_token: ID_TOKEN })).body as { session: { token: string } }).session.token;
    const claims = verifyLiffToken(token, SECRET, NOW);

    expect(claims).toMatchObject({ scope: "liff", auth_user_id: "user_alice", ledger_id: LEDGER });
    expect(verifySessionToken(token, SECRET, NOW)).toBeNull();
  });

  test("the token carries a hash of the LINE id, never the id", async () => {
    const { run } = setup();

    const token = ((await run({ id_token: ID_TOKEN })).body as { session: { token: string } }).session.token;

    expect(verifyLiffToken(token, SECRET, NOW)?.line_sub_hash).toBe(sha256Hex(SUB));
    expect(token).not.toContain(SUB);
    expect(Buffer.from(token.split(".")[1], "base64url").toString("utf8")).not.toContain(SUB);
  });

  test("the response carries no cookie of any kind and is not cacheable", async () => {
    const { run } = setup();

    const result = await run({ id_token: ID_TOKEN });
    const names = Object.keys(result.headers).map((name) => name.toLowerCase());

    // [MV] a Set-Cookie here would shadow the desktop browser's real session.
    expect(names).not.toContain("set-cookie");
    expect(result.headers["cache-control"]).toBe("no-store");
  });

  test("asks the database about the VERIFIED sub, with no user or ledger of the caller's choosing", async () => {
    const { run, rpcs } = setup();

    await run({ id_token: ID_TOKEN, user_id: "user_bob", ledger_id: "x", sub: "U" + "b".repeat(32), p_line_user_id: "U" + "c".repeat(32) });

    const lookup = rpcs.find((call) => call.fn === "line_liff_identity");
    expect(lookup?.args).toEqual({ p_line_user_id: SUB });
  });

  test("a user without an avatar gets a token without one", async () => {
    const { run } = setup();

    const token = ((await run({ id_token: ID_TOKEN })).body as { session: { token: string } }).session.token;

    expect(verifyLiffToken(token, SECRET, NOW)).not.toHaveProperty("avatar_url");
  });

  test("an avatar is carried through", async () => {
    const { run } = setup({ identity: { ...IDENTITY, user: { ...IDENTITY.user, avatar_url: "https://img.example.com/a.png" } } });

    const token = ((await run({ id_token: ID_TOKEN })).body as { session: { token: string } }).session.token;

    expect(verifyLiffToken(token, SECRET, NOW)?.avatar_url).toBe("https://img.example.com/a.png");
  });

  test("English locale is passed through", async () => {
    const { run } = setup({ identity: { ...IDENTITY, locale: "en" } });

    expect(((await run({ id_token: ID_TOKEN })).body as { session: { locale: string } }).session.locale).toBe("en");
  });
});

describe("POST /auth/line - the request", () => {
  test.each([
    ["no body", undefined],
    ["null body", null],
    ["no id_token", {}],
    ["a numeric id_token", { id_token: 12345 }],
    ["an object id_token", { id_token: { a: 1 } }],
    ["an array id_token", { id_token: ["a.b.c"] }],
    ["an empty id_token", { id_token: "" }],
  ])("%s is a 400 and LINE is never asked", async (_label, body) => {
    const { run, verifyIdToken } = setup();

    const result = await run(body);

    expect(result.status).toBe(400);
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  test.each([
    ["not a JWT", "hello"],
    ["two parts", "aaa.bbb"],
    ["four parts", "a.b.c.d"],
    ["spaces", "aa a.bbb.ccc"],
    ["a newline", "aaa.bbb.ccc\n"],
    ["a form-injection attempt", "aaa.bbb.ccc&client_id=other"],
    ["empty segment", "aaa..ccc"],
    ["over the size cap", `${"a".repeat(2_000)}.${"b".repeat(2_000)}.${"c".repeat(200)}`],
  ])("%s is refused as invalid before LINE is asked", async (_label, idToken) => {
    const { run, verifyIdToken } = setup();

    const result = await run({ id_token: idToken });

    expect(result.status).toBe(401);
    expect(errorCode(result)).toBe("LINE_ID_TOKEN_INVALID");
    expect(verifyIdToken).not.toHaveBeenCalled();
  });

  test("the token goes to the verifier exactly as sent", async () => {
    const { run, verifyIdToken } = setup();

    await run({ id_token: ID_TOKEN });

    expect(verifyIdToken).toHaveBeenCalledWith(ID_TOKEN);
  });
});

describe("POST /auth/line - LINE's verdict", () => {
  test.each([
    [{ ok: false, reason: "invalid" } as const, 401, "LINE_ID_TOKEN_INVALID"],
    [{ ok: false, reason: "expired" } as const, 401, "LINE_ID_TOKEN_EXPIRED"],
    [{ ok: false, reason: "unavailable" } as const, 503, "LINE_UNAVAILABLE"],
  ])("%j is %i %s, and the database is not asked", async (verify, status, code) => {
    const { run, rpcs } = setup({ verify });

    const result = await run({ id_token: ID_TOKEN });

    expect(result.status).toBe(status);
    expect(errorCode(result)).toBe(code);
    expect(rpcs).toEqual([]);
    expect(result.headers["cache-control"]).toBe("no-store");
  });
});

describe("POST /auth/line - who the LINE account is", () => {
  test("a LINE account nobody linked is 403 LINE_NOT_LINKED", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { run } = setup({ identity: { ok: false, reason: "not_linked" } });

    const result = await run({ id_token: ID_TOKEN });

    expect(result.status).toBe(403);
    expect(errorCode(result)).toBe("LINE_NOT_LINKED");
  });

  test("a disabled account is 403 ACCOUNT_DISABLED", async () => {
    const { run } = setup({ identity: { ok: false, reason: "account_disabled" } });

    const result = await run({ id_token: ID_TOKEN });

    expect(result.status).toBe(403);
    expect(errorCode(result)).toBe("ACCOUNT_DISABLED");
  });

  test("a linked user with no ledger is 409 NO_LEDGER", async () => {
    const { run } = setup({ identity: { ok: false, reason: "no_ledger" } });

    const result = await run({ id_token: ID_TOKEN });

    expect(result.status).toBe(409);
    expect(errorCode(result)).toBe("NO_LEDGER");
  });

  test("an unknown refusal reason is treated as not linked", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const { run } = setup({ identity: { ok: false, reason: "something_new" } });

    const result = await run({ id_token: ID_TOKEN });

    expect(result.status).toBe(403);
    expect(errorCode(result)).toBe("LINE_NOT_LINKED");
  });

  test("a database error is 503, not a token", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { run } = setup({ identityError: new Error("connection reset") });

    const result = await run({ id_token: ID_TOKEN });

    expect(result.status).toBe(503);
    expect(errorCode(result)).toBe("LINE_UNAVAILABLE");
  });

  test.each([
    ["null", null],
    ["a string", "ok"],
    ["fields but no ok", { ...IDENTITY, ok: undefined }],
    ["fields with a truthy non-true ok", { ...IDENTITY, ok: "yes" }],
    ["no ledger id", { ...IDENTITY, ledger_id: undefined }],
    ["a ledger id that is not a uuid", { ...IDENTITY, ledger_id: "personal" }],
    ["a ledger id with a path in it", { ...IDENTITY, ledger_id: `${LEDGER}/../x` }],
    ["no user", { ...IDENTITY, user: undefined }],
    ["an empty user id", { ...IDENTITY, user: { ...IDENTITY.user, id: "" } }],
    ["a numeric email", { ...IDENTITY, user: { ...IDENTITY.user, email: 5 } }],
    ["an unknown locale", { ...IDENTITY, locale: "fr" }],
    ["no locale", { ...IDENTITY, locale: undefined }],
  ])("a malformed identity (%s) is a 503 and nothing is signed", async (_label, identity) => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { run } = setup({ identity });

    const result = await run({ id_token: ID_TOKEN });

    expect(result.status).toBe(503);
    expect(JSON.stringify(result.body)).not.toContain("equoL1");
  });
});

describe("POST /auth/line - per-account limit", () => {
  test("counts exchanges per hashed sub, never the raw one", async () => {
    const { run, rpcs } = setup();

    await run({ id_token: ID_TOKEN });

    const call = rpcs.find((entry) => entry.fn === "consume_rate_limit");
    expect(call?.args).toEqual({ p_bucket: `lineAuth:s:${sha256Hex(SUB).slice(0, 16)}`, p_limit: 30, p_window_seconds: 600 });
    expect(String(call?.args.p_bucket)).not.toContain(SUB);
  });

  test("over the limit is 429 with Retry-After, and no identity lookup happens", async () => {
    const { run, rpcs } = setup({ limit: { allowed: false, retry_after: 42 } });

    const result = await run({ id_token: ID_TOKEN });

    expect(result.status).toBe(429);
    expect(errorCode(result)).toBe("RATE_LIMITED");
    expect(result.headers["retry-after"]).toBe("42");
    expect(rpcs.map((call) => call.fn)).not.toContain("line_liff_identity");
  });

  test("Retry-After is at least 1 second", async () => {
    const { run } = setup({ limit: { allowed: false, retry_after: 0 } });

    expect((await run({ id_token: ID_TOKEN })).headers["retry-after"]).toBe("1");
  });

  // [MV] failing closed here would lock every LINE user out of their own ledger during a counter outage.
  test("fails OPEN when the counter is down", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { run } = setup({ limitError: new Error("rpc down") });

    const result = await run({ id_token: ID_TOKEN });

    expect(result.status).toBe(200);
  });

  test("a garbled counter answer also fails open", async () => {
    const { run } = setup({ limit: "??" });

    expect((await run({ id_token: ID_TOKEN })).status).toBe(200);
  });
});

describe("POST /auth/line - what is logged", () => {
  test("no console line contains the id token, the sub, the user id or the issued token", async () => {
    const lines: string[] = [];
    for (const method of ["log", "info", "warn", "error", "debug"] as const) {
      vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(String).join(" "));
      });
    }

    const paths = [
      setup(),
      setup({ identity: { ok: false, reason: "not_linked" } }),
      setup({ identity: { ok: false, reason: "account_disabled" } }),
      setup({ identityError: new Error(`failed for ${SUB}`) }),
      setup({ limitError: new Error(`failed for ${SUB}`) }),
      setup({ identity: { ...IDENTITY, locale: "fr" } }),
    ];
    let issued = "";

    for (const entry of paths) {
      const result = await entry.run({ id_token: ID_TOKEN });
      if (result.ok) issued = (result.body as { session: { token: string } }).session.token;
    }

    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).not.toContain(ID_TOKEN);
      expect(line).not.toContain(SUB);
      expect(line).not.toContain("user_alice");
      expect(line).not.toContain("alice@example.com");
      expect(line).not.toContain(issued);
    }
  });

  test("not_linked logs only a short tag of the sub", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { run } = setup({ identity: { ok: false, reason: "not_linked" } });

    await run({ id_token: ID_TOKEN });

    expect(warn).toHaveBeenCalledTimes(1);
    const line = String(warn.mock.calls[0].join(" "));
    expect(line).toContain("not_linked");
    expect(line).not.toContain(SUB);
    expect(line).not.toContain(SUB.slice(1, 12));
  });
});

describe("GET /line/liff", () => {
  test("reports the LIFF id, uncached", () => {
    const result = liffConfigRoute("1234567890-AbcdEfgh");

    expect(result).toMatchObject({ ok: true, status: 200, body: { liff_id: "1234567890-AbcdEfgh" } });
    expect(result.headers["cache-control"]).toBe("no-store");
  });

  test("reports null when LIFF is off", () => {
    expect(liffConfigRoute(null).body).toEqual({ liff_id: null });
  });
});
