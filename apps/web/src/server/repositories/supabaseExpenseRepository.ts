import { validateCreateExpenseRequest } from "../../contracts/validation.js";
import type { CreateExpenseRequest } from "../../contracts/schemas.js";
import type { AuthenticatedContext } from "../auth/session.js";
import type { SupabaseStorageClient } from "../runtime/supabaseStorageClient.js";
import { urlToStoragePath } from "../runtime/supabaseStorageClient.js";
import type { SupabaseQueryClient } from "./supabaseGroupRepository.js";
import {
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

export function createSupabaseExpenseRepository(
  client: SupabaseQueryClient,
  storage?: SupabaseStorageClient,
): ExpenseRepository {
  return {
    async createExpense(context: AuthenticatedContext, groupId: string, request: CreateExpenseRequest) {
      const validation = validateCreateExpenseRequest(request);

      if (!validation.ok) {
        throw new Error(validation.issues[0]?.code ?? "INVALID_EXPENSE");
      }

      const member = await client.maybeOne<{ id: string }>(
        `
          select id
          from public.group_members
          where group_id = $1 and user_id = $2 and status = 'active'
          limit 1
        `,
        [groupId, context.user.id],
      );

      if (!member) {
        throw new Error(NOT_A_GROUP_MEMBER);
      }

      // The FK on expense_payments/expense_shares/transfer_to_member_id only
      // references group_members(id) globally - it does not guarantee the
      // referenced member belongs to THIS group. Load the group's active
      // member id set once and verify every id the request references
      // against it before writing anything.
      const activeMembers = await client.one<Array<{ id: string }>>(
        `
          select id
          from public.group_members
          where group_id = $1 and status = 'active'
        `,
        [groupId],
      );
      const activeMemberIds = new Set(activeMembers.map((row) => row.id));
      activeMemberIds.add(member.id);

      for (const payment of request.expense_payments) {
        if (!activeMemberIds.has(payment.payer_member_id)) {
          throw new InvalidMemberError(payment.payer_member_id);
        }
      }

      for (const share of request.expense_shares) {
        if (!activeMemberIds.has(share.member_id)) {
          throw new InvalidMemberError(share.member_id);
        }
      }

      if (request.transfer_to_member_id && !activeMemberIds.has(request.transfer_to_member_id)) {
        throw new InvalidMemberError(request.transfer_to_member_id);
      }

      const expense = await client.one<ExpenseRecord>(
        `
          insert into public.expenses (
            group_id,
            created_by_member_id,
            title,
            kind,
            category,
            amount_minor,
            currency,
            expense_date,
            note,
            transfer_to_member_id,
            client_request_id,
            image_url
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
          returning id, group_id, title, kind, category, amount_minor, currency, expense_date, created_at, version, client_request_id, image_url
        `,
        [
          groupId,
          member.id,
          request.title,
          request.kind,
          request.category,
          request.amount_minor,
          request.currency,
          request.expense_date,
          request.note ?? null,
          request.transfer_to_member_id ?? null,
          request.client_request_id,
          request.image_url ?? null,
        ],
      );

      for (const payment of request.expense_payments) {
        await client.exec(
          `
            insert into public.expense_payments (
              expense_id,
              payer_member_id,
              amount_minor,
              currency
            )
            values ($1, $2, $3, $4)
          `,
          [expense.id, payment.payer_member_id, payment.amount_minor, payment.currency],
        );
      }

      for (const share of request.expense_shares) {
        await client.exec(
          `
            insert into public.expense_shares (
              expense_id,
              member_id,
              share_type,
              share_value,
              amount_minor
            )
            values ($1, $2, $3, $4, $5)
          `,
          [expense.id, share.member_id, share.share_type, share.share_value ?? null, share.amount_minor],
        );
      }

      await this.recordClientRequest(groupId, request.client_request_id, expense.id);
      return expense;
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
      const member = await client.maybeOne<{ id: string }>(
        `
          select id
          from public.group_members
          where group_id = $1 and user_id = $2 and status = 'active'
          limit 1
        `,
        [groupId, context.user.id],
      );

      if (!member) {
        throw new Error(NOT_A_GROUP_MEMBER);
      }

      const expense = await client.one<DeletedExpenseRecord>(
        `
          update public.expenses
          set deleted_at = now(), version = version + 1, updated_at = now()
          where group_id = $1 and id = $2 and deleted_at is null
          returning id, group_id, title, kind, category, amount_minor, currency, expense_date, created_at, version, client_request_id, image_url
        `,
        [groupId, expenseId],
      );
      await this.recordClientRequest(groupId, client_request_id, expense.id);
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
