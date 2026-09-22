export type Group = {
  id: string;
  name: string;
  currency: string;
  coverImageUrl?: string;
  /**
   * "shared" (an ordinary group) or "personal" (the caller's own ledger).
   * Absent means "this payload does not say" (see cloudAdapters.toGroup and
   * inheritListGroupFields), never "shared" - a merged object must never
   * assert a kind it was not told.
   */
  kind?: "shared" | "personal";
  /** 每月預算 in the group's currency; undefined when nobody set one. */
  monthlyBudgetMinor?: number | null;
  /**
   * Entries somebody else recorded since this user last opened the group.
   * Only the group LIST carries it (see cloudStore's refreshGroups); a group
   * read from a detail payload has no unread count of its own.
   */
  unreadCount?: number;
  /**
   * What this group currently costs the logged-in user, in the group's
   * currency: positive means the group owes them, negative means they owe it.
   * Like unreadCount, only the group LIST carries it — and undefined means
   * "not known here", which must render as nothing rather than as 已結清.
   */
  balanceMinor?: number;
};

export type Member = {
  id: string;
  name: string;
  role?: "owner" | "member";
  virtual?: boolean;
  /**
   * 收款資訊 — free text the payer can copy (bank code + last five, LINE Pay,
   * a payment link). Undefined when unset; the settlement suggestions show it
   * on the row where you are the one paying.
   */
  paymentNote?: string | null;
  /**
   * The auth user id this member is linked to (Supabase session.user.id).
   * Null/undefined for virtual (payer-only) members that have no login.
   * Used to resolve "the current logged-in user" among a group's members -
   * see resolveCurrentMember in App.tsx.
   */
  userId?: string | null;
  /**
   * The linked user's real avatar (their Google profile picture by default,
   * or a custom upload once they set one via ProfileDialog - see
   * updateMyAvatar). Null/undefined for virtual members (no login, no
   * avatar) or a real member whose users.avatar_url is unset - either way,
   * MemberAvatar falls back to the initial-letter style.
   */
  avatarUrl?: string | null;
};

/**
 * kind mapping between the API's ExpenseKind ("expense" | "income" | "transfer")
 * and this app-level union:
 * - API "expense"  -> app "expense"
 * - API "income"   -> app "income"
 * - API "transfer" -> app "settlement" (a manual transfer IS a settlement with
 *   a user-chosen amount/title/note - it reuses the existing settlement
 *   records/stats treatment: excluded from spend totals, distinct row
 *   styling, from/to display). See cloudAdapters.toExpense for the mapping
 *   and toCreateExpenseRequest/toSettlementTransferRequest for the reverse.
 */
export type Expense = {
  id: string;
  title: string;
  amountMinor: number;
  currency: string;
  createdAt: string;
  /**
   * The server's raw expense_date (a plain YYYY-MM-DD date, not a
   * timestamp) - kept alongside createdAt (which prefers the full
   * created_at timestamp) so the records-panel "load more" pagination
   * cursor can match get_group_detail/listExpensesPage's exact
   * (expense_date, created_at) ordering key instead of re-deriving a
   * possibly-off-by-one-day value from createdAt's UTC timestamp. Absent
   * for locally-built expenses that haven't round-tripped through the
   * server yet (draftToExpense's optimistic echo).
   */
  expenseDate?: string;
  payerId: string;
  shareMemberIds: string[];
  kind?: "expense" | "income" | "settlement";
  category?: string;
  note?: string;
  /**
   * The first receipt. Derived from imageUrls, never set apart from it - the
   * records list and the admin console want one thumbnail, and having them read
   * imageUrls[0] would spread the same decision across four call sites. Mirrors
   * the expenses.image_url column, which the database derives the same way.
   */
  imageUrl?: string;
  /** Every receipt, in display order. */
  imageUrls?: string[];
  sourceCurrency?: string;
  sourceAmountMinor?: number;
  exchangeRate?: number;
  shareAmountsMinor?: Record<string, number>;
  /**
   * Multiple payers for an expense, or the beneficiary payments for an
   * income entry (see agreed sign semantics below). When present, this is
   * authoritative for balance math and display; payerId still holds the
   * first payment's payer for backward-compatible single-payer display.
   */
  payments?: Array<{ payerId: string; amountMinor: number }>;
  /**
   * Per-member share mode. "percent" means sharePercents (not
   * shareAmountsMinor) is the source of truth for the user-entered split;
   * shareAmountsMinor is still populated (derived via
   * buildPercentShareAmounts) so existing balance/display code that only
   * knows about shareAmountsMinor keeps working unmodified.
   */
  shareType?: "fixed" | "percent";
  /** memberId -> percent (0-100), corresponds to API share_value under share_type "percent". */
  sharePercents?: Record<string, number>;
  /**
   * Destination member for a "settlement" (transfer) expense. Falls back to
   * shareMemberIds[0] in existing display code when absent (older data).
   */
  transferToMemberId?: string;
};

export type Activity = {
  id: string;
  text: string;
  createdAt: string;
};

export type GroupData = {
  members: Member[];
  expenses: Expense[];
  activities: Activity[];
};

export type ArchivedGroup = Group & {
  archivedAt: string;
};

export type StartMode = "create" | "join" | "continue";

/**
 * The single bottom-sheet/dialog the app shows at a time (null = none). Lives
 * here rather than in App.tsx so the mutation hooks that open and close dialogs
 * (useGroupMutations, useMemberMutations, useInviteFlow, …) can share the type.
 */
export type DialogMode =
  | "createGroup"
  | "editGroup"
  | "inviteMembers"
  | "inviteInput"
  | "recordsPanel"
  | "analysisPanel"
  | "memberActions"
  | "memberList"
  | "recurringList"
  | "virtualMember"
  | "archivedList"
  | "archive"
  | "delete"
  | "profile"
  | "expenseDetail"
  | null;

/**
 * The read-only info sheet stacked on top of the profile dialog (null = none).
 * Owned by App.tsx rather than ProfileDialog so it can take its own place in
 * the Back-button stack — see useOverlayHistory.
 */
export type InfoDialogMode = "privacy" | "terms" | null;
