import { describe, expect, test, vi } from "vitest";
import type { GroupDetail, GroupMemberSummary } from "./apiClient";
import type { CacheStorage } from "./cloudCache";
import { createCloudGroupsStore, type ApiClientLike } from "./cloudStore";
import type { ExpenseDraft } from "./ExpenseComposerSheet";

/**
 * The offline write queue end to end (see offlineQueue.ts for the pure parts).
 * The store is the only place that decides "queue this" vs "fail this", so
 * these cover the whole path: a network failure on the way out, the local echo
 * the user sees, and the flush once the connection comes back.
 */

function memoryStorage(): CacheStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
  };
}

const group1 = { id: "group_1", name: "Tokyo Trip", currency: "TWD", owner_member_id: "member_1" };
const member1: GroupMemberSummary = {
  id: "member_1",
  group_id: "group_1",
  user_id: "user_1",
  display_name: "Alice",
  role: "owner",
  status: "active",
};

const groupDetail: GroupDetail = {
  group: group1,
  members: [member1],
  expenses: [],
  balances: [],
  expense_count: 0,
  spend_total_minor: 0,
  spend_by_day: [],
  spend_by_category: [],
  member_day_shares: [],
};

const baseDraft: ExpenseDraft = {
  title: "Lunch",
  amountMinor: 1000,
  createdAt: "2026-07-04T10:00:00.000Z",
  payerId: "member_1",
  shareMemberIds: ["member_1"],
  category: "food",
};

function makeFakeApiClient(overrides: Partial<ApiClientLike> = {}): ApiClientLike {
  return {
    createGroup: vi.fn(),
    listGroups: vi.fn(async () => ({ groups: [group1] })),
    listArchivedGroups: vi.fn(async () => ({ groups: [] })),
    getGroupDetail: vi.fn(async () => groupDetail),
    listExpensesPage: vi.fn(async () => ({ expenses: [] })),
    updateGroup: vi.fn(),
    createVirtualMember: vi.fn(),
    renameGroupMember: vi.fn(),
    removeGroupMember: vi.fn(),
    archiveGroup: vi.fn(),
    unarchiveGroup: vi.fn(),
    deleteGroup: vi.fn(),
    createInvite: vi.fn(),
    acceptInvite: vi.fn(),
    createExpense: vi.fn(async () => ({ expense: { id: "expense_1", title: "Lunch", amount_minor: 1000, currency: "TWD" } })),
    replaceExpense: vi.fn(async () => ({ expense: { id: "expense_1", title: "Lunch", amount_minor: 1000, currency: "TWD" } })),
    deleteExpense: vi.fn(async () => ({ expense: { id: "expense_1" } })),
    uploadGroupImage: vi.fn(async () => ({ image: { url: "https://cdn.equo.local/image.jpg" } })),
    ...overrides,
  } as ApiClientLike;
}

function networkError(): Error & { code?: string } {
  const error: Error & { code?: string } = new Error("Failed to fetch");
  error.code = "NETWORK_ERROR";
  return error;
}

function unreachable() {
  return vi.fn(async () => {
    throw networkError();
  });
}

async function openedStore(
  overrides: Partial<ApiClientLike> = {},
  storeOverrides: { cacheStorage?: CacheStorage; onWriteDropped?: () => void } = {},
) {
  const cacheStorage = storeOverrides.cacheStorage ?? memoryStorage();
  const apiClient = makeFakeApiClient(overrides);
  const store = createCloudGroupsStore({
    apiClient,
    onSessionExpired: vi.fn(),
    userId: "user_1",
    cacheStorage,
    onWriteDropped: storeOverrides.onWriteDropped,
  });
  await store.refreshGroupDetail("group_1");
  return { store, apiClient, cacheStorage };
}

describe("offline queue: recording", () => {
  test("an unreachable server queues the expense and shows it immediately", async () => {
    const { store, cacheStorage } = await openedStore({ createExpense: unreachable() });

    // Resolves rather than throwing: from the user's point of view the entry
    // is recorded, which is the entire purpose of the queue.
    await expect(store.addExpense("group_1", baseDraft, "TWD")).resolves.toBeUndefined();

    const state = store.getState();
    expect(state.pendingWrites).toHaveLength(1);
    expect(state.groupDetails.group_1.expenses).toHaveLength(1);
    expect(state.groupDetails.group_1.expenses[0].title).toBe("Lunch");
    expect(state.groupDetails.group_1.aggregates.expenseCount).toBe(1);
    // Written down synchronously - a reload while still offline must not lose it.
    expect(cacheStorage.getItem("equo.clean.offline_queue")).not.toBeNull();
  });

  test("a server rejection still fails loudly instead of being queued", async () => {
    const rejected: Error & { code?: string } = new Error("Invalid expense");
    rejected.code = "INVALID_EXPENSE";
    const { store } = await openedStore({
      createExpense: vi.fn(async () => {
        throw rejected;
      }),
    });

    await expect(store.addExpense("group_1", baseDraft, "TWD")).rejects.toThrow("Invalid expense");
    expect(store.getState().pendingWrites).toEqual([]);
  });

  test("a settlement made offline queues like any other entry", async () => {
    const { store } = await openedStore({ createExpense: unreachable() });

    await store.settleTransfer("group_1", "member_1", "member_2", 5000, "TWD");

    expect(store.getState().pendingWrites).toHaveLength(1);
    expect(store.getState().groupDetails.group_1.expenses[0].kind).toBe("settlement");
  });

  test("a write that cannot be written down surfaces the network error instead of claiming success", async () => {
    const fullStorage: CacheStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    const { store } = await openedStore({ createExpense: unreachable() }, { cacheStorage: fullStorage });

    await expect(store.addExpense("group_1", baseDraft, "TWD")).rejects.toThrow("Failed to fetch");
    expect(store.getState().pendingWrites).toEqual([]);
  });

  test("the queue survives a reload and is picked up by a new store", async () => {
    const cacheStorage = memoryStorage();
    const { store } = await openedStore({ createExpense: unreachable() }, { cacheStorage });
    await store.addExpense("group_1", baseDraft, "TWD");

    const revived = createCloudGroupsStore({
      apiClient: makeFakeApiClient(),
      onSessionExpired: vi.fn(),
      userId: "user_1",
      cacheStorage,
    });

    expect(revived.getState().pendingWrites).toHaveLength(1);
  });
});

describe("offline queue: editing before it is sent", () => {
  test("editing a queued expense folds into its pending create", async () => {
    const replaceExpense = vi.fn();
    const { store } = await openedStore({ createExpense: unreachable(), replaceExpense });

    await store.addExpense("group_1", baseDraft, "TWD");
    const localId = store.getState().groupDetails.group_1.expenses[0].id;
    await store.editExpense("group_1", localId, { ...baseDraft, title: "Dinner", amountMinor: 2500 }, "TWD");

    // One queued write, not two, and no PUT attempted against an id the server
    // has never heard of.
    expect(replaceExpense).not.toHaveBeenCalled();
    expect(store.getState().pendingWrites).toHaveLength(1);
    expect(store.getState().groupDetails.group_1.expenses[0].title).toBe("Dinner");
    expect(store.getState().groupDetails.group_1.aggregates.spendTotalMinor).toBe(2500);
  });

  test("deleting a queued expense retracts it silently", async () => {
    const deleteExpense = vi.fn();
    const { store } = await openedStore({ createExpense: unreachable(), deleteExpense });

    await store.addExpense("group_1", baseDraft, "TWD");
    const localId = store.getState().groupDetails.group_1.expenses[0].id;
    await store.deleteExpense("group_1", localId);

    expect(deleteExpense).not.toHaveBeenCalled();
    expect(store.getState().pendingWrites).toEqual([]);
    expect(store.getState().groupDetails.group_1.expenses).toEqual([]);
    expect(store.getState().groupDetails.group_1.aggregates.expenseCount).toBe(0);
  });

  test("a background refresh keeps queued entries visible", async () => {
    const { store } = await openedStore({ createExpense: unreachable() });

    await store.addExpense("group_1", baseDraft, "TWD");
    // Server truth knows nothing about the queued row; the refresh must not
    // make it blink out of existence until the flush lands.
    await store.refreshGroupDetail("group_1");

    expect(store.getState().groupDetails.group_1.expenses).toHaveLength(1);
    expect(store.getState().groupDetails.group_1.aggregates.expenseCount).toBe(1);
  });
});

describe("offline queue: flushing", () => {
  function createThenSucceed() {
    return vi
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockResolvedValueOnce({ expense: { id: "expense_9", title: "Lunch", amount_minor: 1000, currency: "TWD" } });
  }

  /**
   * What get_group_detail returns once a queued create has landed. The flush
   * kicks off a background resync, so without this the fake would answer with
   * an empty group and every post-flush assertion would pass vacuously.
   */
  function groupDetailFake(imageUrl?: string) {
    // Empty on the initial open, populated from the resync the flush triggers.
    return vi.fn().mockResolvedValueOnce(groupDetail).mockResolvedValue(detailAfterFlush(imageUrl));
  }

  function detailAfterFlush(imageUrl?: string): GroupDetail {
    return {
      ...groupDetail,
      expenses: [
        {
          id: "expense_9",
          group_id: "group_1",
          title: "Lunch",
          kind: "expense",
          category: "food",
          amount_minor: 1000,
          currency: "TWD",
          expense_date: "2026-07-04",
          image_url: imageUrl ?? null,
          created_at: "2026-07-04T10:00:00.000Z",
          version: 1,
          client_request_id: "req_1",
          expense_payments: [{ payer_member_id: "member_1", amount_minor: 1000, currency: "TWD" }],
          expense_shares: [{ member_id: "member_1", share_type: "fixed", amount_minor: 1000 }],
        },
      ],
      expense_count: 1,
      spend_total_minor: 1000,
    };
  }

  test("flushPendingWrites sends the queued create and adopts the server id", async () => {
    const createExpense = createThenSucceed();
    const { store } = await openedStore({ createExpense, getGroupDetail: groupDetailFake() });

    await store.addExpense("group_1", baseDraft, "TWD");
    expect(store.getState().groupDetails.group_1.expenses[0].id).toMatch(/^local-/);

    await store.flushPendingWrites();

    expect(createExpense).toHaveBeenCalledTimes(2);
    expect(store.getState().pendingWrites).toEqual([]);
    // The row must stop carrying its local- id, or a later edit would address
    // something the server does not have.
    expect(store.getState().groupDetails.group_1.expenses.map((expense) => expense.id)).toEqual(["expense_9"]);
  });

  test("the flushed request reuses the original client_request_id", async () => {
    const createExpense = createThenSucceed();
    const { store } = await openedStore({ createExpense });

    await store.addExpense("group_1", baseDraft, "TWD");
    await store.flushPendingWrites();

    const firstAttempt = createExpense.mock.calls[0][1] as { client_request_id: string };
    const retry = createExpense.mock.calls[1][1] as { client_request_id: string };
    // create_expense dedupes on this key, so a first attempt that actually
    // landed before the connection dropped cannot become a duplicate.
    expect(retry.client_request_id).toBe(firstAttempt.client_request_id);
  });

  test("still being offline leaves the queue untouched", async () => {
    const createExpense = vi.fn().mockRejectedValue(networkError());
    const { store } = await openedStore({ createExpense });

    await store.addExpense("group_1", baseDraft, "TWD");
    await store.flushPendingWrites();

    expect(store.getState().pendingWrites).toHaveLength(1);
    expect(store.getState().flushingWrites).toBe(false);
  });

  test("a queued write the server refuses is dropped, not retried forever", async () => {
    const rejected: Error & { code?: string } = new Error("Group is gone");
    rejected.code = "GROUP_NOT_FOUND";
    const createExpense = vi.fn().mockRejectedValueOnce(networkError()).mockRejectedValueOnce(rejected);
    const onWriteDropped = vi.fn();
    const { store } = await openedStore({ createExpense }, { onWriteDropped });

    await store.addExpense("group_1", baseDraft, "TWD");
    await store.flushPendingWrites();

    expect(store.getState().pendingWrites).toEqual([]);
    expect(onWriteDropped).toHaveBeenCalledTimes(1);
  });

  test("a queued receipt photo is uploaded before the expense itself", async () => {
    const createExpense = createThenSucceed();
    const uploadGroupImage = vi.fn(async () => ({ image: { url: "https://cdn.equo.local/receipt.jpg" } }));
    const { store } = await openedStore({
      createExpense,
      uploadGroupImage,
      getGroupDetail: groupDetailFake("https://cdn.equo.local/receipt.jpg"),
    });

    await store.addExpense("group_1", { ...baseDraft, imageDataUrls: ["data:image/jpeg;base64,AAA"] }, "TWD");
    expect(store.getState().groupDetails.group_1.expenses[0].imageUrl).toBe("data:image/jpeg;base64,AAA");

    await store.flushPendingWrites();

    expect(uploadGroupImage).toHaveBeenCalledTimes(1);
    expect((createExpense.mock.calls[1][1] as { image_urls?: string[] }).image_urls).toEqual([
      "https://cdn.equo.local/receipt.jpg",
    ]);
    expect(store.getState().groupDetails.group_1.expenses[0].imageUrl).toBe("https://cdn.equo.local/receipt.jpg");
  });

  test("several queued writes go out oldest first", async () => {
    const createExpense = vi
      .fn()
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(networkError())
      .mockResolvedValue({ expense: { id: "expense_9", title: "Lunch", amount_minor: 1000, currency: "TWD" } });
    const { store } = await openedStore({ createExpense });

    await store.addExpense("group_1", { ...baseDraft, title: "First" }, "TWD");
    await store.addExpense("group_1", { ...baseDraft, title: "Second" }, "TWD");
    await store.flushPendingWrites();

    expect(store.getState().pendingWrites).toEqual([]);
    const sentTitles = createExpense.mock.calls.slice(2).map((call) => (call[1] as { title: string }).title);
    expect(sentTitles).toEqual(["First", "Second"]);
  });
});
