import { describe, expect, test } from "vitest";
import type { NotificationRepository } from "../repositories/notificationRepository.js";
import {
  NOTIFICATION_LIST_LIMIT,
  handleDeleteNotifications,
  handleListNotifications,
  handleMarkNotificationsRead,
  normalizeNotificationIds,
} from "./notifications.js";

const context = {
  user: {
    id: "user_alice",
    google_sub: "google-alice",
    email: "alice@example.com",
    display_name: "Alice",
  },
};

const ID_A = "11111111-1111-4111-8111-111111111111";
const ID_B = "22222222-2222-4222-8222-222222222222";

function makeRepository(overrides: Partial<NotificationRepository> = {}): NotificationRepository {
  return {
    async list() {
      return { unread: 2, items: [] };
    },
    async markRead(_userId, ids) {
      return { marked: ids.length, unread: 0 };
    },
    async remove(_userId, ids) {
      return { deleted: ids.length, unread: 0 };
    },
    ...overrides,
  };
}

describe("the inbox", () => {
  test("the list is scoped to the caller, never to an id from the request", async () => {
    let seenUserId = "";
    let seenLimit = 0;
    const repository = makeRepository({
      async list(userId, limit) {
        seenUserId = userId;
        seenLimit = limit;
        return { unread: 0, items: [] };
      },
    });

    await handleListNotifications(repository, context);

    expect(seenUserId).toBe("user_alice");
    expect(seenLimit).toBe(NOTIFICATION_LIST_LIMIT);
  });

  test("an absent ids list means the whole inbox", async () => {
    let seen: string[] | null = null;
    const repository = makeRepository({
      async markRead(_userId, ids) {
        seen = ids;
        return { marked: 3, unread: 0 };
      },
    });

    await handleMarkNotificationsRead(repository, context, {});

    // The RPC reads [] as "everything unread", so the handler passes the empty
    // list through rather than inventing a second request shape.
    expect(seen).toEqual([]);
  });

  test("ids that cannot be uuids are dropped rather than sent to Postgres", () => {
    // A non-uuid in a uuid[] parameter is a 22P02, which the runtime turns into
    // a 500 - the wrong answer for "mark these read".
    expect(normalizeNotificationIds([ID_A, "not-a-uuid", 42, null, ID_B])).toEqual([ID_A, ID_B]);
    expect(normalizeNotificationIds("everything")).toEqual([]);
    expect(normalizeNotificationIds(undefined)).toEqual([]);
  });

  test("a very long id list is capped", () => {
    expect(normalizeNotificationIds(Array.from({ length: 250 }, () => ID_A))).toHaveLength(100);
  });
});

describe("clearing the inbox", () => {
  test("an absent ids list deletes everything", async () => {
    let seen: string[] | null = null;
    const repository = makeRepository({
      async remove(_userId, ids) {
        seen = ids;
        return { deleted: 5, unread: 0 };
      },
    });

    await handleDeleteNotifications(repository, context, {});

    expect(seen).toEqual([]);
  });

  test("it is scoped to the caller, never to an id from the request", async () => {
    let seenUserId = "";
    const repository = makeRepository({
      async remove(userId) {
        seenUserId = userId;
        return { deleted: 1, unread: 0 };
      },
    });

    await handleDeleteNotifications(repository, context, { ids: [ID_A] });

    expect(seenUserId).toBe("user_alice");
  });

  test("junk ids are dropped rather than sent to Postgres", async () => {
    let seen: string[] | null = null;
    const repository = makeRepository({
      async remove(_userId, ids) {
        seen = ids;
        return { deleted: 1, unread: 0 };
      },
    });

    await handleDeleteNotifications(repository, context, { ids: [ID_A, "nope", 7] });

    expect(seen).toEqual([ID_A]);
  });
});
