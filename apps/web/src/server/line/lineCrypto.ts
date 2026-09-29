import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * HMAC-SHA256 signature check for LINE webhook deliveries.
 *
 * LINE signs the raw request body and sends the signature, base64-encoded, in
 * the `x-line-signature` header (see
 * https://developers.line.biz/en/reference/messaging-api/#signature-validation).
 * The body must never be parsed, reformatted or re-serialized before this
 * check runs - `JSON.stringify(JSON.parse(raw))` changes whitespace and
 * therefore changes the bytes the signature was computed over, which is
 * exactly what this function's own test guards against.
 */
export function verifyLineSignature(
  rawBody: Uint8Array,
  signature: string | null | undefined,
  channelSecret: string,
): boolean {
  if (!channelSecret || !signature) return false;

  let expected: Buffer;
  let actual: Buffer;

  try {
    expected = createHmac("sha256", channelSecret).update(rawBody).digest();
    actual = Buffer.from(signature, "base64");
  } catch {
    // A header that isn't valid base64 - refuse rather than throw.
    return false;
  }

  // timingSafeEqual throws on a length mismatch rather than returning false,
  // so the lengths are compared first.
  if (expected.length !== actual.length) return false;

  return timingSafeEqual(expected, actual);
}

/** Plain SHA-256, hex-encoded. Used to hash link tokens and nonces at rest. */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/**
 * A single-use link nonce: 24 random bytes (192 bits) base64url-encoded, 32
 * characters - within LINE's accepted 10-255 character range for the
 * `nonce` query param on the accountLink dialog.
 */
export function createLinkNonce(): string {
  return randomBytes(24).toString("base64url");
}

/**
 * The only form a LINE user id may take in a log line: a short, non-reversible
 * tag, never the id itself (LINE user ids are stable per-provider identifiers,
 * not disposable request ids).
 */
export function lineUserTag(userId: string): string {
  return sha256Hex(userId).slice(0, 12);
}

const LINE_USER_ID_PATTERN = /U[0-9a-f]{32}/g;
const REDACT_MAX_LENGTH = 300;

/**
 * Defensive redaction for error strings that might echo a raw LINE user id (a
 * database error message, an upstream API error) before they reach a log
 * line. Not a substitute for not logging sensitive fields in the first place
 * - see the "never log" list in lineWebhook.ts - but a second layer for text
 * this module does not otherwise control the shape of.
 */
export function redactForLog(text: string): string {
  const truncated = text.length > REDACT_MAX_LENGTH ? `${text.slice(0, REDACT_MAX_LENGTH)}…` : text;
  return truncated.replace(LINE_USER_ID_PATTERN, "U…");
}
