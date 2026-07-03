import { validateCreateExpenseRequest } from "../../contracts/validation.js";
import type { CreateExpenseRequest } from "../../contracts/schemas.js";
import type { AuthenticatedContext } from "../auth/session.js";
import type { SupabaseQueryClient } from "./supabaseGroupRepository.js";
import type { ExpenseRecord, ExpenseRepository } from "./expenseRepository.js";

export function createSupabaseExpenseRepository(client: SupabaseQueryClient): ExpenseRepository {
  return {
    async createExpense(context: AuthenticatedContext, groupId: string, request: CreateExpenseRequest) {
      const validation = validateCreateExpenseRequest(request);

      if (!validation.ok) {
        throw new Error(validation.issues[0]?.code ?? "INVALID_EXPENSE");
      }

      const member = await client.one<{ id: string }>(
        `
          select id
          from public.group_members
          where group_id = $1 and user_id = $2 and status = 'active'
          limit 1
        `,
        [groupId, context.user.id],
      );
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
            client_request_id
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
          returning id, group_id, title, kind, category, amount_minor, currency, expense_date, created_at, version, client_request_id
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
      return client.one<ExpenseRecord[]>(
        `
          select id, group_id, title, kind, category, amount_minor, currency, expense_date, created_at, version, client_request_id
          from public.expenses
          where group_id = $1 and deleted_at is null
          order by expense_date desc, created_at desc
        `,
        [groupId],
      );
    },

    async softDeleteExpense(groupId: string, expenseId: string, client_request_id: string) {
      const expense = await client.one<ExpenseRecord>(
        `
          update public.expenses
          set deleted_at = now(), version = version + 1, updated_at = now()
          where group_id = $1 and id = $2 and deleted_at is null
          returning id, group_id, title, kind, category, amount_minor, currency, expense_date, created_at, version, client_request_id
        `,
        [groupId, expenseId],
      );
      await this.recordClientRequest(groupId, client_request_id, expense.id);
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
