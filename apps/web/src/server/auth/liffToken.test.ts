import { createHmac } from "node:crypto";
import { describe, expect, test } from "vitest";
import {
  LIFF_SESSION_TTL_MS,
  LIFF_TOKEN_VERSION,
  createLiffToken,
  isLiffTokenShape,
  liffIdentity,
  verifyLiffToken,
} from "./liffToken.js";
import { createSessionToken, createViewAsToken, verifySessionToken, viewAsAdminId } from "./sessionToken.js";

const SECRET = "session-secret-for-tests";
const NOW = 1_700_000_000_000;
const LEDGER = "0b8f2c1e-5a41-4f0a-9d2e-3c6b7a8d9e10";
const HASH = "a".repeat(64);

const input = {
  auth_user_id: "user_alice",
  google_sub: "google_alice",
  email: "alice@example.com",
  display_name: "Alice",
  avatar_url: "https://example.com/a.png",
  ledger_id: LEDGER,
  line_sub_hash: HASH,
};

const sessionIdentity = {
  auth_user_id: "user_alice",
  google_sub: "google_alice",
  email: "alice@example.com",
  display_name: "Alice",
};

function decode(token: string): Record<string, unknown> {
  return JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
}

function encode(payload: unknown): string {
  return Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
}

/** A LIFF-looking token signed with an arbitrary key - what a forger would try. */
function forge(payload: unknown, key: string | Buffer, version = LIFF_TOKEN_VERSION): string {
  const encoded = encode(payload);
  const signature = createHmac("sha256", key).update(`${version}.${encoded}`).digest("base64url");
  return `${version}.${encoded}.${signature}`;
}

describe("createLiffToken / verifyLiffToken", () => {
  test("round-trips the claims, scoped to the ledger, for one hour", () => {
    const token = createLiffToken(input, SECRET, NOW);
    const claims = verifyLiffToken(token, SECRET, NOW + 1_000);

    expect(claims).toEqual({ ...input, scope: "liff", iat: NOW, exp: NOW + LIFF_SESSION_TTL_MS });
    expect(LIFF_SESSION_TTL_MS).toBe(60 * 60 * 1_000);
    expect(token.startsWith("equoL1.")).toBe(true);
  });

  test("carries no LINE user id, only its hash", () => {
    const payload = JSON.stringify(decode(createLiffToken(input, SECRET, NOW)));

    expect(payload).toContain(HASH);
    expect(payload).not.toMatch(/U[0-9a-f]{32}/);
  });

  test("omits avatar_url when there is none", () => {
    const { avatar_url: _avatar, ...bare } = input;
    const claims = verifyLiffToken(createLiffToken(bare, SECRET, NOW), SECRET, NOW);

    expect(claims).not.toBeNull();
    expect("avatar_url" in (claims as object)).toBe(false);
  });

  test("expires at exactly exp", () => {
    const token = createLiffToken(input, SECRET, NOW);

    expect(verifyLiffToken(token, SECRET, NOW + LIFF_SESSION_TTL_MS - 1)).not.toBeNull();
    expect(verifyLiffToken(token, SECRET, NOW + LIFF_SESSION_TTL_MS)).toBeNull();
    expect(verifyLiffToken(token, SECRET, NOW + LIFF_SESSION_TTL_MS + 1)).toBeNull();
  });

  test("a token signed with another secret is refused", () => {
    expect(verifyLiffToken(createLiffToken(input, "some-other-secret", NOW), SECRET, NOW)).toBeNull();
  });

  test("an empty secret verifies nothing", () => {
    expect(verifyLiffToken(createLiffToken(input, "", NOW), "", NOW)).toBeNull();
  });

  test.each([
    ["ledger_id", "11111111-2222-4333-8444-555555555555"],
    ["auth_user_id", "user_mallory"],
    ["exp", NOW + 10 * LIFF_SESSION_TTL_MS],
    ["line_sub_hash", "b".repeat(64)],
  ])("a tampered %s is refused", (field, value) => {
    const token = createLiffToken(input, SECRET, NOW);
    const [version, , signature] = token.split(".");
    const tampered = `${version}.${encode({ ...decode(token), [field]: value })}.${signature}`;

    expect(verifyLiffToken(tampered, SECRET, NOW)).toBeNull();
  });

  test("a truncated, padded or reshaped token is refused", () => {
    const token = createLiffToken(input, SECRET, NOW);
    const [version, payload, signature] = token.split(".");

    for (const bad of [
      "",
      "equoL1",
      "equoL1.",
      `${version}.${payload}`,
      `${version}.${payload}.`,
      `${version}..${signature}`,
      `${token}.extra`,
      `${token}x`,
      `${version}.${payload}.${signature.slice(0, -2)}`,
      token.toUpperCase(),
      ` ${token}`,
    ]) {
      expect(verifyLiffToken(bad, SECRET, NOW), bad).toBeNull();
    }
  });

  test("a payload that is not JSON, or not an object, is refused rather than thrown on", () => {
    for (const raw of ["not json", "null", "[]", "42", '"str"']) {
      const encoded = Buffer.from(raw, "utf8").toString("base64url");
      const signature = createHmac("sha256", createHmac("sha256", SECRET).update("equo-liff-session-v1").digest())
        .update(`equoL1.${encoded}`)
        .digest("base64url");

      expect(verifyLiffToken(`equoL1.${encoded}.${signature}`, SECRET, NOW), raw).toBeNull();
    }
  });

  // Correctly signed but malformed claims: a bug in the minting code must not
  // produce a token the verifier would accept.
  test.each([
    ["wrong scope", { scope: "full" }],
    ["no scope", { scope: undefined }],
    ["a ledger that is not a uuid", { ledger_id: "group_1" }],
    ["a ledger with a path in it", { ledger_id: `${LEDGER}/../x` }],
    ["a hash that is not sha256 hex", { line_sub_hash: "zz" }],
    ["an uppercase hash", { line_sub_hash: "A".repeat(64) }],
    ["a missing user", { auth_user_id: "" }],
    ["a lifetime longer than we mint", { exp: NOW + LIFF_SESSION_TTL_MS + 1 }],
    ["a non-finite exp", { exp: null }],
    ["a string iat", { iat: "1" }],
  ])("a correctly signed token with %s is refused", (_name, override) => {
    const good = decode(createLiffToken(input, SECRET, NOW));
    const key = createHmac("sha256", SECRET).update("equo-liff-session-v1").digest();

    expect(verifyLiffToken(forge({ ...good, ...override }, key), SECRET, NOW)).toBeNull();
    // Control: the same forgery with no override is accepted, so the refusals above are about the override.
    expect(verifyLiffToken(forge(good, key), SECRET, NOW)).not.toBeNull();
  });
});

describe("a LIFF token is never a session", () => {
  // [MV]: let verifySessionToken accept equoL1 and every route's `verifySessionToken(t) ?? ...` hands a LINE session the whole API.
  test("verifySessionToken refuses it", () => {
    const token = createLiffToken(input, SECRET, NOW);

    expect(verifySessionToken(token, SECRET, NOW)).toBeNull();
    expect(viewAsAdminId(token, SECRET, NOW)).toBeNull();
  });

  test("re-prefixing it as equo1 fails the session signature", () => {
    const [, payload, signature] = createLiffToken(input, SECRET, NOW).split(".");

    expect(verifySessionToken(`equo1.${payload}.${signature}`, SECRET, NOW)).toBeNull();
  });

  // [MV]: sign LIFF tokens with the raw secret (and the cross-key test goes red).
  test("a LIFF payload signed with the raw session secret does not verify as LIFF", () => {
    const good = decode(createLiffToken(input, SECRET, NOW));

    expect(verifyLiffToken(forge(good, SECRET), SECRET, NOW)).toBeNull();
  });

  test("the signing key is derived, not the secret itself", () => {
    const token = createLiffToken(input, SECRET, NOW);
    const [version, payload, signature] = token.split(".");
    const raw = createHmac("sha256", SECRET).update(`${version}.${payload}`).digest("base64url");
    const derived = createHmac("sha256", createHmac("sha256", SECRET).update("equo-liff-session-v1").digest())
      .update(`${version}.${payload}`)
      .digest("base64url");

    expect(signature).not.toBe(raw);
    expect(signature).toBe(derived);
  });

  test("session and view-as tokens are not LIFF tokens", () => {
    const session = createSessionToken(sessionIdentity, SECRET, NOW);
    const view = createViewAsToken(sessionIdentity, "user_admin", SECRET, NOW);

    expect(verifyLiffToken(session, SECRET, NOW)).toBeNull();
    expect(verifyLiffToken(view, SECRET, NOW)).toBeNull();
    expect(verifyLiffToken(`equoL1.${session.split(".").slice(1).join(".")}`, SECRET, NOW)).toBeNull();
  });
});

describe("isLiffTokenShape", () => {
  test("is true only for the equoL1. prefix", () => {
    expect(isLiffTokenShape(createLiffToken(input, SECRET, NOW))).toBe(true);
    expect(isLiffTokenShape("equoL1.x.y")).toBe(true);
    for (const other of ["", "equo1.x.y", "equol1.x.y", "EQUOL1.x.y", "equoL1", " equoL1.x.y", "Bearer equoL1.x.y", "google-token"]) {
      expect(isLiffTokenShape(other), other).toBe(false);
    }
  });
});

describe("liffIdentity", () => {
  test("is resolved (so the routes skip the upsert) and marked as LIFF-scoped to the ledger", () => {
    const claims = verifyLiffToken(createLiffToken(input, SECRET, NOW), SECRET, NOW);
    const identity = liffIdentity(claims!);

    expect(identity).toMatchObject({
      auth_user_id: "user_alice",
      resolved_user_id: "user_alice",
      scope: "liff",
      liff_ledger_id: LEDGER,
      email: "alice@example.com",
    });
  });
});
