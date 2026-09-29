import { describe, expect, test } from "vitest";
import { createLinkNonce, redactForLog, sha256Hex, verifyLineSignature } from "./lineCrypto.js";

const SECRET = "test_channel_secret";

// Byte-identical to what LINE sends: the exact verification payload from
// https://developers.line.biz/en/docs/messaging-api/verify-webhook-signature/
const BODY_A = '{"destination":"Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","events":[]}';
const SIGNATURE_A = "0jkCW82LuQ3i04Tw2QfRjZqX/ZIcVO6OZRqGXFlhrVg=";

// A realistic single text-message delivery, verbatim (no re-serialization).
const BODY_B =
  '{"destination":"Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","events":[{"type":"message","message":{"type":"text","id":"1","text":"早餐 60"},"webhookEventId":"01J0000000000000000000000A","deliveryContext":{"isRedelivery":false},"timestamp":1790000000000,"source":{"type":"user","userId":"U0123456789abcdef0123456789abcdef"},"replyToken":"rt1","mode":"active"}]}';
const SIGNATURE_B = "JEYGInYSzyIy/KycbUZmsXTNMOFcru0qhs4jnyLY3Vk=";

function bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

describe("verifyLineSignature", () => {
  test("accepts the exact verification payload from LINE's docs", () => {
    expect(verifyLineSignature(bytes(BODY_A), SIGNATURE_A, SECRET)).toBe(true);
  });

  test("accepts a realistic single-message body", () => {
    expect(verifyLineSignature(bytes(BODY_B), SIGNATURE_B, SECRET)).toBe(true);
  });

  // [MV]: this is the guard against re-serializing the body before verifying.
  // Swap BODY_A/BODY_B for `JSON.stringify(JSON.parse(BODY_A))` in
  // verifyLineSignature's caller (or here) and this must go red, because
  // re-serializing changes whitespace and therefore the signed bytes.
  test("rejects the same payload with one extra space inserted (re-serialization guard)", () => {
    const withExtraSpace = '{"destination":"Uaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","events": []}';
    expect(withExtraSpace).not.toBe(BODY_A);
    expect(verifyLineSignature(bytes(withExtraSpace), SIGNATURE_A, SECRET)).toBe(false);
    // The original, byte-for-byte, still verifies - proving the failure above
    // is about the added space and not some other break.
    expect(verifyLineSignature(bytes(BODY_A), SIGNATURE_A, SECRET)).toBe(true);
  });

  test("rejects when a single byte of the body changes", () => {
    const tampered = BODY_B.replace("60", "61");
    expect(verifyLineSignature(bytes(tampered), SIGNATURE_B, SECRET)).toBe(false);
  });

  test("rejects a missing signature without throwing", () => {
    expect(verifyLineSignature(bytes(BODY_A), null, SECRET)).toBe(false);
    expect(verifyLineSignature(bytes(BODY_A), undefined, SECRET)).toBe(false);
  });

  test("rejects an empty signature without throwing", () => {
    expect(verifyLineSignature(bytes(BODY_A), "", SECRET)).toBe(false);
  });

  test("rejects garbage (non-base64-ish) signature without throwing", () => {
    expect(() => verifyLineSignature(bytes(BODY_A), "not!!valid==base64///", SECRET)).not.toThrow();
    expect(verifyLineSignature(bytes(BODY_A), "not!!valid==base64///", SECRET)).toBe(false);
  });

  test("rejects when the channel secret is empty", () => {
    expect(verifyLineSignature(bytes(BODY_A), SIGNATURE_A, "")).toBe(false);
  });
});

describe("createLinkNonce", () => {
  test("is 32 URL-safe characters", () => {
    const nonce = createLinkNonce();
    expect(nonce).toHaveLength(32);
    expect(nonce).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  test("is different every call", () => {
    expect(createLinkNonce()).not.toBe(createLinkNonce());
  });
});

describe("sha256Hex", () => {
  test("is deterministic and 64 hex characters", () => {
    const hash = sha256Hex("U0123456789abcdef0123456789abcdef");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(sha256Hex("U0123456789abcdef0123456789abcdef")).toBe(hash);
  });

  test("different inputs hash differently", () => {
    expect(sha256Hex("a")).not.toBe(sha256Hex("b"));
  });
});

describe("redactForLog", () => {
  test("masks a raw LINE userId", () => {
    expect(redactForLog("failed for U0123456789abcdef0123456789abcdef: boom")).toBe("failed for U…: boom");
  });

  test("masks multiple userIds", () => {
    const text = "U0123456789abcdef0123456789abcdef and U11111111111111111111111111111111";
    expect(redactForLog(text)).toBe("U… and U…");
  });

  test("caps length at 300 characters", () => {
    const long = "x".repeat(400);
    const result = redactForLog(long);
    expect(result.length).toBeLessThanOrEqual(301); // 300 + ellipsis
    expect(result.endsWith("…")).toBe(true);
  });

  test("leaves ordinary text alone", () => {
    expect(redactForLog("nothing sensitive here")).toBe("nothing sensitive here");
  });
});
