import { describe, expect, test, vi } from "vitest";
import { createLineIdTokenVerifier, LINE_ID_TOKEN_ISSUER, LINE_VERIFY_URL } from "./lineIdToken.js";

const CHANNEL = "1234567890";
const SUB = "U" + "a".repeat(32);
const NOW = 1_800_000_000_000; // ms
const ID_TOKEN = "aaa.bbb.ccc";

function goodPayload(overrides: Record<string, unknown> = {}) {
  return {
    iss: LINE_ID_TOKEN_ISSUER,
    sub: SUB,
    aud: CHANNEL,
    exp: NOW / 1_000 + 3_000,
    iat: NOW / 1_000 - 60,
    ...overrides,
  };
}

function respond(status: number, payload: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } })) as unknown as typeof fetch;
}

function verifierWith(fetcher: typeof fetch, extra: { timeoutMs?: number } = {}) {
  return createLineIdTokenVerifier({ channelId: CHANNEL, fetcher, now: () => NOW, ...extra });
}

describe("createLineIdTokenVerifier - what is sent", () => {
  test("posts the token and the channel id as a form to LINE's verify endpoint, and nothing else", async () => {
    const fetcher = respond(200, goodPayload());

    await verifierWith(fetcher)(ID_TOKEN);

    const [url, init] = (fetcher as unknown as ReturnType<typeof vi.fn>).mock.calls[0] as [string, RequestInit];
    expect(url).toBe(LINE_VERIFY_URL);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["content-type"]).toBe("application/x-www-form-urlencoded");

    const form = new URLSearchParams(String(init.body));
    expect([...form.keys()].sort()).toEqual(["client_id", "id_token"]);
    expect(form.get("id_token")).toBe(ID_TOKEN);
    expect(form.get("client_id")).toBe(CHANNEL);
    // No secret of any kind, in the body or in a header.
    expect(Object.keys(init.headers as object)).toEqual(["content-type"]);
  });
});

describe("createLineIdTokenVerifier - accepting", () => {
  test("returns the claims LINE confirmed", async () => {
    const result = await verifierWith(respond(200, goodPayload()))(ID_TOKEN);

    expect(result).toEqual({ ok: true, claims: goodPayload() });
  });

  test("drops claims it did not ask about", async () => {
    const result = await verifierWith(respond(200, goodPayload({ email: "x@example.com", name: "Someone", picture: "https://x" })))(ID_TOKEN);

    expect(result.ok && Object.keys(result.claims).sort()).toEqual(["aud", "exp", "iat", "iss", "sub"]);
  });
});

describe("createLineIdTokenVerifier - refusing what LINE said yes to", () => {
  // [MV] each of these is a check this file makes ON TOP of LINE's 200.
  test.each([
    ["a different issuer", { iss: "https://evil.example.com" }],
    ["no issuer", { iss: undefined }],
    ["a token for another channel", { aud: "999999999" }],
    ["a numeric audience", { aud: 1234567890 }],
    ["no audience", { aud: undefined }],
    ["a sub that is not a LINE user id", { sub: "not-a-line-id" }],
    ["a sub with the wrong length", { sub: "U" + "a".repeat(31) }],
    ["an upper-case sub", { sub: "U" + "A".repeat(32) }],
    ["a sub with trailing text", { sub: SUB + "x" }],
    ["a sub that is a number", { sub: 12345 }],
    ["no sub", { sub: undefined }],
    ["no exp", { exp: undefined }],
    ["a string exp", { exp: String(NOW / 1_000 + 3_000) }],
    ["no iat", { iat: undefined }],
  ])("%s is invalid", async (_label, override) => {
    const result = await verifierWith(respond(200, goodPayload(override)))(ID_TOKEN);

    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  test("an exp in the past is expired even though LINE answered 200", async () => {
    const result = await verifierWith(respond(200, goodPayload({ exp: NOW / 1_000 - 1 })))(ID_TOKEN);

    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  test("an exp exactly now is expired (the boundary is closed)", async () => {
    const result = await verifierWith(respond(200, goodPayload({ exp: NOW / 1_000 })))(ID_TOKEN);

    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  test("a 200 that is not an object is not trusted either way", async () => {
    expect(await verifierWith(respond(200, "yes"))(ID_TOKEN)).toEqual({ ok: false, reason: "unavailable" });
    expect(await verifierWith(respond(200, null))(ID_TOKEN)).toEqual({ ok: false, reason: "unavailable" });
    expect(await verifierWith(respond(200, [goodPayload()]))(ID_TOKEN)).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("createLineIdTokenVerifier - LINE's own refusals", () => {
  test("400 IdToken expired. is expired", async () => {
    const result = await verifierWith(respond(400, { error: "invalid_request", error_description: "IdToken expired." }))(ID_TOKEN);

    expect(result).toEqual({ ok: false, reason: "expired" });
  });

  test.each([
    ["Invalid IdToken Audience.", 400],
    ["Invalid IdToken.", 400],
    ["something new", 400],
    ["", 401],
  ])("%s (%i) is invalid", async (description, status) => {
    const result = await verifierWith(respond(status, { error: "invalid_request", error_description: description }))(ID_TOKEN);

    expect(result).toEqual({ ok: false, reason: "invalid" });
  });

  test("a 400 with an unreadable body is invalid, not unavailable", async () => {
    const fetcher = vi.fn(async () => new Response("<html>", { status: 400 })) as unknown as typeof fetch;

    expect(await verifierWith(fetcher)(ID_TOKEN)).toEqual({ ok: false, reason: "invalid" });
  });

  test.each([429, 500, 502, 503])("%i is unavailable: LINE failing says nothing about the token", async (status) => {
    expect(await verifierWith(respond(status, {}))(ID_TOKEN)).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("createLineIdTokenVerifier - when LINE cannot be reached", () => {
  test("a network error is unavailable", async () => {
    const fetcher = vi.fn(async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;

    expect(await verifierWith(fetcher)(ID_TOKEN)).toEqual({ ok: false, reason: "unavailable" });
  });

  test("a request that never answers is cut off by the timeout", async () => {
    const fetcher = vi.fn(
      (_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
        }),
    ) as unknown as typeof fetch;

    expect(await verifierWith(fetcher, { timeoutMs: 20 })(ID_TOKEN)).toEqual({ ok: false, reason: "unavailable" });
  });

  test("a response whose body never arrives is cut off by the same timeout", async () => {
    const fetcher = vi.fn(
      async (_url: string, init?: RequestInit) =>
        ({
          ok: true,
          status: 200,
          json: () =>
            new Promise((_resolve, reject) => {
              init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
            }),
        }) as unknown as Response,
    ) as unknown as typeof fetch;

    expect(await verifierWith(fetcher, { timeoutMs: 20 })(ID_TOKEN)).toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("createLineIdTokenVerifier - nothing sensitive is logged", () => {
  test("no console output on any path, whatever LINE says", async () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((method) => vi.spyOn(console, method).mockImplementation(() => {}));

    try {
      const verifier = verifierWith(respond(200, goodPayload()));
      await verifier(ID_TOKEN);
      await verifierWith(respond(400, { error_description: "IdToken expired." }))(ID_TOKEN);
      await verifierWith(respond(200, goodPayload({ aud: "x" })))(ID_TOKEN);

      for (const spy of spies) expect(spy).not.toHaveBeenCalled();
    } finally {
      for (const spy of spies) spy.mockRestore();
    }
  });
});
