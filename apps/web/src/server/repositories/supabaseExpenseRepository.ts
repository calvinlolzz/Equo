import type { CreateExpenseRequest } from "../../contracts/schemas.js";
import { validateCreateExpenseRequest } from "../../contracts/validation.js";
import type { AuthenticatedContext } from "../auth/session.js";
import {
  beforeKeyset,
  columns,
  eq,
  inList,
  isNull,
  limit as limitTo,
  onConflict,
  order,
  query,
  type PostgrestClient,
} from "../db/postgrestClient.js";
import type { SupabaseStorageClient } from "../runtime/supabaseStorageClient.js";
import { urlToStoragePath } from "../runtime/supabaseStorageClient.js";
import {
  EXPENSE_NOT_FOUND,
  InvalidMemberError,
  NOT_A_GROUP_MEMBER,
  type DeletedExpenseRecord,
  type ExpensePageCursor,
  type ExpensePaymentRecord,
  type ExpenseRecord,
  type ExpenseRepository,
  type ExpenseShareRecord,
} from "./expenseRepository.js";

const EXPENSE_COLUMNS =
  "id,group_id,title,kind,category,amount_minor,currency,expense_date,note,transfer_to_member_id,created_at,version,client_request_id,image_url";

const MAX_EXPENSE_PAGE = 100;

/**
 * Fire-and-forget storage cleanup for an image URL that's about to become
 * unreferenced (a deleted expense's photo, a replaced one's, a group's previous
 * cover, a user's previous avatar). Never awaited by the caller's main flow - a
 * failed delete leaves an orphaned object in the bucket, which is a storage-cost
 * problem, not a correctness one, so it must never fail or delay the mutation it
 * follows. Only deletes URLs that resolve to a path in OUR bucket
 * (urlToStoragePath returns null for a Google profile picture or a data: URI).
 */
function cleanupOrphanedImage(storage: SupabaseStorageClient, imageUrl: string | null | undefined): void {
  const path = urlToStoragePath(imageUrl);
  if (!path) return;
  storage.deleteImage(path).catch((error) => {
    console.warn(`Failed to delete orphaned storage object ${path}:`, error);
  });
}

/**
 * Batch-fetches expense_payments/expense_shares for a set of expenses (one round
 * trip per table, regardless of how many expenses) and stitches them onto each
 * expense row. Shared by listExpenses and listExpensesPage so paging never
 * re-introduces the N+1 that listExpenses avoids.
 */
async function enrichExpensesWithPaymentsAndShares(
  client: PostgrestClient,
  expenses: ExpenseRecord[],
): Promise<ExpenseRecord[]> {
  if (expenses.length === 0) {
    return expenses;
  }

  const expenseIds = expenses.map((expense) => expense.id);

  const [payments, shares] = await Promise.all([
    client.select<ExpensePaymentRecord & { expense_id: string }>(
      "expense_payments",
      query(columns("expense_id,payer_member_id,amount_minor,currency"), inList("expense_id", expenseIds)),
    ),
    client.select<ExpenseShareRecord & { expense_id: string }>(
      "expense_shares",
      query(
        columns("expense_id,member_id,share_type,share_value,amount_minor"),
        inList("expense_id", expenseIds),
      ),
    ),
  ]);

  const paymentsByExpenseId = new Map<string, ExpensePaymentRecord[]>();
  for (const payment of payments) {
    const { expense_id, ...rest } = payment;
    const list = paymentsByExpenseId.get(expense_id) ?? [];
    list.push(rest);
    paymentsByExpenseId.set(expense_id, list);
  }

  const sharesByExpenseId = new Map<string, ExpenseShareRecord[]>();
  for (const share of shares) {
    const { expense_id, ...rest } = share;
    const list = sharesByExpenseId.get(expense_id) ?? [];
    list.push(rest);
    sharesByExpenseId.set(expense_id, list);
  }

  return expenses.map((expense) => ({
    ...expense,
    expense_payments: paymentsByExpenseId.get(expense.id) ?? [],
    expense_shares: sharesByExpenseId.get(expense.id) ?? [],
  }));
}

/**
 * The write RPCs signal business failures by raising a bare sentinel message
 * (see supabase/migrations/20260714100000_transactional_write_rpcs.sql), which
 * arrives here as the Error message. Translate them back into the typed errors
 * the routes already know how to map.
 */
function rethrowWriteRpcError(error: unknown): never {
  const message = error instanceof Error ? error.message : String(error);

  if (message.includes(NOT_A_GROUP_MEMBER)) {
    throw new Error(NOT_A_GROUP_MEMBER);
  }

  if (message.includes(EXPENSE_NOT_FOUND)) {
    throw new Error(EXPENSE_NOT_FOUND);
  }

  const invalidMember = /INVALID_MEMBER:\s*(\S+)/.exec(message);

  if (invalidMember) {
    throw new InvalidMemberError(invalidMember[1]);
  }

  throw error instanceof Error ? error : new Error(message);
}

export function createSupabaseExpenseRepository(
  client: PostgrestClient,
  storage?: SupabaseStorageClient,
): ExpenseRepository {
  async function listExpenseRows(
    groupId: string,
    options?: { limit: number; cursor?: ExpensePageCursor },
  ): Promise<ExpenseRecord[]> {
    const pageLimit = options ? Math.max(1, Math.min(options.limit, MAX_EXPENSE_PAGE)) : undefined;

    const expenses = await client.select<ExpenseRecord>(
      "expenses",
      query(
        columns(EXPENSE_COLUMNS),
        eq("group_id", groupId),
        isNull("deleted_at"),
        options?.cursor &&
          beforeKeyset(
            "expense_date",
            "created_at",
            options.cursor.beforeDate,
            options.cursor.beforeCreatedAt,
          ),
        order("expense_date.desc,created_at.desc"),
        pageLimit !== undefined && limitTo(pageLimit),
      ),
    );

    return enrichExpensesWithPaymentsAndShares(client, expenses);
  }

  return {
    /**
     * The expense, its payments and its shares are written by one transactional
     * RPC. Doing it as 1 + N + M separate PostgREST calls (which is what this
     * used to be) meant a failure partway through left a half-written expense
     * behind - an entry with an incomplete share set silently corrupts every
     * balance in the group, and nothing rolled it back. The RPC also owns the
     * membership gate, the cross-group member-id validation, and the
     * client_requests idempotency check, so a retried create returns the
     * original row instead of colliding with the unique index and 500ing.
     */
    async createExpense(context: AuthenticatedContext, groupId: string, request: CreateExpenseRequest) {
      const validation = validateCreateExpenseRequest(request);

      if (!validation.ok) {
        throw new Error(validation.issues[0]?.code ?? "INVALID_EXPENSE");
      }

      return client
        .rpc<ExpenseRecord>("create_expense", {
          p_group_id: groupId,
          p_user_id: context.user.id,
          p_payload: request,
        })
        .catch(rethrowWriteRpcError);
    },

    async replaceExpense(
      context: AuthenticatedContext,
      groupId: string,
      expenseId: string,
      request: CreateExpenseRequest,
    ) {
      const validation = validateCreateExpenseRequest(request);

      if (!validation.ok) {
        throw new Error(validation.issues[0]?.code ?? "INVALID_EXPENSE");
      }

      const result = await client
        .rpc<{ expense: ExpenseRecord; previous: DeletedExpenseRecord | null }>("replace_expense", {
          p_group_id: groupId,
          p_user_id: context.user.id,
          p_expense_id: expenseId,
          p_payload: request,
        })
        .catch(rethrowWriteRpcError);

      // The replaced row's image is now unreferenced - unless the edit kept it,
      // in which case deleting it would break the expense still using it.
      if (storage && result.previous && result.previous.image_url !== result.expense.image_url) {
        cleanupOrphanedImage(storage, result.previous.image_url);
      }

      return result;
    },

    async softDeleteExpense(
      context: AuthenticatedContext,
      groupId: string,
      expenseId: string,
      client_request_id: string,
    ) {
      // Membership gate, the version bump (which the old translated PATCH
      // silently dropped), the client_requests write, and the idempotent-replay
      // check all live in the RPC - one round trip, one transaction.
      const expense = await client
        .rpc<DeletedExpenseRecord>("soft_delete_expense", {
          p_group_id: groupId,
          p_user_id: context.user.id,
          p_expense_id: expenseId,
          p_client_request_id: client_request_id,
        })
        .catch(rethrowWriteRpcError);

      if (storage) {
        cleanupOrphanedImage(storage, expense.image_url);
      }

      return expense;
    },

    listExpenses(groupId: string) {
      return listExpenseRows(groupId);
    },

    listExpensesPage(groupId: string, options: { limit: number; cursor?: ExpensePageCursor }) {
      return listExpenseRows(groupId, options);
    },

    async recordClientRequest(groupId: string, client_request_id: string, resourceId: string) {
      await client.insert(
        "client_requests",
        { group_id: groupId, client_request_id, resource_id: resourceId },
        { query: onConflict("group_id,client_request_id"), prefer: "resolution=ignore-duplicates" },
      );
    },
  };
}
