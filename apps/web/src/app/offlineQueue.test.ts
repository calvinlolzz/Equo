import { describe, expect, test } from "vitest";
import type { CreateExpenseRequest } from "../contracts/schemas";
import type { Expense } from "./appTypes";
import type { CloudGroupData } from "./cloudStore";
import type { ExpenseDraft } from "./ExpenseComposerSheet";
import {
  appendWrite,
  applyQueuedWrites,
  countWritesForGroup,
  findWrite,
  isLocalExpenseId,
  loadQueue,
  newLocalExpenseId,
  queuedExpense,
  removeWrite,
  saveQueue,
  type QueuedWrite,
  type QueueStorage,
} from "./offlineQueue";

function memoryStorage(): QueueStorage {
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

const draft: ExpenseDraft = {
  title: "Lunch",
  amountMinor: 3000,
  createdAt: "2026-07-04T10:00:00.000Z",
  payerId: "member_1",
  shareMemberIds: ["member_1", "member_2"],
  category: "food",
};

function makeRequest(overrides: Partial<CreateExpenseRequest> = {}): CreateExpenseRequest {
  return {
    client_request_id: "req_1",
    title: "Lunch",
    kind: "expense",
    category: "food",
    amount_minor: 3000,
    currency: "TWD",
    expense_date: "2026-07-04",
    expense_payments: [{ payer_member_id: "member_1", amount_minor: 3000, currency: "TWD" }],
    expense_shares: [
      { member_id: "member_1", share_type: "fixed", amount_minor: 1500 },
      { member_id: "member_2", share_type: "fixed", amount_minor: 1500 },
    ],
    ...overrides,
  };
}

function createWrite(expenseId: string, overrides: Partial<Extract<QueuedWrite, { kind: "create" }>> = {}): QueuedWrite {
  return {
    kind: "create",
    groupId: "group_1",
    expenseId,
    queuedAt: "2026-07-04T10:00:00.000Z",
    request: makeRequest(),
    draft,
    ...overrides,
  };
}

function replaceWrite(expenseId: string, title: string): QueuedWrite {
  return {
    kind: "replace",
    groupId: "group_1",
    expenseId,
    queuedAt: "2026-07-04T11:00:00.000Z",
    request: makeRequest({ client_request_id: "req_2", title }),
    draft: { ...draft, title },
  };
}

function deleteWrite(expenseId: string): QueuedWrite {
  return {
    kind: "delete",
    groupId: "group_1",
    expenseId,
    queuedAt: "2026-07-04T12:00:00.000Z",
    clientRequestId: "req_3",
  };
}

function makeGroupData(expenses: Expense[] = []): CloudGroupData {
  return {
    group: { id: "group_1", name: "Tokyo", currency: "TWD" },
    members: [
      { id: "member_1", name: "Alice" },
      { id: "member_2", name: "Bob" },
    ],
    expenses,
    balances: [
      { memberId: "member_1", balance: { amount_minor: 0, currency: "TWD" } },
      { memberId: "member_2", balance: { amount_minor: 0, currency: "TWD" } },
    ],
    aggregates: { expenseCount: 0, spendTotalMinor: 0, spendByDay: [], spendByCategory: [], memberDayShares: [] },
  } as CloudGroupData;
}

describe("local expense ids", () => {
  test("newLocalExpenseId is recognised as local and a server id is not", () => {
    expect(isLocalExpenseId(newLocalExpenseId())).toBe(true);
    expect(isLocalExpenseId("6f9619ff-8b86-d011-b42d-00c04fc964ff")).toBe(false);
  });
});

describe("queue persistence", () => {
  test("round-trips through storage for the same user", () => {
    const storage = memoryStorage();
    expect(saveQueue("user_1", [createWrite("local-1")], storage)).toBe(true);
    expect(loadQueue("user_1", storage)).toHaveLength(1);
  });

  test("a queue belonging to another user is ignored, not served", () => {
    const storage = memoryStorage();
    saveQueue("user_1", [createWrite("local-1")], storage);
    expect(loadQueue("user_2", storage)).toEqual([]);
  });

  test("corrupt JSON loads as an empty queue instead of throwing", () => {
    const storage = memoryStorage();
    storage.setItem("equo.clean.offline_queue", "{not json");
    expect(loadQueue("user_1", storage)).toEqual([]);
  });

  test("saveQueue reports failure when storage rejects the write", () => {
    const storage: QueueStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {},
    };
    // The caller must be able to tell "queued" from "silently lost" - a full
    // localStorage is exactly what a queued receipt photo causes.
    expect(saveQueue("user_1", [createWrite("local-1")], storage)).toBe(false);
  });
});

describe("appendWrite collapsing", () => {
  test("keeps unrelated writes side by side", () => {
    const queue = appendWrite(appendWrite([], createWrite("local-1")), createWrite("local-2"));
    expect(queue).toHaveLength(2);
    expect(countWritesForGroup(queue, "group_1")).toBe(2);
    expect(countWritesForGroup(queue, "group_2")).toBe(0);
  });

  test("editing a pending create rewrites the create, keeping its client_request_id", () => {
    const queue = appendWrite([createWrite("local-1")], replaceWrite("local-1", "Dinner"));

    expect(queue).toHaveLength(1);
    expect(queue[0].kind).toBe("create");
    // Same idempotency key: the retry after reconnect must not be able to
    // land as a second expense.
    expect(queue[0].kind !== "delete" && queue[0].request.client_request_id).toBe("req_1");
    expect(queue[0].kind !== "delete" && queue[0].request.title).toBe("Dinner");
  });

  test("deleting a pending create retracts it entirely", () => {
    const queue = appendWrite([createWrite("local-1")], deleteWrite("local-1"));
    expect(queue).toEqual([]);
  });

  test("deleting a pending replace leaves only the delete", () => {
    const queue = appendWrite([replaceWrite("expense_1", "Dinner")], deleteWrite("expense_1"));
    expect(queue).toHaveLength(1);
    expect(queue[0].kind).toBe("delete");
  });

  test("a second edit of the same expense replaces the first", () => {
    const queue = appendWrite([replaceWrite("expense_1", "Dinner")], replaceWrite("expense_1", "Supper"));
    expect(queue).toHaveLength(1);
    expect(queue[0].kind !== "delete" && queue[0].request.title).toBe("Supper");
  });

  test("removeWrite and findWrite address entries by expense id", () => {
    const queue = appendWrite([createWrite("local-1")], createWrite("local-2"));
    expect(findWrite(queue, "local-2")?.expenseId).toBe("local-2");
    expect(removeWrite(queue, "local-1").map((write) => write.expenseId)).toEqual(["local-2"]);
  });
});

describe("queuedExpense", () => {
  test("builds the optimistic row from the frozen request", () => {
    const expense = queuedExpense(createWrite("local-1"));
    expect(expense?.id).toBe("local-1");
    expect(expense?.amountMinor).toBe(3000);
    expect(expense?.expenseDate).toBe("2026-07-04");
  });

  test("shows queued receipt photos from their data URLs", () => {
    const expense = queuedExpense(
      createWrite("local-1", { imageDataUrls: ["data:image/jpeg;base64,AAA", "data:image/jpeg;base64,BBB"] }),
    );
    expect(expense?.imageUrl).toBe("data:image/jpeg;base64,AAA");
    expect(expense?.imageUrls).toEqual(["data:image/jpeg;base64,AAA", "data:image/jpeg;base64,BBB"]);
  });

  test("still renders a photo queued by an older build, which wrote a single imageDataUrl", () => {
    // The queue lives in localStorage and survives a deploy, so the first flush
    // after multi-receipt shipped can be draining entries in the old shape.
    const legacy = { ...createWrite("local-1"), imageDataUrl: "data:image/jpeg;base64,OLD" };
    const expense = queuedExpense(legacy as typeof legacy & { imageDataUrls?: string[] });
    expect(expense?.imageUrl).toBe("data:image/jpeg;base64,OLD");
  });

  test("a delete has no row to render", () => {
    expect(queuedExpense(deleteWrite("expense_1"))).toBeNull();
  });
});

describe("applyQueuedWrites", () => {
  test("replays a queued create onto freshly-fetched server data", () => {
    const result = applyQueuedWrites(makeGroupData(), [createWrite("local-1")]);

    expect(result.expenses.map((expense) => expense.id)).toEqual(["local-1"]);
    expect(result.aggregates.expenseCount).toBe(1);
    expect(result.aggregates.spendTotalMinor).toBe(3000);
    // Alice paid 3000 and owes 1500 of it, so she is up 1500 and Bob down 1500.
    expect(result.balances.find((balance) => balance.memberId === "member_1")?.balance.amount_minor).toBe(1500);
    expect(result.balances.find((balance) => balance.memberId === "member_2")?.balance.amount_minor).toBe(-1500);
  });

  test("replays a queued delete by removing the server row and its balance effect", () => {
    const seeded = applyQueuedWrites(makeGroupData(), [createWrite("expense_1")]);
    const result = applyQueuedWrites(seeded, [deleteWrite("expense_1")]);

    expect(result.expenses).toEqual([]);
    expect(result.aggregates.expenseCount).toBe(0);
    expect(result.balances.every((balance) => balance.balance.amount_minor === 0)).toBe(true);
  });

  test("a queued replace nets out the old row instead of double counting", () => {
    const seeded = applyQueuedWrites(makeGroupData(), [createWrite("expense_1")]);
    const result = applyQueuedWrites(seeded, [replaceWrite("expense_1", "Dinner")]);

    expect(result.expenses).toHaveLength(1);
    expect(result.expenses[0].title).toBe("Dinner");
    expect(result.aggregates.expenseCount).toBe(1);
    expect(result.aggregates.spendTotalMinor).toBe(3000);
  });

  test("writes for other groups are left alone", () => {
    const other: QueuedWrite = { ...createWrite("local-9"), groupId: "group_2" };
    const result = applyQueuedWrites(makeGroupData(), [other]);
    expect(result.expenses).toEqual([]);
  });
});
