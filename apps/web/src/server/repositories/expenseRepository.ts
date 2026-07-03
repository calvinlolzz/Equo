import type { CreateExpenseRequest } from "../../contracts/schemas.js";
import type { AuthenticatedContext } from "../auth/session.js";

export type ExpenseRecord = {
  id: string;
  group_id: string;
  title: string;
  kind: string;
  category?: string;
  amount_minor: number;
  currency: string;
  expense_date?: string;
  created_at?: string;
  version: number;
  client_request_id: string;
};

export type ExpenseRepository = {
  createExpense(
    context: AuthenticatedContext,
    groupId: string,
    request: CreateExpenseRequest,
  ): Promise<ExpenseRecord>;
  listExpenses(groupId: string): Promise<ExpenseRecord[]>;
  softDeleteExpense(groupId: string, expenseId: string, client_request_id: string): Promise<ExpenseRecord>;
  recordClientRequest(groupId: string, client_request_id: string, resourceId: string): Promise<void>;
};

export type ExpensePersistencePayload = {
  expense: ExpenseRecord;
  expense_payments: Array<{
    payer_member_id: string;
    amount_minor: number;
    currency: string;
  }>;
  expense_shares: Array<{
    member_id: string;
    share_type: string;
    share_value?: number;
    amount_minor: number;
  }>;
};
