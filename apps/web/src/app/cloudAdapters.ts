import type { CreateExpenseRequest, ExpensePaymentInput, ExpenseShareInput } from "../contracts/schemas";
import type { BalanceSummary, GroupDetail, GroupMemberSummary, GroupSummary, ExpenseSummary } from "./apiClient";
import type { Expense, Group, Member } from "./appTypes";
import type { GroupDetailAggregates } from "./detailAggregates";
import type { ExpenseDraft } from "./ExpenseComposerSheet";
import { buildEqualShareAmountsMinor, buildPercentShareAmounts } from "./expenseShareSplit";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

/**
 * The subset of createExpense's response this app actually reads today
 * (apiClient.createExpense's return type) - just enough to seed the locally
 * built Expense with server-assigned identity/canonical amount fields.
 */
export type CreateExpenseResponse = {
  id: string;
  title: string;
  amount_minor: number;
  currency: string;
};

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

    // Same rule as unreadCount below: only spread when the payload carries it.
    // Absent means "this response does not say", null means "no budget" - and
    // writing null for absent would clear a budget on every read that omits it.
    ...(summary.monthly_budget_minor === undefined
      ? {}
      : { monthlyBudgetMinor: summary.monthly_budget_minor }),
    // Only spread when the server sent one. Absent means "this payload does
    // not know" (a detail read, a create response) rather than "zero unread",
    // so a group written back from one of those cannot silently clear a badge
    // the list had put there.
    ...(summary.unread_count === undefined ? {} : { unreadCount: summary.unread_count }),
    // Same reasoning as unread_count: a detail read or a create response knows
    // nothing about the caller's balance, and writing zero for it would turn
    // every group into 已結清 the moment one of those payloads lands.
    ...(summary.balance_minor === undefined ? {} : { balanceMinor: summary.balance_minor }),
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
      userId: member.user_id,
      avatarUrl: member.avatar_url ?? undefined,
      paymentNote: member.payment_note ?? undefined,
    }));
}

/** API ExpenseKind -> app-level Expense kind (see the comment on appTypes.Expense). */
function apiKindToExpenseKind(kind: string): NonNullable<Expense["kind"]> {
  if (kind === "transfer") return "settlement";
  if (kind === "income") return "income";
  return "expense";
}

/**
 * App-level Expense kind -> the value stored in expenses.kind, for anything
 * that FILTERS on kind server-side.
 *
 * The inverse of apiKindToExpenseKind, and it has to exist because the app and
 * the database disagree on one word: a 清償 is "settlement" in the UI and
 * "transfer" in the column. Sending the app's word straight to the server
 * silently matches nothing - which is exactly what the records panel's 結算
 * filter did, returning an empty list for a group that had four of them.
 */
export function expenseKindToApiKind(kind: string): string {
  return kind === "settlement" ? "transfer" : kind;
}

/** ExpenseDraft kind -> app-level Expense kind (transfer drafts become settlements). */
function draftKindToExpenseKind(kind: ExpenseDraft["kind"]): NonNullable<Expense["kind"]> {
  if (kind === "transfer") return "settlement";
  if (kind === "income") return "income";
  return "expense";
}

/**
 * The per-beneficiary/per-member split a draft describes, as exact minor
 * amounts that sum to draft.amountMinor:
 * - percent mode -> largest-remainder allocation from sharePercents
 * - custom amounts -> draft.shareAmountsMinor as-is (already gated to sum
 *   to the total by the composer)
 * - equal -> buildEqualShareAmountsMinor's floor+remainder split
 */
function resolveDraftShareAmountsMinor(draft: ExpenseDraft): Record<string, number> {
  if (draft.shareType === "percent" && draft.sharePercents) {
    return buildPercentShareAmounts(draft.shareMemberIds, draft.sharePercents, draft.amountMinor);
  }
  return draft.shareAmountsMinor ?? buildEqualShareAmountsMinor(draft.shareMemberIds, draft.amountMinor);
}

/**
 * The payments list a draft describes. Multi-payer drafts carry an explicit
 * payments array; single-payer drafts fall back to payerId paying the full
 * amount. Zero-amount rows are dropped because validation.ts requires every
 * expense_payments amount_minor to be a POSITIVE integer.
 */
function resolveDraftPayments(draft: ExpenseDraft): Array<{ payerId: string; amountMinor: number }> {
  if (draft.payments && draft.payments.length > 0) {
    return draft.payments.filter((payment) => payment.amountMinor > 0);
  }
  return [{ payerId: draft.payerId, amountMinor: draft.amountMinor }];
}

/**
 * The beneficiary payments an income draft describes (agreed income
 * encoding: expense_payments = each beneficiary's portion). Zero portions
 * are dropped - validation.ts requires positive payment amounts, and a
 * zero-portion beneficiary contributes nothing to balances anyway.
 */
function resolveIncomeBeneficiaryPayments(draft: ExpenseDraft): Array<{ payerId: string; amountMinor: number }> {
  const beneficiaryAmounts = resolveDraftShareAmountsMinor(draft);
  return draft.shareMemberIds
    .map((memberId) => ({ payerId: memberId, amountMinor: beneficiaryAmounts[memberId] ?? 0 }))
    .filter((payment) => payment.amountMinor > 0);
}

/**
 * Map a single cloud expense (or income/transfer) to the local Expense shape.
 *
 * Mapping decisions:
 * - amountMinor / currency / category / note pass through directly.
 * - createdAt prefers created_at (server timestamp) and falls back to
 *   expense_date (a plain YYYY-MM-DD date) when created_at is absent.
 * - payments carries every expense_payments entry (multi-payer expenses,
 *   or an income's per-beneficiary portions); payerId stays the FIRST
 *   entry's payer for backward-compatible single-payer display.
 * - shareMemberIds is the list of member_ids present in expense_shares.
 * - shareAmountsMinor is ALWAYS built from expense_shares (even when the
 *   split happens to be even). The server is the source of truth for
 *   amounts, and always building it keeps this mapping simple and correct
 *   without having to detect "is this an equal split".
 * - share_type "percent" rows surface as shareType "percent" plus
 *   sharePercents (from share_value) so edit-prefill can reopen the percent
 *   inputs; the exact amounts still live in shareAmountsMinor.
 * - kind maps per apiKindToExpenseKind: "transfer" -> "settlement" (so
 *   existing balance math, records styling, and stats exclusion keep
 *   working unmodified), "income" -> "income", anything else -> "expense".
 * - transfer_to_member_id passes through for settlement rows (from -> to
 *   display); older display code still falls back to shareMemberIds[0].
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

  const sharePercents: Record<string, number> = {};
  shares.forEach((share) => {
    if (share.share_type === "percent" && typeof share.share_value === "number") {
      sharePercents[share.member_id] = share.share_value;
    }
  });

  const expense: Expense = {
    id: summary.id,
    title: summary.title,
    amountMinor: summary.amount_minor,
    currency: summary.currency,
    createdAt: summary.created_at ?? summary.expense_date ?? new Date().toISOString(),
    expenseDate: summary.expense_date,
    payerId: payments[0]?.payer_member_id ?? "",
    shareMemberIds,
    kind: apiKindToExpenseKind(summary.kind),
    category: summary.category,
    note: summary.note ?? undefined,
    imageUrl: summary.image_url ?? undefined,
    shareAmountsMinor,
  };

  if (payments.length > 0) {
    expense.payments = payments.map((payment) => ({
      payerId: payment.payer_member_id,
      amountMinor: payment.amount_minor,
    }));
  }
  if (Object.keys(sharePercents).length > 0) {
    expense.shareType = "percent";
    expense.sharePercents = sharePercents;
  }
  if (summary.transfer_to_member_id) {
    expense.transferToMemberId = summary.transfer_to_member_id;
  }

  return expense;
}

export function toGroupUiData(detail: GroupDetail): {
  group: Group;
  members: Member[];
  expenses: Expense[];
  balances: BalanceSummary[];
  aggregates: GroupDetailAggregates;
} {
  return {
    group: toGroup(detail.group),
    members: toMembers(detail.members),
    expenses: detail.expenses.map(toExpense),
    balances: detail.balances,
    aggregates: {
      expenseCount: detail.expense_count,
      spendTotalMinor: detail.spend_total_minor,
      spendByDay: detail.spend_by_day.map((entry) => ({ day: entry.day, totalMinor: entry.total_minor })),
      // ?? [] keeps a cached pre-v4 detail payload (no spend_by_category yet) parseable.
      spendByCategory: (detail.spend_by_category ?? []).map((entry) => ({
        category: entry.category,
        totalMinor: entry.total_minor,
      })),
      memberDayShares: detail.member_day_shares.map((entry) => ({
        day: entry.day,
        memberId: entry.member_id,
        shareMinor: entry.share_minor,
      })),
    },
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

/** Draft share list -> API expense_shares, honoring percent mode. */
function toExpenseShareInputs(draft: ExpenseDraft): ExpenseShareInput[] {
  const shareAmountsMinor = resolveDraftShareAmountsMinor(draft);
  return draft.shareMemberIds.map((memberId) =>
    draft.shareType === "percent"
      ? {
          member_id: memberId,
          share_type: "percent" as const,
          share_value: draft.sharePercents?.[memberId] ?? 0,
          amount_minor: shareAmountsMinor[memberId] ?? 0,
        }
      : {
          member_id: memberId,
          share_type: "fixed" as const,
          amount_minor: shareAmountsMinor[memberId] ?? 0,
        },
  );
}

/**
 * Build a CreateExpenseRequest from a composer draft. The draft's
 * amountMinor is already converted into the group currency by the composer
 * (source-currency fields are dropped for cloud sync - acceptable v1 per
 * spec), so this request always uses the group currency for both the
 * payments and the shares.
 *
 * validation.ts constraints honored here (per draft kind):
 * - amount_minor must be a positive integer -> draft amounts are already
 *   integer minor units.
 * - expense_payments total must equal amount_minor, every entry a positive
 *   integer in the expense currency:
 *   - expense: the multi-payer rows (gated to sum exactly by the composer)
 *     or a single full-amount payment.
 *   - income: one entry per beneficiary portion (agreed income encoding);
 *     portions come from resolveDraftShareAmountsMinor so they sum exactly.
 *   - transfer: a single full-amount payment by the sender.
 * - expense_shares total must equal amount_minor (skipped by validation.ts
 *   for transfers, but we still send the recipient's full-amount share so
 *   the round-trip recovers shareMemberIds):
 *   - expense: the split rows; percent mode sends share_type "percent" +
 *     share_value AND the exact amount_minor from buildPercentShareAmounts
 *     (validation.ts reconciles amount_minor totals regardless of
 *     share_type, so the amounts must be sent and must sum exactly).
 *   - income: a single share for the collector holding the full amount.
 * - kind "transfer" requires transfer_to_member_id -> draft.transferToMemberId.
 *
 * draft.imageUrl (an already-uploaded cloud photo URL) passes straight
 * through as image_url. Uploading a newly-picked draft.imageDataUrl happens
 * in the caller (App's submit flow) before this request is built, since it
 * requires a groupId and a network round-trip this pure adapter can't do.
 */
export function toCreateExpenseRequest(draft: ExpenseDraft, groupCurrency: string): CreateExpenseRequest {
  const kind = draft.kind ?? "expense";

  const base = {
    client_request_id: crypto.randomUUID(),
    title: draft.title,
    category: draft.category,
    amount_minor: draft.amountMinor,
    currency: groupCurrency,
    expense_date: toDateOnly(draft.createdAt),
    note: draft.note,
    image_url: draft.imageUrl,
  };

  const toPaymentInput = (payment: { payerId: string; amountMinor: number }): ExpensePaymentInput => ({
    payer_member_id: payment.payerId,
    amount_minor: payment.amountMinor,
    currency: groupCurrency,
  });

  if (kind === "transfer") {
    const toId = draft.transferToMemberId ?? draft.shareMemberIds[0] ?? "";
    return {
      ...base,
      kind: "transfer",
      transfer_to_member_id: toId,
      expense_payments: [toPaymentInput({ payerId: draft.payerId, amountMinor: draft.amountMinor })],
      expense_shares: [
        {
          member_id: toId,
          share_type: "fixed",
          amount_minor: draft.amountMinor,
        },
      ],
    };
  }

  if (kind === "income") {
    return {
      ...base,
      kind: "income",
      expense_payments: resolveIncomeBeneficiaryPayments(draft).map(toPaymentInput),
      expense_shares: [
        {
          member_id: draft.payerId,
          share_type: "fixed",
          amount_minor: draft.amountMinor,
        },
      ],
    };
  }

  return {
    ...base,
    kind: "expense",
    expense_payments: resolveDraftPayments(draft).map(toPaymentInput),
    expense_shares: toExpenseShareInputs(draft),
  };
}

/**
 * Build a CreateExpenseRequest representing a settlement transfer (the
 * one-tap settle flow; a manual composer transfer goes through
 * toCreateExpenseRequest with draft.kind "transfer" and produces the exact
 * same wire shape, just with a user-chosen title/date/note).
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

/**
 * Build a local Expense from a composer draft plus createExpense's response,
 * without any follow-up fetch. This is the client-side mirror of what the
 * server just persisted from toCreateExpenseRequest(draft, groupCurrency):
 * - id comes from the response (the only server-assigned field we need).
 * - title/amount_minor/currency also come from the response since they are
 *   the canonical, possibly-normalized values the server stored (and are
 *   already returned by createExpense), but they match the draft byte-for-
 *   byte in every current call site.
 * - Everything else mirrors the exact per-kind mapping toCreateExpenseRequest
 *   used to build the request, so this local echo equals what a refetch
 *   through toExpense would produce:
 *   - expense: payments from the draft's payer rows (or the single payer),
 *     shares from the draft's split (percent mode keeps shareType/
 *     sharePercents and derives the exact amounts).
 *   - income: payments = the beneficiary portions, payerId = first
 *     beneficiary, shareMemberIds = [collector] holding the full amount.
 *   - transfer (app kind "settlement"): a single full payment by the
 *     sender, single full share to the recipient, transferToMemberId set.
 * - kind is derived from draft.kind (kindOverride is kept for the legacy
 *   settle-flow call sites that pass an explicit "settlement").
 * - createdAt passes the draft's ISO string through unchanged (created_at
 *   from the server would only differ in server clock skew, which the UI
 *   doesn't depend on).
 */
export function draftToExpense(
  draft: ExpenseDraft,
  response: CreateExpenseResponse,
  kindOverride?: Expense["kind"],
): Expense {
  const kind = kindOverride ?? draftKindToExpenseKind(draft.kind);

  const base: Expense = {
    id: response.id,
    title: response.title,
    amountMinor: response.amount_minor,
    currency: response.currency,
    createdAt: draft.createdAt,
    payerId: draft.payerId,
    shareMemberIds: draft.shareMemberIds,
    kind,
    category: draft.category,
    note: draft.note,
    imageUrl: draft.imageUrl,
  };

  if (kind === "settlement") {
    const toId = draft.transferToMemberId ?? draft.shareMemberIds[0] ?? "";
    return {
      ...base,
      payments: [{ payerId: draft.payerId, amountMinor: response.amount_minor }],
      shareMemberIds: [toId],
      shareAmountsMinor: { [toId]: response.amount_minor },
      transferToMemberId: toId,
    };
  }

  if (kind === "income") {
    const payments = resolveIncomeBeneficiaryPayments(draft);
    return {
      ...base,
      payerId: payments[0]?.payerId ?? "",
      payments,
      shareMemberIds: [draft.payerId],
      shareAmountsMinor: { [draft.payerId]: response.amount_minor },
    };
  }

  const payments = resolveDraftPayments(draft);
  const expense: Expense = {
    ...base,
    payerId: payments[0]?.payerId ?? draft.payerId,
    payments,
    shareAmountsMinor: resolveDraftShareAmountsMinor(draft),
  };
  if (draft.shareType === "percent" && draft.sharePercents) {
    expense.shareType = "percent";
    expense.sharePercents = draft.sharePercents;
  }
  return expense;
}

/**
 * Build the ExpenseDraft-shaped input draftToExpense needs for a settlement
 * transfer, mirroring toSettlementTransferRequest's shape exactly (title,
 * category, single-member share to the recipient) so the resulting local
 * Expense round-trips the same way a refetched settlement would via
 * toExpense: kind "settlement", shareMemberIds [toId], transferToMemberId.
 */
export function settlementTransferToDraft(
  fromId: string,
  toId: string,
  amountMinor: number,
): ExpenseDraft {
  return {
    title: text.settlementTransfer,
    amountMinor,
    createdAt: new Date().toISOString(),
    payerId: fromId,
    shareMemberIds: [toId],
    category: "general",
    kind: "transfer",
    transferToMemberId: toId,
    shareAmountsMinor: { [toId]: amountMinor },
  };
}
