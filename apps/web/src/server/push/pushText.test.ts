import { describe, expect, test, vi } from "vitest";
import { fill, pushText } from "./pushText.js";
import { buildCommentNotification, buildExpenseNotification } from "./pushNotification.js";
import { deliverPush, type PushSendFn } from "./pushSender.js";
import type { PushRepository, PushSubscriptionRecord } from "../repositories/pushRepository.js";

describe("pushText", () => {
  test("picks the dictionary the device asked for", () => {
    expect(pushText("en").fallbackActorName).toBe("Someone");
    expect(pushText("zh-Hant").fallbackActorName).toBe("有人");
  });

  test.each([[null], [undefined], [""], ["ja"], ["not-a-locale"]])(
    "%s falls back to 繁體中文, not to English",
    (locale) => {
      // Devices that subscribed before locale existed report nothing. Switching
      // them to English would change the language on somebody's phone without
      // being asked; leaving them where they were is the conservative answer.
      expect(pushText(locale as string | null).fallbackActorName).toBe("有人");
    },
  );
});

describe("fill", () => {
  test("substitutes every placeholder", () => {
    expect(fill("{who} owes {amount}", { who: "Alice", amount: "NT$300" })).toBe("Alice owes NT$300");
  });

  test("accepts numbers", () => {
    expect(fill("{count} times", { count: 4 })).toBe("4 times");
  });

  test("leaves an unknown placeholder alone rather than blanking it", () => {
    // A silently empty gap in a sentence is harder to notice, and to debug,
    // than the placeholder showing through.
    expect(fill("{who} said {oops}", { who: "Alice" })).toBe("Alice said {oops}");
  });
});

describe("builders honour the recipient locale", () => {
  const base = {
    groupId: "group_1",
    groupName: "Tokyo trip",
    actorName: "Alice",
    title: "Dinner",
    amountMinor: 120000,
    currency: "TWD",
    kind: "expense",
  };

  test("the same event reads in each recipient's language", () => {
    expect(buildExpenseNotification({ ...base, locale: "en" }).body).toBe("Alice added Dinner $1,200");
    expect(buildExpenseNotification({ ...base, locale: "zh-Hant" }).body).toBe("Alice 記了一筆：Dinner $1,200");
  });

  test("an unset locale keeps the language those devices already had", () => {
    expect(buildExpenseNotification(base).body).toBe("Alice 記了一筆：Dinner $1,200");
  });

  test("the action button label is translated too", () => {
    expect(buildExpenseNotification({ ...base, locale: "en" }).actions?.[0].title).toBe("Add expense");
  });

  test("a comment quotes the body in either language", () => {
    const args = {
      groupId: "group_1",
      groupName: "Tokyo trip",
      actorName: "Alice",
      expenseTitle: "Dinner",
      expenseId: "expense_1",
      body: "I paid for this",
    };
    expect(buildCommentNotification({ ...args, locale: "en" }).body).toContain("I paid for this");
    expect(buildCommentNotification({ ...args, locale: "en" }).body).toContain("Alice");
    expect(buildCommentNotification({ ...args, locale: "zh-Hant" }).body).toContain("說：");
  });
});

describe("deliverPush across languages", () => {
  const vapid = { publicKey: "pub", privateKey: "priv", subject: "mailto:ops@example.com" };

  function subscription(index: number, locale: string | null): PushSubscriptionRecord {
    return { endpoint: `https://push.example/${index}`, p256dh: "key", auth: "auth", locale };
  }

  const repository = {
    async pruneSubscription() {
      return { deleted: 1 };
    },
    async logDelivery() {},
  } as unknown as Pick<PushRepository, "pruneSubscription" | "logDelivery">;

  test("each device gets the payload for its own language", async () => {
    const sent: Array<{ endpoint: string; body: string }> = [];
    const send: PushSendFn = async (sub, payload) => {
      sent.push({ endpoint: sub.endpoint, body: payload.body });
      return { statusCode: 201 };
    };

    await deliverPush({
      kind: "expense",
      subscriptions: [subscription(1, "en"), subscription(2, "zh-Hant"), subscription(3, null)],
      payloadFor: (locale) => ({
        title: "t",
        body: `body-${locale ?? "none"}`,
        url: "/",
        tag: "tag",
      }),
      vapid,
      repository,
      send,
    });

    expect(sent).toEqual([
      { endpoint: "https://push.example/1", body: "body-en" },
      { endpoint: "https://push.example/2", body: "body-zh-Hant" },
      { endpoint: "https://push.example/3", body: "body-none" },
    ]);
  });

  test("builds one payload per language, not one per device", async () => {
    // A group of twenty people reading one language must not pay for twenty
    // identical builds - and the memo keying has to treat null/""/undefined as
    // one bucket rather than three.
    const payloadFor = vi.fn((locale: string | null | undefined) => ({
      title: "t",
      body: `body-${locale ?? "none"}`,
      url: "/",
      tag: "tag",
    }));

    await deliverPush({
      kind: "expense",
      subscriptions: [
        subscription(1, "en"),
        subscription(2, "en"),
        subscription(3, "zh-Hant"),
        subscription(4, null),
        subscription(5, ""),
      ],
      payloadFor,
      vapid,
      repository,
      send: async () => ({ statusCode: 201 }),
    });

    expect(payloadFor).toHaveBeenCalledTimes(3);
  });
});
