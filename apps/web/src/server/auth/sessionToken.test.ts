import { describe, expect, test } from "vitest";
import { createSessionToken, verifySessionToken } from "./sessionToken.js";

const identity = {
  auth_user_id: "user_1",
  google_sub: "google_1",
  email: "alice@example.com",
  display_name: "Alice",
  avatar_url: "https://example.com/alice.png",
};

describe("sessionToken", () => {
  test("signs and verifies an Equo session token", () => {
    const token = createSessionToken(identity, "session-secret", 1_000);

    expect(verifySessionToken(token, "session-secret", 1_000)).toEqual({
      auth_user_id: "user_1",
      google_sub: "google_1",
      email: "alice@example.com",
      display_name: "Alice",
      avatar_url: "https://example.com/alice.png",
      resolved_user_id: "user_1",
    });
  });

  test("marks the decoded identity as already-resolved so callers can skip the upsert round-trip", () => {
    const token = createSessionToken(identity, "session-secret", 1_000);

    const decoded = verifySessionToken(token, "session-secret", 1_000);

    expect(decoded?.resolved_user_id).toBe(identity.auth_user_id);
  });

  test("rejects a tampered session token", () => {
    const token = createSessionToken(identity, "session-secret", 1_000);
    const tampered = `${token.slice(0, -1)}x`;

    expect(verifySessionToken(tampered, "session-secret", 1_000)).toBeNull();
  });

  test("rejects an expired session token", () => {
    const token = createSessionToken(identity, "session-secret", 1_000);

    expect(verifySessionToken(token, "session-secret", 1_000 + 8 * 24 * 60 * 60 * 1_000)).toBeNull();
  });
});
