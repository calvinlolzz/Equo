import { describe, expect, test, vi } from "vitest";
import type { PushRepository, PushSubscriptionRecord } from "../repositories/pushRepository.js";
import {
  buildErrorAlertNotification,
  buildExpenseNotification,
  buildNudgeNotification,
} from "./pushNotification.js";
import {
  deliverPush,
  notifyErrorAlert,
  notifyExpenseCreated,
  notifyMemberJoined,
  notifyNudge,
  type PushSendFn,
} from "./pushSender.js";

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
    async logDelivery() {},
    async targetsForAdmins() {
      return { group_name: null, actor_name: null, subscriptions: [] };
    },
    async targetsForMember() {
      return { group_name: "東京旅行", actor_name: null, subscriptions: [subscription(1)] };
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
      actions: [{ action: "add-expense", title: "記一筆", url: "/group/group_1?shortcut=add-expense" }],
    });
  });

  test("the 記一筆 button opens the composer, not just the group the body tap opens", () => {
    const payload = buildExpenseNotification({
      groupId: "group_9",
      groupName: "G",
      actorName: "A",
      title: "a",
      amountMinor: 1,
      currency: "TWD",
      kind: "expense",
    });

    const [action] = payload.actions ?? [];
    expect(action.url).not.toBe(payload.url);
    // Reuses the manifest shortcut the app already handles (see appShortcuts.ts);
    // a value the app doesn't recognise would open the group and do nothing.
    expect(new URL(action.url, "https://equo.test").searchParams.get("shortcut")).toBe("add-expense");
    expect(new URL(action.url, "https://equo.test").pathname).toBe("/group/group_9");
  });

  test("a settlement reminder carries no buttons", () => {
    const payload = buildNudgeNotification({
      groupId: "group_1",
      groupName: "G",
      fromName: "Alice",
      balanceMinor: -30000,
      currency: "TWD",
    });

    // Deliberate: the group screen it opens already has 結清 on it, and a
    // one-tap "paid" button on a lock screen writes to the ledger unchecked.
    expect(payload.actions).toBeUndefined();
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
      kind: "expense",
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
      kind: "expense",
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
      kind: "expense",
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
      kind: "expense",
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

describe("buildNudgeNotification", () => {
  test("names who is asking and how much, on the lock screen", () => {
    const payload = buildNudgeNotification({
      groupId: "group_1",
      groupName: "東京旅行",
      fromName: "Alice",
      balanceMinor: -32000,
      currency: "TWD",
    });

    expect(payload).toEqual({
      title: "東京旅行",
      body: "Alice 提醒你還有 $320 未結清",
      url: "/group/group_1",
      tag: "nudge-group_1",
    });
  });

  test("states the debt as a positive amount", () => {
    // "你還有 -$320 未結清" is arithmetic, not a sentence.
    const payload = buildNudgeNotification({
      groupId: "group_1",
      groupName: "G",
      fromName: "A",
      balanceMinor: -50,
      currency: "TWD",
    });

    expect(payload.body).not.toContain("-");
  });

  test("does not share the group's entry tag", () => {
    const nudge = buildNudgeNotification({
      groupId: "group_1", groupName: "G", fromName: "A", balanceMinor: -1, currency: "TWD",
    });
    const expense = buildExpenseNotification({
      groupId: "group_1", groupName: "G", actorName: "A", title: "a", amountMinor: 1, currency: "TWD", kind: "expense",
    });

    // Sharing a tag would let a routine expense notification replace the
    // reminder on the lock screen before it was read.
    expect(nudge.tag).not.toBe(expense.tag);
  });
});

describe("notifyNudge", () => {
  test("delivers only to the member's own endpoints", async () => {
    const asked: Array<[string, string]> = [];
    const sent: string[] = [];

    const outcome = await notifyNudge({
      repository: makeRepository({
        async targetsForMember(groupId, memberId) {
          asked.push([groupId, memberId]);
          return { group_name: "東京旅行", actor_name: null, subscriptions: [subscription(7)] };
        },
        async targetsForGroup() {
          throw new Error("a nudge must never fan out to the group");
        },
      }),
      vapid,
      groupId: "group_1",
      toMemberId: "member_bob",
      groupName: "東京旅行",
      fromName: "Alice",
      balanceMinor: -32000,
      currency: "TWD",
      send: async (target, payload) => {
        sent.push(`${target.endpoint}|${payload.body}`);
        return { statusCode: 201 };
      },
    });

    expect(asked).toEqual([["group_1", "member_bob"]]);
    expect(outcome.sent).toBe(1);
    expect(sent).toEqual(["https://push.example/7|Alice 提醒你還有 $320 未結清"]);
  });

  test("swallows a failure — the nudge row and its cooldown already exist", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});

    const outcome = await notifyNudge({
      repository: makeRepository({
        async targetsForMember() {
          throw new Error("database unreachable");
        },
      }),
      vapid,
      groupId: "group_1",
      toMemberId: "member_bob",
      groupName: null,
      fromName: null,
      balanceMinor: -1,
      currency: "TWD",
      send: async () => ({ statusCode: 201 }),
    });

    expect(outcome).toEqual({ sent: 0, pruned: 0, failed: 0 });
    logged.mockRestore();
  });
});

describe("notifyMemberJoined", () => {
  test("tells the rest of the group, using the joiner's name", async () => {
    const bodies: string[] = [];

    const outcome = await notifyMemberJoined({
      repository: makeRepository({
        async targetsForGroup() {
          return { group_name: "東京旅行", actor_name: "Bob", subscriptions: [subscription(1)] };
        },
      }),
      vapid,
      groupId: "group_1",
      actorUserId: "user_bob",
      send: async (_target, payload) => {
        bodies.push(payload.body);
        return { statusCode: 201 };
      },
    });

    expect(outcome.sent).toBe(1);
    // targetsForGroup excludes the actor, so the joiner is not told they joined.
    expect(bodies).toEqual(["Bob 加入了群組"]);
  });
});

describe("buildErrorAlertNotification", () => {
  test("says what broke and how widely, which is what decides whether to open the laptop", () => {
    const payload = buildErrorAlertNotification({
      fingerprint: "fp_1",
      message: "TypeError: cannot read balance of undefined",
      occurrences: 24,
      isNew: true,
    });

    expect(payload.title).toContain("新錯誤");
    expect(payload.body).toContain("TypeError: cannot read balance of undefined");
    expect(payload.body).toContain("24");
  });

  test("a single occurrence does not get a count", () => {
    const payload = buildErrorAlertNotification({
      fingerprint: "fp_1",
      message: "boom",
      occurrences: 1,
      isNew: true,
    });

    expect(payload.body).toBe("boom");
  });

  test("a returning bug is titled differently from a new one", () => {
    const back = buildErrorAlertNotification({ fingerprint: "fp_1", message: "boom", occurrences: 2, isNew: false });

    expect(back.title).not.toContain("新錯誤");
  });

  test("links to the fingerprint's drill-down, using the parameter the console reads", () => {
    // adminRoute.ts parses `err`, not `fingerprint` - the obvious guess lands
    // on the unfiltered error list.
    const payload = buildErrorAlertNotification({
      fingerprint: "fp/1+2",
      message: "boom",
      occurrences: 1,
      isNew: true,
    });

    expect(payload.url).toBe("/admin?tab=errors&err=fp%2F1%2B2");
  });

  test("a long message is truncated, not wrapped onto a lock screen", () => {
    const payload = buildErrorAlertNotification({
      fingerprint: "fp_1",
      message: "x".repeat(300),
      occurrences: 1,
      isNew: true,
    });

    expect(payload.body.length).toBeLessThan(100);
    expect(payload.body.endsWith("…")).toBe(true);
  });

  test("one tag per fingerprint, so a recurrence replaces rather than stacks", () => {
    expect(buildErrorAlertNotification({ fingerprint: "fp_1", message: "a", occurrences: 1, isNew: true }).tag).toBe(
      buildErrorAlertNotification({ fingerprint: "fp_1", message: "a", occurrences: 9, isNew: false }).tag,
    );
  });
});

describe("notifyErrorAlert", () => {
  test("fans out to the console's admins", async () => {
    const send = vi.fn(async () => ({ statusCode: 201 }));
    const repository = makeRepository({
      async targetsForAdmins() {
        return { group_name: null, actor_name: null, subscriptions: [subscription(1), subscription(2)] };
      },
    });

    const outcome = await notifyErrorAlert({
      repository,
      vapid,
      fingerprint: "fp_1",
      message: "boom",
      occurrences: 3,
      isNew: true,
      send,
    });

    expect(outcome.sent).toBe(2);
  });

  test("no admin has enabled push -> nothing sent, nothing thrown", async () => {
    const send = vi.fn(async () => ({ statusCode: 201 }));

    const outcome = await notifyErrorAlert({
      repository: makeRepository(),
      vapid,
      fingerprint: "fp_1",
      message: "boom",
      occurrences: 1,
      isNew: true,
      send,
    });

    expect(outcome).toEqual({ sent: 0, pruned: 0, failed: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  test("a lookup failure never escapes into the crash-report path", async () => {
    // The error row is already written. Failing to page somebody about it must
    // not turn the report into a 500 and lose the report too.
    vi.spyOn(console, "error").mockImplementation(() => {});
    const repository = makeRepository({
      async targetsForAdmins() {
        throw new Error("database is down");
      },
    });

    await expect(
      notifyErrorAlert({
        repository,
        vapid,
        fingerprint: "fp_1",
        message: "boom",
        occurrences: 1,
        isNew: true,
      }),
    ).resolves.toEqual({ sent: 0, pruned: 0, failed: 0 });

    vi.restoreAllMocks();
  });
});
