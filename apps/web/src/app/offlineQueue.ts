import type { CreateExpenseRequest } from "../contracts/schemas";
import type { Expense } from "./appTypes";
import { draftToExpense } from "./cloudAdapters";
import type { CloudGroupData } from "./cloudStore";
import {
  applyExpenseToAggregates,
  applyExpenseToBalances,
  removeExpenseFromAggregates,
  removeExpenseFromBalances,
} from "./detailAggregates";
import type { ExpenseDraft } from "./ExpenseComposerSheet";

const QUEUE_KEY = "equo.clean.offline_queue";
const QUEUE_VERSION = 1;

/**
 * Prefix for expense ids minted locally while offline. An expense carrying one
 * has never reached the server, which is exactly what the callers need to know:
 * the UI badges it as 待送出, and cloudStore routes an edit/delete of it back
 * into the queue instead of issuing a PUT/DELETE against an id the server has
 * never heard of.
 */
export const LOCAL_EXPENSE_ID_PREFIX = "local-";

export function isLocalExpenseId(id: string): boolean {
  return id.startsWith(LOCAL_EXPENSE_ID_PREFIX);
}

export function newLocalExpenseId(): string {
  return `${LOCAL_EXPENSE_ID_PREFIX}${crypto.randomUUID()}`;
}

type QueuedWriteBase = {
  groupId: string;
  /**
   * The id the local cache knows this expense by - a local- id for a create,
   * the server's id for a replace/delete. Also the queue's primary key: the
   * collapse rules in appendWrite keep at most one entry per expenseId, which
   * is what makes applyQueuedWrites a straight fold with no ordering hazards.
   */
  expenseId: string;
  queuedAt: string;
};

export type QueuedWrite =
  | (QueuedWriteBase & {
      kind: "create";
      request: CreateExpenseRequest;
      draft: ExpenseDraft;
      /**
       * draftToExpense's kind override, set only for settlement transfers
       * (whose draft kind is "transfer" but which render as "settlement").
       */
      expenseKind?: Expense["kind"];
      /**
       * Receipt photos picked while offline. The image upload endpoint was
       * unreachable, so the data URLs ride along in the queue and are uploaded
       * at flush time, just before the create - see flushQueuedWrite.
       */
      imageDataUrls?: string[];
    })
  | (QueuedWriteBase & {
      kind: "replace";
      request: CreateExpenseRequest;
      draft: ExpenseDraft;
      imageDataUrls?: string[];
    })
  | (QueuedWriteBase & {
      kind: "delete";
      clientRequestId: string;
    });

export type QueueStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

type StoredQueue = {
  version: number;
  userId: string;
  writes: QueuedWrite[];
};

function browserStorage(): QueueStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function isQueuedWrite(value: unknown): value is QueuedWrite {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.groupId !== "string" || typeof candidate.expenseId !== "string") return false;
  if (candidate.kind === "delete") return typeof candidate.clientRequestId === "string";
  if (candidate.kind !== "create" && candidate.kind !== "replace") return false;
  return Boolean(candidate.request) && Boolean(candidate.draft);
}

function isStoredQueue(value: unknown): value is StoredQueue {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== QUEUE_VERSION) return false;
  if (typeof candidate.userId !== "string") return false;
  return Array.isArray(candidate.writes) && candidate.writes.every(isQueuedWrite);
}

/**
 * The queue for `userId`, or an empty queue when nothing is stored, the stored
 * queue belongs to a different account, or the JSON is corrupt/outdated. Never
 * throws: a broken queue must not stop the app from booting.
 */
export function loadQueue(userId: string, storage: QueueStorage | null = browserStorage()): QueuedWrite[] {
  const raw = storage?.getItem(QUEUE_KEY);
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }

  if (!isStoredQueue(parsed)) return [];
  if (parsed.userId !== userId) return [];
  return parsed.writes;
}

/**
 * Persist the queue. Returns false when the write failed - in practice a
 * QuotaExceededError from a queued receipt photo (a downscaled JPEG data URL
 * runs ~100-200KB against a ~5MB localStorage budget). The caller must treat
 * false as "this write was NOT saved" and surface the original network error,
 * because silently swallowing it would tell the user their expense is safely
 * queued when nothing was written down.
 */
export function saveQueue(
  userId: string,
  writes: QueuedWrite[],
  storage: QueueStorage | null = browserStorage(),
): boolean {
  if (!storage) return false;
  const stored: StoredQueue = { version: QUEUE_VERSION, userId, writes };
  try {
    storage.setItem(QUEUE_KEY, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

export function clearQueue(storage: QueueStorage | null = browserStorage()) {
  storage?.removeItem(QUEUE_KEY);
}

/**
 * Add a write to the queue, collapsing it against any pending write for the
 * same expense so a burst of offline edits sends one request instead of a
 * replay of every keystroke-level change:
 *
 * - replace over a pending create  -> the create carries the new payload
 *   (the expense still does not exist server-side, so there is nothing to PUT)
 * - replace over a pending replace -> last one wins
 * - delete  over a pending create  -> both vanish (created and deleted while
 *   offline: the server never needs to hear about it at all)
 * - delete  over a pending replace -> just the delete survives
 */
export function appendWrite(writes: QueuedWrite[], write: QueuedWrite): QueuedWrite[] {
  const index = writes.findIndex((existing) => existing.expenseId === write.expenseId);
  if (index === -1) return [...writes, write];

  const existing = writes[index];
  const without = [...writes.slice(0, index), ...writes.slice(index + 1)];

  if (write.kind === "delete") {
    return existing.kind === "create" ? without : [...without, write];
  }

  if (write.kind === "replace" && existing.kind === "create") {
    const merged: QueuedWrite = {
      ...existing,
      request: { ...write.request, client_request_id: existing.request.client_request_id },
      draft: write.draft,
      imageDataUrls: write.imageDataUrls,
    };
    return [...without, merged];
  }

  return [...without, write];
}

export function removeWrite(writes: QueuedWrite[], expenseId: string): QueuedWrite[] {
  return writes.filter((write) => write.expenseId !== expenseId);
}

export function findWrite(writes: QueuedWrite[], expenseId: string): QueuedWrite | undefined {
  return writes.find((write) => write.expenseId === expenseId);
}

export function countWritesForGroup(writes: QueuedWrite[], groupId: string): number {
  return writes.filter((write) => write.groupId === groupId).length;
}

/**
 * The Expense a queued create/replace renders as before it reaches the server.
 * Built through draftToExpense with a synthesised response so the optimistic
 * row is byte-for-byte the same shape as the one an online write produces.
 */
/**
 * Every receipt a queued write will end up with: the ones already in the bucket
 * followed by the ones still waiting to be uploaded.
 *
 * Reads a legacy single `imageDataUrl` too. A queue is persisted in
 * localStorage and survives a deploy, so the first flush after this shipped can
 * be draining entries written by the previous build - and dropping their photo
 * would lose a file the user cannot get back.
 */
function queuedReceipts(write: QueuedWrite): string[] {
  if (write.kind === "delete") return [];
  const legacy = (write as { imageDataUrl?: string }).imageDataUrl;
  const pending = write.imageDataUrls ?? (legacy ? [legacy] : []);
  return [...(write.draft.imageUrls ?? []), ...pending];
}

export function queuedExpense(write: QueuedWrite): Expense | null {
  if (write.kind === "delete") return null;
  const expense = draftToExpense(
    write.draft,
    {
      id: write.expenseId,
      title: write.request.title,
      amount_minor: write.request.amount_minor,
      currency: write.request.currency,
    },
    write.kind === "create" ? write.expenseKind : undefined,
  );
  return {
    ...expense,
    expenseDate: write.request.expense_date,
    // Receipts picked offline have no uploaded URL yet; show the local data
    // URLs so the row and the detail dialog render the photos instead of an
    // empty thumbnail. They go after the already-uploaded ones, matching the
    // order the composer showed and the order the flush uploads them in.
    ...(queuedReceipts(write).length > 0
      ? { imageUrl: queuedReceipts(write)[0], imageUrls: queuedReceipts(write) }
      : {}),
  };
}

/**
 * Fold pending writes over a freshly-fetched group detail.
 *
 * A background refresh (app resume, reconnect, pull-to-refresh) replaces the
 * cached detail with server truth, which does not yet include anything still
 * sitting in the queue. Without this the user watches their offline entries
 * blink out of existence and come back seconds later when the flush lands.
 * Balances and aggregates are patched the same way the online mutation paths
 * patch them, so the totals shown match the rows shown.
 */
export function applyQueuedWrites(data: CloudGroupData, writes: QueuedWrite[]): CloudGroupData {
  const relevant = writes.filter((write) => write.groupId === data.group.id);
  if (relevant.length === 0) return data;

  const memberIds = data.members.map((member) => member.id);
  const currency = data.group.currency;

  return relevant.reduce<CloudGroupData>((current, write) => {
    const index = current.expenses.findIndex((expense) => expense.id === write.expenseId);
    const previous = index === -1 ? undefined : current.expenses[index];

    const balancesAfterRemove = previous
      ? removeExpenseFromBalances(current.balances, previous, memberIds, currency)
      : current.balances;
    const aggregatesAfterRemove = previous
      ? removeExpenseFromAggregates(current.aggregates, previous, memberIds)
      : current.aggregates;

    if (write.kind === "delete") {
      return {
        ...current,
        expenses: current.expenses.filter((expense) => expense.id !== write.expenseId),
        balances: balancesAfterRemove,
        aggregates: aggregatesAfterRemove,
      };
    }

    const next = queuedExpense(write);
    if (!next) return current;

    const expenses =
      index === -1
        ? [next, ...current.expenses]
        : [...current.expenses.slice(0, index), next, ...current.expenses.slice(index + 1)];

    return {
      ...current,
      expenses,
      balances: applyExpenseToBalances(balancesAfterRemove, next, memberIds, currency),
      aggregates: applyExpenseToAggregates(aggregatesAfterRemove, next, memberIds),
    };
  }, data);
}
