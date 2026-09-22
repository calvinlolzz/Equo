import type {
  AcceptInviteRequest,
  CreateGroupRequest,
  CreateInviteRequest,
  UpdateGroupRequest,
} from "../../contracts/schemas.js";
import type { AuthenticatedContext } from "../auth/session.js";
import type { ExpenseRecord } from "./expenseRepository.js";
import type { MemberBalance } from "../../domain/settlement.js";

export type GroupMemberRole = "owner" | "member";

/**
 * "shared" is an ordinary multi-member group. "personal" is the one-member
 * 個人帳本 (personal ledger) every user gets lazily via ensurePersonalLedger -
 * same tables, same RPCs, just with invites/members/archive/delete refused.
 * Optional on GroupRecord because most read paths (get_group_detail in
 * particular) don't return it yet - see cloudAdapters.ts's
 * inheritListGroupFields for how the client fills the gap from the list.
 */
export type GroupKind = "shared" | "personal";

export type GroupRecord = {
  id: string;
  name: string;
  currency: string;
  owner_member_id: string;
  cover_image_url?: string | null;
  /** 每月預算 in the group's currency; null when nobody set one. */
  monthly_budget_minor?: number | null;
  kind?: GroupKind;
  /**
   * Entries recorded by somebody else since the caller last opened this group.
   * Only listGroups fills it in - every other read leaves it undefined, since
   * "unread" is a property of a row in a list, not of the group itself.
   */
  unread_count?: number;
  /**
   * The CALLER's own balance in this group, in the group's currency: positive
   * means the group owes them, negative means they owe it. Like unread_count,
   * only listGroups fills it in - and it is left undefined (not zero) when the
   * decoration fails, so "we don't know" never renders as "settled".
   */
  balance_minor?: number;
};

export type ArchivedGroupRecord = {
  id: string;
  name: string;
  currency: string;
  owner_member_id: string;
  archived_at: string;
  cover_image_url?: string | null;
  /**
   * The caller's own group_members.id for this archived group. Restoring
   * (unarchiving) an archived group is owner-only, and unlike the active
   * groups list this data doesn't flow through the per-group detail screen
   * (with its own currentMember lookup) before the restore action is
   * offered - so the archived list has to carry the caller's own member id
   * alongside owner_member_id for the frontend to gate the restore button
   * without an extra round trip per row.
   */
  caller_member_id: string;
};

export type GroupMemberRecord = {
  id: string;
  group_id: string;
  user_id: string | null;
  display_name: string;
  role: GroupMemberRole;
  status: "active" | "removed";
  /**
   * The linked user's profile photo (from public.users.avatar_url via
   * get_group_detail's join), null for virtual members. Only populated on
   * the get_group_detail RPC path today - listMembers/createVirtualMember/etc
   * don't select it since nothing reads it off those paths yet.
   */
  avatar_url?: string | null;
  /**
   * 收款資訊 — free text saying where to send the money. Null when unset, and
   * absent on the paths whose column list does not select it.
   */
  payment_note?: string | null;
};

/**
 * Raised by acceptInvite when the token matches no live invite - revoked,
 * exhausted, expired, or pointing at a deleted group. The check used to live in
 * the handler (a lookup, then a separate accept), which meant the validation and
 * the write raced each other; it is now a single locked transaction inside the
 * accept_invite RPC, so this is how the handler learns the invite was no good.
 */
export const INVITE_EXPIRED = "INVITE_EXPIRED";

export type InviteRecord = {
  id: string;
  group_id: string;
  token_hash: string;
  token?: string;
  max_uses: number;
  use_count: number;
  expires_at?: string;
};

export type SpendByDayRecord = {
  day: string;
  total_minor: number;
};

export type MemberDaySharesRecord = {
  day: string;
  member_id: string;
  share_minor: number;
};

export type GroupDetailRecord = {
  group: GroupRecord;
  members: GroupMemberRecord[];
  /**
   * Capped to the p_expense_limit newest entries (expense_date desc,
   * created_at desc) - NOT the full history. See expense_count for the true
   * total and the paged GET /expenses endpoint for loading older entries.
   */
  expenses: ExpenseRecord[];
  balances: MemberBalance[];
  /** All non-deleted entries in the group (not just kind='expense') - drives the "load more" paging UI. */
  expense_count: number;
  /** Sum of kind='expense' amount_minor only (excludes income/transfer). Server-authoritative 總支出. */
  spend_total_minor: number;
  /** Last 8 days of kind='expense' totals, keyed by expense_date. */
  spend_by_day: SpendByDayRecord[];
  /** Last 8 days of per-member kind='expense' shares, keyed by expense_date. */
  member_day_shares: MemberDaySharesRecord[];
};

/** The public face of an invite. Deliberately tiny — see previewInvite. */
export type InvitePreview = {
  group_name: string;
  member_count: number;
};

export type GroupRepository = {
  listGroups(context: AuthenticatedContext): Promise<GroupRecord[]>;
  /**
   * Get-or-create the caller's personal ledger (RPC ensure_personal_ledger).
   * Null when the user has no profiles row to satisfy groups.owner_id's
   * foreign key - see the migration - which handleListGroups treats as
   * "skip decorating this list", not as an error.
   */
  ensurePersonalLedger(context: AuthenticatedContext): Promise<GroupRecord | null>;
  /**
   * The bare minimum needed to guard and rename-override a write against a
   * group without paying for a full getGroupDetail: is it a personal ledger,
   * and what's its stored name. Null when the group doesn't exist or is
   * deleted.
   */
  findGroupMeta(groupId: string): Promise<{ kind: GroupKind; name: string } | null>;
  /**
   * Stamp "the caller has now seen this group", clearing its unread count.
   * Returns null when they are not an active member of it.
   */
  markGroupRead(
    context: AuthenticatedContext,
    groupId: string,
  ): Promise<{ group_id: string; last_read_at: string } | null>;
  listArchivedGroups(context: AuthenticatedContext): Promise<ArchivedGroupRecord[]>;
  listMembers(groupId: string): Promise<GroupMemberRecord[]>;
  getGroupDetail(context: AuthenticatedContext, groupId: string): Promise<GroupDetailRecord | null>;
  createGroup(context: AuthenticatedContext, request: CreateGroupRequest): Promise<{
    group: GroupRecord;
    ownerMember: GroupMemberRecord;
  }>;
  /**
   * previousCoverImageUrl is the group's cover_image_url BEFORE this update
   * (null if it had none), read alongside the write so the caller can clean
   * up the old cover from storage when the request replaces it - see
   * handlers/groups.ts's handleUpdateGroup and
   * supabaseStorageClient.ts's urlToStoragePath/deleteImage. Populated
   * unconditionally (even when the request omits cover_image_url and the
   * column is left unchanged) since it's cheap to read and callers only act
   * on it when the value is actually about to change.
   */
  updateGroup(groupId: string, request: UpdateGroupRequest): Promise<{
    group: GroupRecord;
    previousCoverImageUrl: string | null;
  }>;
  archiveGroup(groupId: string): Promise<GroupRecord>;
  unarchiveGroup(groupId: string): Promise<GroupRecord>;
  deleteGroup(groupId: string): Promise<GroupRecord>;
  createVirtualMember(groupId: string, displayName: string): Promise<GroupMemberRecord>;
  renameVirtualMember(groupId: string, memberId: string, displayName: string): Promise<GroupMemberRecord>;
  /** Replace a member's 收款資訊; null clears it. Permission is the handler's call. */
  setMemberPaymentNote(groupId: string, memberId: string, note: string | null): Promise<GroupMemberRecord>;
  removeVirtualMember(groupId: string, memberId: string): Promise<GroupMemberRecord>;
  findActiveMember(groupId: string, userId: string): Promise<GroupMemberRecord | null>;
  findMemberById(groupId: string, memberId: string): Promise<GroupMemberRecord | null>;
  /** The member's current balance in group_member_balances (0 when the view has no row). */
  getMemberBalanceMinor(groupId: string, memberId: string): Promise<number>;
  createInvite(context: AuthenticatedContext, groupId: string, request: CreateInviteRequest): Promise<InviteRecord>;
  /**
   * What a signed-OUT visitor may be told about an invite link before they are
   * asked to hand over a Google account: the group's name and how many people
   * are in it, and nothing else. Null when the token matches no live invite.
   *
   * The only unauthenticated read in this repository, so the shape of what it
   * returns IS the security boundary — see handleInvitePreview.
   */
  previewInvite(token: string): Promise<InvitePreview | null>;
  acceptInvite(context: AuthenticatedContext, token: string, request: AcceptInviteRequest): Promise<{
    group: GroupRecord;
    member: GroupMemberRecord;
    claimed: boolean;
  }>;
  recordClientRequest(groupId: string, client_request_id: string, resourceId: string): Promise<void>;
};
