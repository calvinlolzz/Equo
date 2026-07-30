import { describe, expect, test } from "vitest";
import type { PushRepository } from "../repositories/pushRepository.js";
import { handleSubscribePush, handleUnsubscribePush, validatePushSubscription } from "./push.js";

const context = {
  user: {
    id: "user_alice",
    google_sub: "google-alice",
    email: "alice@example.com",
    display_name: "Alice",
  },
};

const validSubscription = {
  endpoint: "https://fcm.googleapis.com/fcm/send/abc123",
  keys: { p256dh: "p256dh-key", auth: "auth-secret" },
};

function makeRepository(overrides: Partial<PushRepository> = {}): PushRepository {
  return {
    async saveSubscription(_userId, subscription) {
      return { endpoint: subscription.endpoint };
    },
    async deleteSubscription() {
      return { deleted: 1 };
    },
    async pruneSubscription() {
      return { deleted: 1 };
    },
    async targetsForGroup() {
      return { group_name: null, actor_name: null, subscriptions: [] };
    },
    ...overrides,
  };
}

describe("validatePushSubscription", () => {
  test("accepts a complete subscription", () => {
    expect(validatePushSubscription(validSubscription)).toBeNull();
  });

  test("requires all three parts, because two of them cannot encrypt anything", () => {
    expect(validatePushSubscription({})).toBe("endpoint is required");
    expect(validatePushSubscription({ ...validSubscription, keys: { auth: "a" } })).toBe("keys.p256dh is required");
    expect(validatePushSubscription({ ...validSubscription, keys: { p256dh: "p" } })).toBe("keys.auth is required");
  });

  test("rejects an endpoint that is not an https URL", () => {
    // This is a URL the server will later POST to, so anything else is either
    // a broken client or an attempt to aim the delivery path somewhere.
    expect(validatePushSubscription({ ...validSubscription, endpoint: "not a url" })).toBe("endpoint must be a URL");
    expect(validatePushSubscription({ ...validSubscription, endpoint: "http://push.example/x" })).toBe(
      "endpoint must be https",
    );
    expect(validatePushSubscription({ ...validSubscription, endpoint: "file:///etc/passwd" })).toBe(
      "endpoint must be https",
    );
  });
});

describe("handleSubscribePush", () => {
  test("stores the subscription against the authenticated caller", async () => {
    let received: { userId: string; endpoint: string } | null = null;
    const repository = makeRepository({
      async saveSubscription(userId, subscription) {
        received = { userId, endpoint: subscription.endpoint };
        return { endpoint: subscription.endpoint };
      },
    });

    const result = await handleSubscribePush(repository, context, validSubscription);

    expect(result.status).toBe(200);
    // Never a user id from the body: the session decides whose device this is.
    expect(received).toEqual({ userId: "user_alice", endpoint: validSubscription.endpoint });
  });

  test("rejects an incomplete subscription with 400", async () => {
    const result = await handleSubscribePush(makeRepository(), context, { endpoint: "https://push.example/x" });

    expect(result.status).toBe(400);
    expect(!result.ok && result.body.error.code).toBe("MALFORMED_REQUEST");
  });

  test("truncates a hostile user agent rather than storing it whole", async () => {
    let stored = "";
    const repository = makeRepository({
      async saveSubscription(_userId, subscription) {
        stored = subscription.userAgent ?? "";
        return { endpoint: subscription.endpoint };
      },
    });

    await handleSubscribePush(repository, context, { ...validSubscription, user_agent: "x".repeat(5_000) });

    expect(stored).toHaveLength(300);
  });
});

describe("handleUnsubscribePush", () => {
  test("removes the caller's own subscription", async () => {
    let received: { userId: string; endpoint: string } | null = null;
    const repository = makeRepository({
      async deleteSubscription(userId, endpoint) {
        received = { userId, endpoint };
        return { deleted: 1 };
      },
    });

    const result = await handleUnsubscribePush(repository, context, { endpoint: validSubscription.endpoint });

    expect(result.status).toBe(200);
    expect(received).toEqual({ userId: "user_alice", endpoint: validSubscription.endpoint });
  });

  test("deleting nothing is still success — the device is already unsubscribed", async () => {
    const repository = makeRepository({
      async deleteSubscription() {
        return { deleted: 0 };
      },
    });

    const result = await handleUnsubscribePush(repository, context, { endpoint: "https://push.example/gone" });

    expect(result.status).toBe(200);
    expect(result.ok && result.body).toEqual({ ok: true });
  });

  test("requires an endpoint", async () => {
    const result = await handleUnsubscribePush(makeRepository(), context, {});

    expect(result.status).toBe(400);
  });
});
