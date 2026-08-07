import type { CreateGroupRequest } from "../contracts/schemas";
import {
  createApiClient,
  isNetworkError,
  type ArchivedGroupSummary,
  type BalanceSummary,
  type EquoApiClient,
  type GroupDetail,
  type SpendPeriodKind,
} from "./apiClient";
import { loadCloudCache, saveCloudCache, type CacheStorage } from "./cloudCache";
import {
  draftToExpense,
  settlementTransferToDraft,
  toCreateExpenseRequest,
  toExpense,
  toGroup,
  toGroupUiData,
  toMembers,
} from "./cloudAdapters";
import type { Expense, Group, Member } from "./appTypes";
import {
  applyExpenseToAggregates,
  applyExpenseToBalances,
  removeExpenseFromAggregates,
  removeExpenseFromBalances,
  type GroupDetailAggregates,
} from "./detailAggregates";
import type { ExpenseDraft } from "./ExpenseComposerSheet";
import {
  appendWrite,
  applyQueuedWrites,
  findWrite,
  isLocalExpenseId,
  loadQueue,
  newLocalExpenseId,
  removeWrite,
  saveQueue,
  type QueuedWrite,
} from "./offlineQueue";

function emptyAggregates(): GroupDetailAggregates {
  return { expenseCount: 0, spendTotalMinor: 0, spendByDay: [], spendByCategory: [], memberDayShares: [] };
}

export type CloudGroupData = {
  group: Group;
  members: Member[];
  expenses: Expense[];
  /** Server-computed per-member balances (get_group_detail's balances array) - the group-level source of truth, patched optimistically on every mutation via detailAggregates. */
  balances: BalanceSummary[];
  /** Server-authoritative aggregates (expenseCount/spendTotalMinor/spendByDay/memberDayShares) - see detailAggregates.ts. */
  aggregates: GroupDetailAggregates;
};

export type ArchivedGroupData = {
  id: string;
  name: string;
  currency: string;
  coverImageUrl?: string;
  ownerMemberId: string;
  callerMemberId: string;
};

export type CloudGroupsState = {
  groups: Group[];
  groupDetails: Record<string, CloudGroupData>;
  loadingGroups: boolean;
  loadingGroupIds: Record<string, boolean>;
  /** Busy flags for loadMoreExpenses, keyed by groupId - see the records panel's 載入更多 button. */
  loadingMoreExpenseIds: Record<string, boolean>;
  /** Expense writes made while the network was unreachable, waiting to be sent - see offlineQueue.ts. */
  pendingWrites: QueuedWrite[];
  /** True while flushPendingWrites is draining the queue. */
  flushingWrites: boolean;
};

export type ApiClientLike = Pick<
  EquoApiClient,
  | "createGroup"
  | "listGroups"
  | "listArchivedGroups"
  | "getGroupDetail"
  | "updateGroup"
  | "createVirtualMember"
  | "renameGroupMember"
  | "removeGroupMember"
  | "archiveGroup"
  | "unarchiveGroup"
  | "deleteGroup"
  | "createInvite"
  | "acceptInvite"
  | "createExpense"
  | "replaceExpense"
  | "deleteExpense"
  | "uploadGroupImage"
  | "listExpensesPage"
  | "markGroupRead"
  | "getSpendBreakdown"
>;

function toArchivedGroupData(summary: ArchivedGroupSummary): ArchivedGroupData {
  return {
    id: summary.id,
    name: summary.name,
    currency: summary.currency,
    coverImageUrl: summary.cover_image_url ?? undefined,
    ownerMemberId: summary.owner_member_id,
    callerMemberId: summary.caller_member_id,
  };
}

/**
 * Session is no longer usable - the token expired, was signed with a rotated
 * secret, or the account has since been disabled. Keyed on the API's error
 * code, never on the message: the messages are user-facing copy (and partly
 * Chinese), so matching them by regex means a wording change silently stops
 * logging expired sessions out.
 */
function isUnauthenticatedError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  return code === "UNAUTHENTICATED" || code === "ACCOUNT_DISABLED";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function initialState(userId?: string, cacheStorage?: CacheStorage): CloudGroupsState {
  const cached = userId ? loadCloudCache(userId, cacheStorage) : null;
  return {
    groups: cached?.groups ?? [],
    groupDetails: cached?.groupDetails ?? {},
    loadingGroups: false,
    loadingGroupIds: {},
    loadingMoreExpenseIds: {},
    pendingWrites: userId ? loadQueue(userId, cacheStorage) : [],
    flushingWrites: false,
  };
}

export type CreateCloudGroupsStoreOptions = {
  apiClient: ApiClientLike;
  onSessionExpired: () => void;
  /**
   * The logged-in user's id, used to key the localStorage display-seed cache
   * (see cloudCache.ts). When provided, the store seeds its initial state
   * from any cached snapshot for this user so the app can render instantly
   * on reload, and persists every state change back to the cache (debounced)
   * so the next reload has fresh data to seed from. Omit in tests that don't
   * care about the cache - the store falls back to a blank initial state and
   * skips persistence entirely.
   */
  userId?: string;
  /** Injectable storage for tests; defaults to window.localStorage. */
  cacheStorage?: CacheStorage;
  /**
   * A queued offline write the server refused outright (validation, permission,
   * the group was deleted meanwhile). It is dropped rather than retried forever,
   * so the UI has to be able to say so - otherwise the entry just disappears on
   * the next resync with no explanation.
   */
  onWriteDropped?: (write: QueuedWrite, error: unknown) => void;
};

/**
 * Thin async layer owning cloud state: the groups list, a per-group detail
 * cache, loading flags, and mutation functions.
 *
 * Every mutation applies the API response directly to local state instead of
 * re-fetching the groups list / group detail on the success path - the
 * response already carries everything needed (the updated group, member, or
 * expense row), and balances/debts are computed client-side from the cached
 * detail (computeMemberBalances), so a locally-patched detail cache is fully
 * authoritative for rendering. This turns every mutation from 2-3 network
 * round-trips into 1.
 *
 * The one exception is failure: after surfacing the error to the caller, a
 * background refreshGroupDetail/refreshGroups call re-syncs from the server
 * so a partially-applied local state never drifts from truth. refreshGroupDetail
 * is also still used for the initial "open a group" load, where there is no
 * response to apply from yet.
 *
 * This is a plain, hook-free store so it can be unit tested directly with a
 * fake api client (mirroring apiClient.test.ts) without any DOM/React
 * testing dependency. React components bind to it via subscribe().
 */
export function createCloudGroupsStore({
  apiClient,
  onSessionExpired,
  userId,
  cacheStorage,
  onWriteDropped,
}: CreateCloudGroupsStoreOptions) {
  let state = initialState(userId, cacheStorage);
  const listeners = new Set<() => void>();
  let persistTimeout: ReturnType<typeof setTimeout> | null = null;
  let flushing = false;

  /** Debounced (~300ms) write-through of {groups, groupDetails} to the cloud cache. */
  function schedulePersist() {
    if (!userId) return;
    if (persistTimeout) clearTimeout(persistTimeout);
    persistTimeout = setTimeout(() => {
      persistTimeout = null;
      saveCloudCache({ userId, groups: state.groups, groupDetails: state.groupDetails }, cacheStorage);
    }, 300);
  }

  function setState(patch: Partial<CloudGroupsState>) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
    if (patch.groups !== undefined || patch.groupDetails !== undefined) {
      schedulePersist();
    }
  }

  function getState() {
    return state;
  }

  function subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function setGroupLoading(groupId: string, loading: boolean) {
    const loadingGroupIds = { ...state.loadingGroupIds };
    if (loading) {
      loadingGroupIds[groupId] = true;
    } else {
      delete loadingGroupIds[groupId];
    }
    setState({ loadingGroupIds });
  }

  function setLoadingMoreExpenses(groupId: string, loading: boolean) {
    const loadingMoreExpenseIds = { ...state.loadingMoreExpenseIds };
    if (loading) {
      loadingMoreExpenseIds[groupId] = true;
    } else {
      delete loadingMoreExpenseIds[groupId];
    }
    setState({ loadingMoreExpenseIds });
  }

  function handleError(error: unknown): never {
    if (isUnauthenticatedError(error)) {
      onSessionExpired();
    }
    // Preserve the API error code (e.g. MEMBER_HAS_BALANCE) so UI callers
    // can map specific failures to friendlier uiText messages.
    const rethrown: Error & { code?: string } = new Error(errorMessage(error));
    const code = (error as { code?: string } | null)?.code;
    if (code) {
      rethrown.code = code;
    }
    throw rethrown;
  }

  /** Fire-and-forget re-sync used as a safety net after a mutation failure. */
  function resyncInBackground(groupId?: string) {
    refreshGroups().catch(() => {});
    if (groupId) {
      refreshGroupDetail(groupId).catch(() => {});
    }
  }

  /** Insert/replace a group at the head of the list (new or just-unarchived groups). */
  function upsertGroupAtHead(group: Group) {
    setState({ groups: [group, ...state.groups.filter((existing) => existing.id !== group.id)] });
  }

  /**
   * Replace a group's entry in place, preserving its position in the list.
   *
   * The incoming group comes from a write response (a rename, a cover change),
   * and those payloads carry no unread count and no balance — see toGroup. So
   * the list-only decorations are carried over from the entry being replaced;
   * without that, renaming a group blanks its balance and badge until the next
   * background refresh, which reads as "renaming settled my debts".
   */
  function patchGroupInList(group: Group) {
    const index = state.groups.findIndex((existing) => existing.id === group.id);
    if (index === -1) {
      setState({ groups: [...state.groups, group] });
      return;
    }
    const previous = state.groups[index];
    group = {
      ...group,
      ...(group.unreadCount === undefined && previous.unreadCount !== undefined
        ? { unreadCount: previous.unreadCount }
        : {}),
      ...(group.balanceMinor === undefined && previous.balanceMinor !== undefined
        ? { balanceMinor: previous.balanceMinor }
        : {}),
    };
    const groups = [...state.groups];
    groups[index] = group;
    setState({ groups });
  }

  function removeFromGroupsList(groupId: string) {
    setState({ groups: state.groups.filter((existing) => existing.id !== groupId) });
  }

  /**
   * The logged-in user's own balance according to a loaded detail, or
   * undefined when it cannot be told (no user id in this store, the user has
   * no member row in this group).
   *
   * The detail's balances are kept exact locally through every ledger write
   * (see applyExpenseToBalances / removeExpenseFromBalances), so this is how
   * the group list's number stays honest between background refreshes: record
   * an expense and go back to the list, and the row already agrees with the
   * screen you just left.
   */
  function listBalanceFromDetail(data: CloudGroupData): number | undefined {
    if (!userId) return undefined;
    const member = data.members.find((candidate) => candidate.userId === userId);
    if (!member) return undefined;
    // A member with no entries has no balance row; that is a real zero, not a
    // missing value.
    return data.balances.find((balance) => balance.memberId === member.id)?.balance.amount_minor ?? 0;
  }

  function groupsWithDetailBalance(groups: Group[], groupId: string, data: CloudGroupData): Group[] {
    const balanceMinor = listBalanceFromDetail(data);
    if (balanceMinor === undefined) return groups;

    return groups.map((group) => (group.id === groupId ? { ...group, balanceMinor } : group));
  }

  function patchGroupDetail(groupId: string, patch: Partial<CloudGroupData>) {
    const current = state.groupDetails[groupId];
    if (!current) return;
    const next = { ...current, ...patch };
    setState({
      groupDetails: { ...state.groupDetails, [groupId]: next },
      groups: groupsWithDetailBalance(state.groups, groupId, next),
    });
  }

  function dropGroupDetail(groupId: string) {
    if (!state.groupDetails[groupId]) return;
    const groupDetails = { ...state.groupDetails };
    delete groupDetails[groupId];
    setState({ groupDetails });
  }

  /**
   * Applies a newly-added expense to the cached detail: prepends it to the
   * loaded expenses window, and patches balances/aggregates via
   * detailAggregates so the group-level numbers (总计/债务/date chips) stay
   * correct without waiting for a background refresh. See editExpense/
   * deleteExpense for the remove/re-apply variants.
   */
  function applyNewExpense(groupId: string, expense: Expense) {
    const current = state.groupDetails[groupId];
    if (!current) return;
    const memberIds = current.members.map((member) => member.id);
    patchGroupDetail(groupId, {
      expenses: [expense, ...current.expenses],
      balances: applyExpenseToBalances(current.balances, expense, memberIds, current.group.currency),
      aggregates: applyExpenseToAggregates(current.aggregates, expense, memberIds),
    });
  }

  /**
   * Patch the cached detail with a single queued write, using the exact same
   * fold applyQueuedWrites runs after a background refresh. Sharing the math
   * is the point: the row and the totals the user sees the instant they hit
   * 儲存 offline must survive a resync unchanged.
   */
  function applyWriteLocally(write: QueuedWrite) {
    const current = state.groupDetails[write.groupId];
    if (!current) return;
    patchGroupDetail(write.groupId, applyQueuedWrites(current, [write]));
  }

  function persistQueue(writes: QueuedWrite[]): boolean {
    if (!userId) return false;
    if (!saveQueue(userId, writes, cacheStorage)) return false;
    setState({ pendingWrites: writes });
    return true;
  }

  /**
   * Queue a write and echo it into the cache. Returns false when it could not
   * be written down (no user, or localStorage is full - a queued receipt photo
   * is the realistic cause), in which case the caller must surface the original
   * failure rather than tell the user it is safely waiting to send.
   */
  function queueWrite(write: QueuedWrite): boolean {
    if (!persistQueue(appendWrite(state.pendingWrites, write))) return false;
    applyWriteLocally(write);
    return true;
  }

  function dequeueWrite(expenseId: string) {
    persistQueue(removeWrite(state.pendingWrites, expenseId));
  }

  /**
   * Rewrite one cached expense row in place. Used after a queued write lands:
   * a create's local- id has to become the real id (nothing server-side would
   * recognise the local one, so a later edit or delete would 404), and a queued
   * receipt photo's inline data URL becomes the uploaded URL.
   */
  function patchCachedExpense(groupId: string, expenseId: string, patch: Partial<Expense>) {
    const current = state.groupDetails[groupId];
    if (!current) return;
    patchGroupDetail(groupId, {
      expenses: current.expenses.map((expense) => (expense.id === expenseId ? { ...expense, ...patch } : expense)),
    });
  }

  /** Send one queued write. Throws on failure so the caller can tell apart "still offline" from "rejected". */
  async function sendQueuedWrite(write: QueuedWrite) {
    if (write.kind === "delete") {
      await apiClient.deleteExpense(write.groupId, write.expenseId, { client_request_id: write.clientRequestId });
      return;
    }

    let request = write.request;
    let uploadedImageUrl: string | undefined;
    if (write.imageDataUrl) {
      const { image } = await apiClient.uploadGroupImage(write.groupId, {
        client_request_id: crypto.randomUUID(),
        kind: "expense",
        data_url: write.imageDataUrl,
      });
      uploadedImageUrl = image.url;
      request = { ...request, image_url: image.url };
    }

    if (write.kind === "replace") {
      await apiClient.replaceExpense(write.groupId, write.expenseId, request);
      if (uploadedImageUrl) {
        patchCachedExpense(write.groupId, write.expenseId, { imageUrl: uploadedImageUrl });
      }
      return;
    }

    const { expense } = await apiClient.createExpense(write.groupId, request);
    patchCachedExpense(write.groupId, write.expenseId, {
      id: expense.id,
      ...(uploadedImageUrl ? { imageUrl: uploadedImageUrl } : {}),
    });
  }

  /**
   * Drain the queue oldest-first. Stops at the first network failure (still
   * offline - everything stays queued for the next attempt) and drops any write
   * the server actively rejects, because replaying a rejected write forever
   * would wedge every entry behind it.
   *
   * The frozen request payloads carry their original client_request_id, and
   * create/replace/delete are all idempotent on it server-side, so a retry
   * after an ambiguous failure returns the original row instead of duplicating.
   */
  async function flushPendingWrites() {
    if (flushing) return;
    if (state.pendingWrites.length === 0) return;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return;

    flushing = true;
    setState({ flushingWrites: true });
    const touchedGroupIds = new Set<string>();

    try {
      while (state.pendingWrites.length > 0) {
        const write = state.pendingWrites[0];
        try {
          await sendQueuedWrite(write);
        } catch (error) {
          if (isNetworkError(error)) return;
          if (isUnauthenticatedError(error)) {
            onSessionExpired();
            return;
          }
          onWriteDropped?.(write, error);
        }
        dequeueWrite(write.expenseId);
        touchedGroupIds.add(write.groupId);
      }
    } finally {
      flushing = false;
      setState({ flushingWrites: false });
      // Re-sync what the flush touched: any dropped write left the cache showing
      // something the server never accepted, and even the happy path benefits
      // from server-authoritative aggregates after a batch of offline edits.
      if (touchedGroupIds.size > 0) {
        refreshGroups().catch(() => {});
        touchedGroupIds.forEach((groupId) => {
          refreshGroupDetail(groupId).catch(() => {});
        });
      }
    }
  }

  async function refreshGroups() {
    setState({ loadingGroups: true });
    try {
      const { groups: summaries } = await apiClient.listGroups();
      setState({ groups: summaries.map(toGroup) });
    } catch (error) {
      handleError(error);
    } finally {
      setState({ loadingGroups: false });
    }
  }

  /**
   * "I have seen this group" — clears its badge here and on the caller's other
   * devices.
   *
   * Deliberately silent on failure: an unread dot that lingers one refresh
   * longer is not worth a toast, and this fires from opening a group, where an
   * error message would be about something the user did not ask for. The local
   * count is cleared either way, so the badge never outlives the visit that
   * cleared it even when the request is what failed.
   */
  async function markGroupRead(groupId: string): Promise<void> {
    const target = state.groups.find((group) => group.id === groupId);
    if (!target || !target.unreadCount) return;

    setState({
      groups: state.groups.map((group) => (group.id === groupId ? { ...group, unreadCount: 0 } : group)),
    });

    try {
      await apiClient.markGroupRead(groupId);
    } catch {
      // Next refreshGroups re-reads the server's truth.
    }
  }

  async function refreshGroupDetail(groupId: string): Promise<CloudGroupData> {
    setGroupLoading(groupId, true);
    try {
      const detail: GroupDetail = await apiClient.getGroupDetail(groupId);
      // Server truth knows nothing about writes still sitting in the queue, so
      // replay them on top - otherwise a background refresh makes every offline
      // entry blink out of existence until the flush lands.
      const data = applyQueuedWrites(toGroupUiData(detail), state.pendingWrites);
      setState({
        groupDetails: { ...state.groupDetails, [groupId]: data },
        // The detail is revalidated more often than the list (see autoSync's
        // groupsListEveryNTicks), so this is usually the fresher number.
        groups: groupsWithDetailBalance(state.groups, groupId, data),
      });
      return data;
    } catch (error) {
      return handleError(error);
    } finally {
      setGroupLoading(groupId, false);
    }
  }

  async function createGroup(payload: Omit<CreateGroupRequest, "client_request_id">): Promise<Group> {
    try {
      const { group, owner_member } = await apiClient.createGroup({
        client_request_id: crypto.randomUUID(),
        ...payload,
      });
      const localGroup = toGroup(group);
      const ownerMembers = toMembers([owner_member]);
      upsertGroupAtHead(localGroup);
      setState({
        groupDetails: {
          ...state.groupDetails,
          [localGroup.id]: {
            group: localGroup,
            members: ownerMembers,
            expenses: [],
            balances: ownerMembers.map((member) => ({
              memberId: member.id,
              balance: { amount_minor: 0, currency: localGroup.currency },
            })),
            aggregates: emptyAggregates(),
          },
        },
      });
      return localGroup;
    } catch (error) {
      resyncInBackground();
      return handleError(error);
    }
  }

  async function renameGroup(groupId: string, name: string) {
    try {
      const { group } = await apiClient.updateGroup(groupId, { client_request_id: crypto.randomUUID(), name });
      const localGroup = toGroup(group);
      patchGroupInList(localGroup);
      patchGroupDetail(groupId, { group: localGroup });
    } catch (error) {
      resyncInBackground(groupId);
      handleError(error);
    }
  }

  async function addVirtualMember(groupId: string, displayName: string) {
    try {
      const { member } = await apiClient.createVirtualMember(groupId, {
        client_request_id: crypto.randomUUID(),
        display_name: displayName,
      });
      const current = state.groupDetails[groupId];
      if (current) {
        const [mapped] = toMembers([member]);
        if (mapped) {
          patchGroupDetail(groupId, { members: [...current.members, mapped] });
        }
      }
    } catch (error) {
      resyncInBackground(groupId);
      handleError(error);
    }
  }

  async function renameMember(groupId: string, memberId: string, displayName: string) {
    try {
      const { member } = await apiClient.renameGroupMember(groupId, memberId, {
        client_request_id: crypto.randomUUID(),
        display_name: displayName,
      });
      const current = state.groupDetails[groupId];
      if (current) {
        const [mapped] = toMembers([member]);
        if (mapped) {
          patchGroupDetail(groupId, {
            members: current.members.map((existing) => (existing.id === memberId ? mapped : existing)),
          });
        }
      }
    } catch (error) {
      resyncInBackground(groupId);
      handleError(error);
    }
  }

  async function removeMember(groupId: string, memberId: string) {
    try {
      await apiClient.removeGroupMember(groupId, memberId, { client_request_id: crypto.randomUUID() });
      const current = state.groupDetails[groupId];
      if (current) {
        patchGroupDetail(groupId, {
          members: current.members.filter((existing) => existing.id !== memberId),
        });
      }
    } catch (error) {
      resyncInBackground(groupId);
      handleError(error);
    }
  }

  async function archiveGroup(groupId: string) {
    try {
      await apiClient.archiveGroup(groupId, { client_request_id: crypto.randomUUID() });
      removeFromGroupsList(groupId);
      dropGroupDetail(groupId);
    } catch (error) {
      resyncInBackground(groupId);
      handleError(error);
    }
  }

  async function listArchivedGroups(): Promise<ArchivedGroupData[]> {
    try {
      const { groups } = await apiClient.listArchivedGroups();
      return groups.map(toArchivedGroupData);
    } catch (error) {
      return handleError(error);
    }
  }

  async function unarchiveGroup(groupId: string): Promise<Group> {
    try {
      const { group } = await apiClient.unarchiveGroup(groupId, { client_request_id: crypto.randomUUID() });
      const localGroup = toGroup(group);
      upsertGroupAtHead(localGroup);
      return localGroup;
    } catch (error) {
      resyncInBackground();
      return handleError(error);
    }
  }

  async function deleteGroup(groupId: string) {
    try {
      await apiClient.deleteGroup(groupId, { client_request_id: crypto.randomUUID() });
      removeFromGroupsList(groupId);
      dropGroupDetail(groupId);
    } catch (error) {
      resyncInBackground(groupId);
      handleError(error);
    }
  }

  /**
   * Add an expense, falling back to the offline queue when the request never
   * reaches the server. The request payload is built once, up front, and the
   * queued copy keeps its client_request_id - so the retry after reconnect is
   * the same idempotent request, not a second expense.
   */
  async function addExpense(
    groupId: string,
    draft: ExpenseDraft,
    groupCurrency: string,
    expenseKind?: Expense["kind"],
  ) {
    const request = toCreateExpenseRequest(draft, groupCurrency);
    try {
      const { expense } = await apiClient.createExpense(groupId, request);
      applyNewExpense(groupId, draftToExpense(draft, expense, expenseKind));
    } catch (error) {
      if (isNetworkError(error) && !isUnauthenticatedError(error)) {
        const queued = queueWrite({
          kind: "create",
          groupId,
          expenseId: newLocalExpenseId(),
          queuedAt: new Date().toISOString(),
          request,
          draft: { ...draft, imageDataUrl: undefined },
          expenseKind,
          imageDataUrl: draft.imageDataUrl,
        });
        if (queued) return;
      }
      resyncInBackground(groupId);
      handleError(error);
    }
  }

  /**
   * Edit is still a delete plus a create server-side (the API has no in-place
   * expense update), but it is now ONE request that the database runs in a
   * single transaction - see replace_expense. It used to be two calls from
   * here, delete then create, and a create that failed after the delete had
   * landed destroyed the entry outright: the catch below fired, the background
   * resync pulled server truth, and server truth was "deleted".
   *
   * The local patch mirrors the server's semantics: remove the old expense's
   * balance/aggregate contribution, then apply the new one's - so a
   * percent-split-to-fixed-split edit, a kind change, or a date change (moving
   * an entry in/out of the 8-day window) all net out correctly without a
   * refetch.
   */
  async function editExpense(groupId: string, expenseId: string, draft: ExpenseDraft, groupCurrency: string) {
    const request = toCreateExpenseRequest(draft, groupCurrency);

    const queueEdit = () =>
      queueWrite({
        kind: "replace",
        groupId,
        expenseId,
        queuedAt: new Date().toISOString(),
        request,
        draft: { ...draft, imageDataUrl: undefined },
        imageDataUrl: draft.imageDataUrl,
      });

    // An expense that has never reached the server has no id to PUT against.
    // The edit folds into its pending create instead (see appendWrite), which
    // is also why this path never touches the network, online or not.
    if (isLocalExpenseId(expenseId)) {
      if (queueEdit()) return;
      const error: Error & { code?: string } = new Error("Offline write could not be saved");
      error.code = "NETWORK_ERROR";
      throw error;
    }

    try {
      const { expense } = await apiClient.replaceExpense(groupId, expenseId, request);
      const current = state.groupDetails[groupId];
      if (current) {
        const nextExpense = draftToExpense(draft, expense);
        const index = current.expenses.findIndex((item) => item.id === expenseId);
        const previousExpense = current.expenses[index];
        const expenses =
          index === -1
            ? [nextExpense, ...current.expenses]
            : [...current.expenses.slice(0, index), nextExpense, ...current.expenses.slice(index + 1)];
        const memberIds = current.members.map((member) => member.id);
        const balancesAfterRemove = previousExpense
          ? removeExpenseFromBalances(current.balances, previousExpense, memberIds, current.group.currency)
          : current.balances;
        const aggregatesAfterRemove = previousExpense
          ? removeExpenseFromAggregates(current.aggregates, previousExpense, memberIds)
          : current.aggregates;
        patchGroupDetail(groupId, {
          expenses,
          balances: applyExpenseToBalances(balancesAfterRemove, nextExpense, memberIds, current.group.currency),
          aggregates: applyExpenseToAggregates(aggregatesAfterRemove, nextExpense, memberIds),
        });
      }
    } catch (error) {
      if (isNetworkError(error) && !isUnauthenticatedError(error) && queueEdit()) return;
      resyncInBackground(groupId);
      handleError(error);
    }
  }

  async function deleteExpense(groupId: string, expenseId: string) {
    const clientRequestId = crypto.randomUUID();

    const queueDelete = () =>
      queueWrite({ kind: "delete", groupId, expenseId, queuedAt: new Date().toISOString(), clientRequestId });

    // Deleting something that never reached the server just retracts its
    // pending create - appendWrite drops both, and no request is ever made.
    if (isLocalExpenseId(expenseId)) {
      if (queueDelete()) return;
      const error: Error & { code?: string } = new Error("Offline write could not be saved");
      error.code = "NETWORK_ERROR";
      throw error;
    }

    try {
      await apiClient.deleteExpense(groupId, expenseId, { client_request_id: clientRequestId });
      const current = state.groupDetails[groupId];
      if (current) {
        const removedExpense = current.expenses.find((expense) => expense.id === expenseId);
        const memberIds = current.members.map((member) => member.id);
        patchGroupDetail(groupId, {
          expenses: current.expenses.filter((expense) => expense.id !== expenseId),
          balances: removedExpense
            ? removeExpenseFromBalances(current.balances, removedExpense, memberIds, current.group.currency)
            : current.balances,
          aggregates: removedExpense
            ? removeExpenseFromAggregates(current.aggregates, removedExpense, memberIds)
            : current.aggregates,
        });
      }
    } catch (error) {
      if (isNetworkError(error) && !isUnauthenticatedError(error) && queueDelete()) return;
      resyncInBackground(groupId);
      handleError(error);
    }
  }

  function settleTransfer(groupId: string, fromId: string, toId: string, amountMinor: number, currency: string) {
    // Routed through addExpense so a settlement made offline queues exactly
    // like any other entry; toSettlementTransferRequest's payload is what
    // toCreateExpenseRequest produces for this draft.
    return addExpense(groupId, settlementTransferToDraft(fromId, toId, amountMinor), currency, "settlement");
  }

  /**
   * Records-panel "load more": fetches the next page of older expenses
   * (cursor = the oldest currently-loaded expense's date/created_at) and
   * appends them, deduped by id. Does NOT touch balances/aggregates - those
   * are already server-authoritative in the cached detail and every loaded
   * expense (old or new) already contributed to them via the RPC, so
   * appending older rows here would double-count if it also re-applied
   * their balance/aggregate effect.
   */
  async function loadMoreExpenses(groupId: string) {
    const current = state.groupDetails[groupId];
    if (!current || current.expenses.length === 0) return;

    const oldest = current.expenses[current.expenses.length - 1];
    const beforeDate = oldest.expenseDate ?? oldest.createdAt.slice(0, 10);
    const beforeCreatedAt = oldest.createdAt;

    setLoadingMoreExpenses(groupId, true);
    try {
      const { expenses } = await apiClient.listExpensesPage(groupId, {
        beforeDate,
        beforeCreatedAt,
      });
      const existingIds = new Set(current.expenses.map((expense) => expense.id));
      const nextExpenses = expenses.map(toExpense).filter((expense) => !existingIds.has(expense.id));
      if (nextExpenses.length === 0) return;
      patchGroupDetail(groupId, { expenses: [...current.expenses, ...nextExpenses] });
    } catch (error) {
      handleError(error);
    } finally {
      setLoadingMoreExpenses(groupId, false);
    }
  }

  async function createInvite(groupId: string): Promise<string> {
    try {
      const { invite } = await apiClient.createInvite(groupId, {
        client_request_id: crypto.randomUUID(),
        max_uses: 10,
      });
      return invite.token;
    } catch (error) {
      return handleError(error);
    }
  }

  async function acceptInvite(token: string, displayName: string): Promise<Group> {
    try {
      const result = await apiClient.acceptInvite(token, {
        client_request_id: crypto.randomUUID(),
        display_name: displayName,
      });
      const localGroup = toGroup(result.group);
      upsertGroupAtHead(localGroup);
      return localGroup;
    } catch (error) {
      resyncInBackground();
      return handleError(error);
    }
  }

  async function uploadGroupImage(groupId: string, kind: "expense" | "cover", dataUrl: string): Promise<string> {
    try {
      const { image } = await apiClient.uploadGroupImage(groupId, {
        client_request_id: crypto.randomUUID(),
        kind,
        data_url: dataUrl,
      });
      return image.url;
    } catch (error) {
      return handleError(error);
    }
  }

  async function updateGroupCover(groupId: string, name: string, coverImageUrl?: string) {
    try {
      const { group } = await apiClient.updateGroup(groupId, {
        client_request_id: crypto.randomUUID(),
        name,
        cover_image_url: coverImageUrl,
      });
      const localGroup = toGroup(group);
      patchGroupInList(localGroup);
      patchGroupDetail(groupId, { group: localGroup });
    } catch (error) {
      resyncInBackground(groupId);
      handleError(error);
    }
  }

  /**
   * Deliberately NOT cached in the store's state: the 分析 period stats are
   * read-only, are only ever looked at while that panel is open, and go stale
   * the moment an expense is written. The panel owns the result for as long as
   * it is on screen; every other consumer would just be holding a snapshot.
   *
   * Errors are rethrown rather than routed through handleError so the panel can
   * show an inline retry instead of a toast over a blank section.
   */
  function fetchSpendBreakdown(groupId: string, options: { kind?: SpendPeriodKind; key?: string } = {}) {
    return apiClient.getSpendBreakdown(groupId, options);
  }

  return {
    getState,
    subscribe,
    refreshGroups,
    refreshGroupDetail,
    fetchSpendBreakdown,
    markGroupRead,
    createGroup,
    renameGroup,
    addVirtualMember,
    renameMember,
    removeMember,
    archiveGroup,
    listArchivedGroups,
    unarchiveGroup,
    deleteGroup,
    addExpense,
    editExpense,
    deleteExpense,
    loadMoreExpenses,
    settleTransfer,
    flushPendingWrites,
    hasPendingWrite: (expenseId: string) => Boolean(findWrite(state.pendingWrites, expenseId)),
    createInvite,
    acceptInvite,
    uploadGroupImage,
    updateGroupCover,
  };
}

export type CloudGroupsStore = ReturnType<typeof createCloudGroupsStore>;

