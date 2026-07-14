import type { CreateExpenseRequest } from "../../contracts/schemas.js";
import type { AuthenticatedContext } from "../auth/session.js";

/**
 * Thrown by the Supabase expense repository when the caller (create) or the
 * target group (delete) has no active membership row. Routes catch this by
 * message and map it to a clean 403 FORBIDDEN instead of letting a "no rows"
 * error from the underlying query surface as an unhandled 500.
 */
export const NOT_A_GROUP_MEMBER = "NOT_A_GROUP_MEMBER";

/**
 * Raised when the expense a delete/edit targets is already gone (or was never
 * in this group). Routes map it to 404 rather than letting it surface as an
 * unhandled 500 the way a bare "no rows" error used to.
 */
export const EXPENSE_NOT_FOUND = "EXPENSE_NOT_FOUND";

/**
 * Thrown when an expense_payments.payer_member_id, expense_shares.member_id,
 * or transfer_to_member_id in a create-expense request does not belong to an
 * active member of the target group. The FK on group_members(id) only
 * guarantees the id exists somewhere - not that it belongs to THIS group -
 * so this is the only thing standing between a malicious caller and mixing
 * another group's members into this group's ledger.
 */
export class InvalidMemberError extends Error {
  constructor(memberId: string) {
    super(`INVALID_MEMBER: member ${memberId} is not an active member of this group`);
    this.name = "InvalidMemberError";
  }
}

export type ExpensePaymentRecord = {
  payer_member_id: string;
  amount_minor: number;
  currency: string;
};

export type ExpenseShareRecord = {
  member_id: string;
  share_type: string;
  share_value?: number;
  amount_minor: number;
};

export type ExpenseRecord = {
  id: string;
  group_id: string;
  title: string;
  kind: string;
  category?: string;
  amount_minor: number;
  currency: string;
  expense_date?: string;
  note?: string | null;
  transfer_to_member_id?: string | null;
  image_url?: string | null;
  created_at?: string;
  version: number;
  client_request_id: string;
  expense_payments?: ExpensePaymentRecord[];
  expense_shares?: ExpenseShareRecord[];
};

/**
 * softDeleteExpense's return shape needs the just-deleted row's image_url
 * so the caller can clean up an orphaned storage object (see
 * supabaseExpenseRepository.ts's softDeleteExpense and
 * supabaseStorageClient.ts's urlToStoragePath/deleteImage) - a plain
 * ExpenseRecord's image_url is optional and not guaranteed to be selected
 * by every query, so this narrows it to "definitely present on this
 * response" for that one call site.
 */
export type DeletedExpenseRecord = ExpenseRecord & { image_url: string | null };

export type ExpensePageCursor = {
  beforeDate: string;
  beforeCreatedAt: string;
};

export type ExpenseRepository = {
  createExpense(
    context: AuthenticatedContext,
    groupId: string,
    request: CreateExpenseRequest,
  ): Promise<ExpenseRecord>;
  listExpenses(groupId: string): Promise<ExpenseRecord[]>;
  /**
   * Older-than-cursor page of a group's non-deleted expenses, ordered
   * expense_date desc/created_at desc (same ordering as get_group_detail's
   * capped window), enriched with payments/shares via the same batch-fetch
   * pattern listExpenses uses (no N+1). Used by the records-panel "load
   * more" flow once the client has exhausted the initial RPC window.
   */
  listExpensesPage(
    groupId: string,
    options: { limit: number; cursor?: ExpensePageCursor },
  ): Promise<ExpenseRecord[]>;
  softDeleteExpense(
    context: AuthenticatedContext,
    groupId: string,
    expenseId: string,
    client_request_id: string,
  ): Promise<DeletedExpenseRecord>;
  /**
   * Atomic edit: soft-deletes `expenseId` and creates its replacement in one
   * database transaction. The API has no in-place expense update, so an edit
   * has always been a delete plus a create - but running those as two separate
   * calls means a failed create leaves the user with neither row. Here they
   * either both land or neither does.
   *
   * `previous` is the replaced row (null on an idempotent replay), carried back
   * so the caller can clean up its now-orphaned image.
   */
  replaceExpense(
    context: AuthenticatedContext,
    groupId: string,
    expenseId: string,
    request: CreateExpenseRequest,
  ): Promise<{ expense: ExpenseRecord; previous: DeletedExpenseRecord | null }>;
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
