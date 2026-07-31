import { describe, expect, test, vi } from "vitest";
import type { PushRepository, PushSubscriptionRecord } from "../repositories/pushRepository.js";
import { buildExpenseNotification } from "./pushNotification.js";
import { deliverPush, notifyExpenseCreated, type PushSendFn } from "./pushSender.js";

const vapid = { publicKey: "pub", privateKey: "priv", subject: "mailto:ops@example.com" };

function subscription(index: number): PushSubscriptionRecord {
  return { endpoint: `https://push.example/${index}`, p256dh: "key", auth: "auth" };
}

function makeRepository(overrides: Partial<PushRepository> = {}): PushRepository {
  return {
    async saveSubscription() {
      return { endpoint: "https://push.example/1" };
    },
    async deleteSubscription() {
      return { deleted: 1 };
    },
    async pruneSubscription() {
      return { deleted: 1 };
    },
    async targetsForGroup() {
      return { group_name: "東京旅行", actor_name: "Alice", subscriptions: [subscription(1)] };
    },
    ...overrides,
  };
}

function gone(statusCode: number): PushSendFn {
  return async () => {
    const error = new Error("gone") as Error & { statusCode: number };
    error.statusCode = statusCode;
    throw error;
  };
}

describe("buildExpenseNotification", () => {
  test("says which group, who, what and how much", () => {
    const payload = buildExpenseNotification({
      groupId: "group_1",
      groupName: "東京旅行",
      actorName: "Alice",
      title: "拉麵",
      amountMinor: 32000,
      currency: "TWD",
      kind: "expense",
    });

    expect(payload).toEqual({
      title: "東京旅行",
      body: "Alice 記了一筆：拉麵 $320",
      url: "/group/group_1",
      tag: "group-group_1",
    });
  });

  test("wording follows the kind", () => {
    const base = {
      groupId: "group_1",
      groupName: "G",
      actorName: "Alice",
      title: "退款",
      amountMinor: 10000,
      currency: "TWD",
    };

    expect(buildExpenseNotification({ ...base, kind: "income" }).body).toBe("Alice 記了一筆收入：退款 $100");
    // A settlement has no title worth showing - it is always "a transfer".
    expect(buildExpenseNotification({ ...base, kind: "transfer" }).body).toBe("Alice 記錄了一筆清償 $100");
  });

  test("survives a missing group or actor name rather than rendering 'undefined'", () => {
    const payload = buildExpenseNotification({
      groupId: "group_1",
      groupName: null,
      actorName: null,
      title: "拉麵",
      amountMinor: 100,
      currency: "TWD",
      kind: "expense",
    });

    expect(payload.title).toBe("Equo");
    expect(payload.body).toBe("有人 記了一筆：拉麵 $1");
  });

  test("formats a non-TWD amount with its own symbol", () => {
    const payload = buildExpenseNotification({
      groupId: "group_1",
      groupName: "Tokyo",
      actorName: "Bob",
      title: "ramen",
      amountMinor: 120000,
      currency: "JPY",
      kind: "expense",
    });

    expect(payload.body).toContain("¥1,200");
  });

  test("one tag per group, so five entries do not become five notifications", () => {
    const first = buildExpenseNotification({
      groupId: "group_1", groupName: "G", actorName: "A", title: "a", amountMinor: 1, currency: "TWD", kind: "expense",
    });
    const second = buildExpenseNotification({
      groupId: "group_1", groupName: "G", actorName: "B", title: "b", amountMinor: 2, currency: "TWD", kind: "expense",
    });

    expect(first.tag).toBe(second.tag);
  });
});

describe("deliverPush", () => {
  const payload = { title: "G", body: "b", url: "/group/group_1", tag: "group-group_1" };

  test("sends to every endpoint and counts them", async () => {
    const send = vi.fn(async () => ({ statusCode: 201 }));

    const outcome = await deliverPush({
      subscriptions: [subscription(1), subscription(2)],
      payload,
      vapid,
      repository: makeRepository(),
      send,
    });

    expect(outcome).toEqual({ sent: 2, pruned: 0, failed: 0 });
    expect(send).toHaveBeenCalledTimes(2);
  });

  test("deletes an endpoint the push service says is gone", async () => {
    const pruned: string[] = [];
    const repository = makeRepository({
      async pruneSubscription(endpoint) {
        pruned.push(endpoint);
        return { deleted: 1 };
      },
    });

    const outcome = await deliverPush({
      subscriptions: [subscription(1)],
      payload,
      vapid,
      repository,
      send: gone(410),
    });

    expect(outcome).toEqual({ sent: 0, pruned: 1, failed: 0 });
    expect(pruned).toEqual(["https://push.example/1"]);
  });

  test("keeps an endpoint that merely failed this time", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const pruned: string[] = [];
    const repository = makeRepository({
      async pruneSubscription(endpoint) {
        pruned.push(endpoint);
        return { deleted: 1 };
      },
    });

    // A 429 or a 500 is the push service having a bad minute. Dropping the
    // subscription would make the user re-enable notifications by hand.
    const outcome = await deliverPush({
      subscriptions: [subscription(1)],
      payload,
      vapid,
      repository,
      send: gone(429),
    });

    expect(outcome).toEqual({ sent: 0, pruned: 0, failed: 1 });
    expect(pruned).toEqual([]);
    logged.mockRestore();
  });

  test("one bad endpoint does not stop the others", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const send: PushSendFn = async (target) => {
      if (target.endpoint.endsWith("/2")) {
        throw new Error("boom");
      }
      return { statusCode: 201 };
    };

    const outcome = await deliverPush({
      subscriptions: [subscription(1), subscription(2), subscription(3)],
      payload,
      vapid,
      repository: makeRepository(),
      send,
    });

    expect(outcome).toEqual({ sent: 2, pruned: 0, failed: 1 });
    logged.mockRestore();
  });
});

describe("notifyExpenseCreated", () => {
  const expense = { title: "拉麵", amount_minor: 32000, currency: "TWD", kind: "expense" };

  test("sends the group's notification to everyone the repository returns", async () => {
    const sent: Array<{ endpoint: string; body: string }> = [];
    const send: PushSendFn = async (target, payload) => {
      sent.push({ endpoint: target.endpoint, body: payload.body });
      return { statusCode: 201 };
    };

    const outcome = await notifyExpenseCreated({
      repository: makeRepository({
        async targetsForGroup() {
          return {
            group_name: "東京旅行",
            actor_name: "Alice",
            subscriptions: [subscription(1), subscription(2)],
          };
        },
      }),
      vapid,
      groupId: "group_1",
      actorUserId: "user_alice",
      expense,
      send,
    });

    expect(outcome.sent).toBe(2);
    expect(sent[0].body).toBe("Alice 記了一筆：拉麵 $320");
  });

  test("does nothing at all when nobody in the group is subscribed", async () => {
    const send = vi.fn(async () => ({ statusCode: 201 }));

    const outcome = await notifyExpenseCreated({
      repository: makeRepository({
        async targetsForGroup() {
          return { group_name: "東京旅行", actor_name: "Alice", subscriptions: [] };
        },
      }),
      vapid,
      groupId: "group_1",
      actorUserId: "user_alice",
      expense,
      send,
    });

    expect(send).not.toHaveBeenCalled();
    expect(outcome).toEqual({ sent: 0, pruned: 0, failed: 0 });
  });

  test("swallows a repository failure — the expense is already saved", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await notifyExpenseCreated({
      repository: makeRepository({
        async targetsForGroup() {
          throw new Error("database unreachable");
        },
      }),
      vapid,
      groupId: "group_1",
      actorUserId: "user_alice",
      expense,
      send: async () => ({ statusCode: 201 }),
    });

    expect(outcome).toEqual({ sent: 0, pruned: 0, failed: 0 });
    logged.mockRestore();
  });
});
