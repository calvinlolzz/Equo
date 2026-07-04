import type { CreateExpenseRequest } from "../contracts/schemas";
import type { GroupDetail, GroupMemberSummary, GroupSummary, ExpenseSummary } from "./apiClient";
import type { Expense, Group, Member } from "./appTypes";
import type { ExpenseDraft } from "./ExpenseComposerSheet";
import { buildEqualShareAmountsMinor } from "./expenseShareSplit";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

/**
 * Map a cloud GroupSummary to the local Group shape used by every existing
 * UI surface (home, rail, records, analysis, etc).
 */
export function toGroup(summary: GroupSummary): Group {
  return {
    id: summary.id,
    name: summary.name,
    currency: summary.currency,
    coverImageUrl: summary.cover_image_url ?? undefined,
  };
}

/**
 * Map cloud members to the local Member shape. Only active members are
 * shown - removed members are dropped entirely, matching how local groups
 * never carry removed members either.
 */
export function toMembers(members: GroupMemberSummary[]): Member[] {
  return members
    .filter((member) => member.status === "active")
    .map((member) => ({
      id: member.id,
      name: member.display_name,
      role: member.role,
      virtual: member.user_id === null,
    }));
}

/**
 * Map a single cloud expense (or transfer) to the local Expense shape.
 *
 * Mapping decisions:
 * - amountMinor / currency / category / note pass through directly.
 * - createdAt prefers created_at (server timestamp) and falls back to
 *   expense_date (a plain YYYY-MM-DD date) when created_at is absent.
 * - payerId is the first expense_payments entry's payer_member_id. The
 *   contracts only ever produce a single payment per expense today, so
 *   "first" is also "only".
 * - shareMemberIds is the list of member_ids present in expense_shares.
 * - shareAmountsMinor is ALWAYS built from expense_shares (even when the
 *   split happens to be even). The server is the source of truth for
 *   amounts, and always building it keeps this mapping simple and correct
 *   without having to detect "is this an equal split" - getMemberShareMinor
 *   only special-cases a missing shareAmountsMinor, so providing exact
 *   amounts here is always safe and never changes displayed behavior for
 *   evenly split expenses.
 * - kind "transfer" becomes local kind "settlement" so existing balance
 *   math, records styling, and stats exclusion keep working unmodified;
 *   any other kind (only "expense" is created by this client) maps to
 *   "expense".
 * - imageUrl passes through from image_url (a cloud-hosted photo URL, if
 *   the expense has one).
 */
export function toExpense(summary: ExpenseSummary): Expense {
  const payments = summary.expense_payments ?? [];
  const shares = summary.expense_shares ?? [];

  const shareMemberIds = shares.map((share) => share.member_id);
  const shareAmountsMinor: Record<string, number> = {};
  shares.forEach((share) => {
    shareAmountsMinor[share.member_id] = share.amount_minor;
  });

  const expense: Expense = {
    id: summary.id,
    title: summary.title,
    amountMinor: summary.amount_minor,
    currency: summary.currency,
    createdAt: summary.created_at ?? summary.expense_date ?? new Date().toISOString(),
    payerId: payments[0]?.payer_member_id ?? "",
    shareMemberIds,
    kind: summary.kind === "transfer" ? "settlement" : "expense",
    category: summary.category,
    note: summary.note ?? undefined,
    imageUrl: summary.image_url ?? undefined,
    shareAmountsMinor,
  };

  return expense;
}

export function toGroupUiData(detail: GroupDetail): {
  group: Group;
  members: Member[];
  expenses: Expense[];
} {
  return {
    group: toGroup(detail.group),
    members: toMembers(detail.members),
    expenses: detail.expenses.map(toExpense),
  };
}

function toDateOnly(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso.slice(0, 10);
  }
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Build a CreateExpenseRequest from a composer draft. The draft's
 * amountMinor is already converted into the group currency by the composer
 * (source-currency fields are dropped for cloud sync - acceptable v1 per
 * spec), so this request always uses the group currency for both the
 * payment and the shares.
 *
 * validation.ts constraints honored here:
 * - amount_minor must be a positive integer -> draft amounts are already
 *   integer minor units.
 * - expense_payments total must equal amount_minor -> single payment for
 *   the full amount.
 * - expense_shares total must equal amount_minor -> shares are built from
 *   draft.shareAmountsMinor when present (custom split, already validated
 *   to sum to the total by canSubmitExpenseDraft), otherwise computed via
 *   buildEqualShareAmountsMinor which distributes the remainder so the sum
 *   is always exact.
 * - expense_payments/shares amount_minor must be positive/non-negative
 *   integers -> both sources already produce integers.
 *
 * draft.imageUrl (an already-uploaded cloud photo URL) passes straight
 * through as image_url. Uploading a newly-picked draft.imageDataUrl happens
 * in the caller (App's submit flow) before this request is built, since it
 * requires a groupId and a network round-trip this pure adapter can't do.
 */
export function toCreateExpenseRequest(draft: ExpenseDraft, groupCurrency: string): CreateExpenseRequest {
  const shareAmountsMinor = draft.shareAmountsMinor ?? buildEqualShareAmountsMinor(draft.shareMemberIds, draft.amountMinor);

  return {
    client_request_id: crypto.randomUUID(),
    title: draft.title,
    kind: "expense",
    category: draft.category,
    amount_minor: draft.amountMinor,
    currency: groupCurrency,
    expense_date: toDateOnly(draft.createdAt),
    note: draft.note,
    image_url: draft.imageUrl,
    expense_payments: [
      {
        payer_member_id: draft.payerId,
        amount_minor: draft.amountMinor,
        currency: groupCurrency,
      },
    ],
    expense_shares: draft.shareMemberIds.map((memberId) => ({
      member_id: memberId,
      share_type: "fixed",
      amount_minor: shareAmountsMinor[memberId] ?? 0,
    })),
  };
}

/**
 * Build a CreateExpenseRequest representing a settlement transfer.
 *
 * validation.ts constraints honored here:
 * - kind "transfer" requires transfer_to_member_id -> set to toId.
 * - expense_shares is allowed to be empty for transfers (validation skips
 *   the "must include at least one member" and "must equal amount_minor"
 *   checks when kind === "transfer"), but we still provide a single share
 *   to the recipient so the adapter round-trip (toExpense) can recover
 *   shareMemberIds for the settlement row exactly like local settlements
 *   (shareMemberIds: [toId]). Its amount matches amount_minor since a
 *   transfer's "share" total must also reconcile if present.
 * - expense_payments total must equal amount_minor -> single payment by
 *   fromId for the full amount.
 */
export function toSettlementTransferRequest(
  fromId: string,
  toId: string,
  amountMinor: number,
  currency: string,
): CreateExpenseRequest {
  return {
    client_request_id: crypto.randomUUID(),
    title: text.settlementTransfer,
    kind: "transfer",
    category: "general",
    amount_minor: amountMinor,
    currency,
    expense_date: toDateOnly(new Date().toISOString()),
    transfer_to_member_id: toId,
    expense_payments: [
      {
        payer_member_id: fromId,
        amount_minor: amountMinor,
        currency,
      },
    ],
    expense_shares: [
      {
        member_id: toId,
        share_type: "fixed",
        amount_minor: amountMinor,
      },
    ],
  };
}
