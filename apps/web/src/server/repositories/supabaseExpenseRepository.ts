import { validateCreateExpenseRequest } from "../../contracts/validation.js";
import type { CreateExpenseRequest } from "../../contracts/schemas.js";
import type { AuthenticatedContext } from "../auth/session.js";
import type { SupabaseStorageClient } from "../runtime/supabaseStorageClient.js";
import { urlToStoragePath } from "../runtime/supabaseStorageClient.js";
import type { SupabaseQueryClient } from "./supabaseGroupRepository.js";
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

/**
 * Fire-and-forget storage cleanup for an image URL that's about to become
 * unreferenced (a deleted expense's photo, a group's previous cover, a
 * user's previous avatar). Never awaited by the caller's main flow - a
 * failed delete just leaves an orphaned object in the bucket, which is a
 * storage-cost problem, not a correctness problem, so it must never fail or
 * delay the primary mutation (deleting the expense/updating the group/
 * updating the avatar). Only deletes URLs that resolve to a path in OUR
 * bucket (urlToStoragePath returns null for foreign URLs like Google
 * profile pictures or data: URIs).
 */
function cleanupOrphanedImage(storage: SupabaseStorageClient, imageUrl: string | null | undefined): void {
  const path = urlToStoragePath(imageUrl);
  if (!path) return;
  storage.deleteImage(path).catch((error) => {
    console.warn(`Failed to delete orphaned storage object ${path}:`, error);
  });
}

/**
 * Batch-fetches expense_payments/expense_shares for a set of expenses (one
 * round trip per table, regardless of how many expenses) and stitches them
 * onto each expense row. Shared by listExpenses and listExpensesPage so
 * paging never re-introduces the N+1 the original listExpenses avoided.
 */
async function enrichExpensesWithPaymentsAndShares(
  client: SupabaseQueryClient,
  expenses: ExpenseRecord[],
): Promise<ExpenseRecord[]> {
  if (expenses.length === 0) {
    return expenses;
  }

  const expenseIds = expenses.map((expense) => expense.id);

  const [payments, shares] = await Promise.all([
    client.one<Array<ExpensePaymentRecord & { expense_id: string }>>(
      `
        select expense_id, payer_member_id, amount_minor, currency
        from public.expense_payments
        where expense_id = any($1)
      `,
      [expenseIds],
    ),
    client.one<Array<ExpenseShareRecord & { expense_id: string }>>(
      `
        select expense_id, member_id, share_type, share_value, amount_minor
        from public.expense_shares
        where expense_id = any($1)
      `,
      [expenseIds],
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
  client: SupabaseQueryClient,
  storage?: SupabaseStorageClient,
): ExpenseRepository {
  /**
   * The expense, its payments, and its shares are written by a single
   * transactional RPC. Doing it as 1 + N + M separate PostgREST calls (which is
   * what this used to be) meant a failure partway through left a half-written
   * expense behind - an entry with an incomplete share set silently corrupts
   * every balance in the group, and nothing rolled it back. The RPC also owns
   * the membership gate, the cross-group member-id validation, and the
   * client_requests idempotency check, so a retried create returns the original
   * row instead of colliding with the unique index and 500ing.
   */
  async function createExpenseViaRpc(
    context: AuthenticatedContext,
    groupId: string,
    request: CreateExpenseRequest,
  ): Promise<ExpenseRecord> {
    const validation = validateCreateExpenseRequest(request);

    if (!validation.ok) {
      throw new Error(validation.issues[0]?.code ?? "INVALID_EXPENSE");
    }

    return client
      .one<ExpenseRecord>(`select public.create_expense($1, $2, $3) as expense`, [
        groupId,
        context.user.id,
        request,
      ])
      .catch(rethrowWriteRpcError);
  }

  return {
    createExpense(context: AuthenticatedContext, groupId: string, request: CreateExpenseRequest) {
      return createExpenseViaRpc(context, groupId, request);
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
        .one<{ expense: ExpenseRecord; previous: DeletedExpenseRecord | null }>(
          `select public.replace_expense($1, $2, $3, $4) as result`,
          [groupId, context.user.id, expenseId, request],
        )
        .catch(rethrowWriteRpcError);

      // The replaced row's image is now unreferenced - unless the edit kept it,
      // in which case deleting it would break the expense that is still using
      // it. Fire-and-forget, exactly like softDeleteExpense.
      if (storage && result.previous && result.previous.image_url !== result.expense.image_url) {
        cleanupOrphanedImage(storage, result.previous.image_url);
      }

      return result;
    },

    async listExpenses(groupId: string) {
      const expenses = await client.one<ExpenseRecord[]>(
        `
          select id, group_id, title, kind, category, amount_minor, currency, expense_date, note, transfer_to_member_id, created_at, version, client_request_id, image_url
          from public.expenses
          where group_id = $1 and deleted_at is null
          order by expense_date desc, created_at desc
        `,
        [groupId],
      );

      return enrichExpensesWithPaymentsAndShares(client, expenses);
    },

    async listExpensesPage(groupId: string, options: { limit: number; cursor?: ExpensePageCursor }) {
      const limit = Math.max(1, Math.min(options.limit, 100));

      const expenses = options.cursor
        ? await client.one<ExpenseRecord[]>(
            `
              select id, group_id, title, kind, category, amount_minor, currency, expense_date, note, transfer_to_member_id, created_at, version, client_request_id, image_url
              from public.expenses
              where group_id = $1 and deleted_at is null
                and (expense_date, created_at) < ($2, $3)
              order by expense_date desc, created_at desc
              limit $4
            `,
            [groupId, options.cursor.beforeDate, options.cursor.beforeCreatedAt, limit],
          )
        : await client.one<ExpenseRecord[]>(
            `
              select id, group_id, title, kind, category, amount_minor, currency, expense_date, note, transfer_to_member_id, created_at, version, client_request_id, image_url
              from public.expenses
              where group_id = $1 and deleted_at is null
              order by expense_date desc, created_at desc
              limit $2
            `,
            [groupId, limit],
          );

      return enrichExpensesWithPaymentsAndShares(client, expenses);
    },

    async softDeleteExpense(
      context: AuthenticatedContext,
      groupId: string,
      expenseId: string,
      client_request_id: string,
    ) {
      // Membership gate, the version bump (which the translated PostgREST PATCH
      // silently dropped), the client_requests write, and the idempotent-replay
      // check all live in the RPC now - one round trip, one transaction.
      const expense = await client
        .one<DeletedExpenseRecord>(`select public.soft_delete_expense($1, $2, $3, $4) as expense`, [
          groupId,
          context.user.id,
          expenseId,
          client_request_id,
        ])
        .catch(rethrowWriteRpcError);

      if (storage) {
        cleanupOrphanedImage(storage, expense.image_url);
      }

      return expense;
    },

    async recordClientRequest(groupId: string, client_request_id: string, resourceId: string) {
      await client.exec(
        `
          insert into public.client_requests (group_id, client_request_id, resource_id)
          values ($1, $2, $3)
          on conflict (group_id, client_request_id) do nothing
        `,
        [groupId, client_request_id, resourceId],
      );
    },
  };
}
