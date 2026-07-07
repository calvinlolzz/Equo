import type { CreateGroupRequest } from "../contracts/schemas";
import { createApiClient, type ArchivedGroupSummary, type BalanceSummary, type EquoApiClient, type GroupDetail } from "./apiClient";
import { loadCloudCache, saveCloudCache, type CacheStorage } from "./cloudCache";
import {
  draftToExpense,
  settlementTransferToDraft,
  toCreateExpenseRequest,
  toExpense,
  toGroup,
  toGroupUiData,
  toMembers,
  toSettlementTransferRequest,
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

function emptyAggregates(): GroupDetailAggregates {
  return { expenseCount: 0, spendTotalMinor: 0, spendByDay: [], memberDayShares: [] };
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
  | "deleteExpense"
  | "uploadGroupImage"
  | "listExpensesPage"
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

function isUnauthenticatedError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === "UNAUTHENTICATED") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /sign in with google|profile could not be resolved|unauthenticated/i.test(message);
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
export function createCloudGroupsStore({ apiClient, onSessionExpired, userId, cacheStorage }: CreateCloudGroupsStoreOptions) {
  let state = initialState(userId, cacheStorage);
  const listeners = new Set<() => void>();
  let persistTimeout: ReturnType<typeof setTimeout> | null = null;

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

  /** Replace a group's entry in place, preserving its position in the list. */
  function patchGroupInList(group: Group) {
    const index = state.groups.findIndex((existing) => existing.id === group.id);
    if (index === -1) {
      setState({ groups: [...state.groups, group] });
      return;
    }
    const groups = [...state.groups];
    groups[index] = group;
    setState({ groups });
  }

  function removeFromGroupsList(groupId: string) {
    setState({ groups: state.groups.filter((existing) => existing.id !== groupId) });
  }

  function patchGroupDetail(groupId: string, patch: Partial<CloudGroupData>) {
    const current = state.groupDetails[groupId];
    if (!current) return;
    setState({ groupDetails: { ...state.groupDetails, [groupId]: { ...current, ...patch } } });
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

  async function refreshGroupDetail(groupId: string): Promise<CloudGroupData> {
    setGroupLoading(groupId, true);
    try {
      const detail: GroupDetail = await apiClient.getGroupDetail(groupId);
      const data = toGroupUiData(detail);
      setState({ groupDetails: { ...state.groupDetails, [groupId]: data } });
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

  async function addExpense(groupId: string, draft: ExpenseDraft, groupCurrency: string) {
    try {
      const { expense } = await apiClient.createExpense(groupId, toCreateExpenseRequest(draft, groupCurrency));
      applyNewExpense(groupId, draftToExpense(draft, expense));
    } catch (error) {
      resyncInBackground(groupId);
      handleError(error);
    }
  }

  /**
   * Edit = delete the old expense then create the new one (the API has no
   * in-place expense update). The local patch mirrors that exactly: remove
   * the old expense's balance/aggregate contribution, then apply the new
   * one's - so a percent-split-to-fixed-split edit, a kind change, or a
   * date change (moving an entry in/out of the 8-day window) all net out
   * correctly without a refetch.
   */
  async function editExpense(groupId: string, expenseId: string, draft: ExpenseDraft, groupCurrency: string) {
    try {
      await apiClient.deleteExpense(groupId, expenseId, { client_request_id: crypto.randomUUID() });
      const { expense } = await apiClient.createExpense(groupId, toCreateExpenseRequest(draft, groupCurrency));
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
      resyncInBackground(groupId);
      handleError(error);
    }
  }

  async function deleteExpense(groupId: string, expenseId: string) {
    try {
      await apiClient.deleteExpense(groupId, expenseId, { client_request_id: crypto.randomUUID() });
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
      resyncInBackground(groupId);
      handleError(error);
    }
  }

  async function settleTransfer(groupId: string, fromId: string, toId: string, amountMinor: number, currency: string) {
    try {
      const { expense } = await apiClient.createExpense(groupId, toSettlementTransferRequest(fromId, toId, amountMinor, currency));
      const draft = settlementTransferToDraft(fromId, toId, amountMinor);
      applyNewExpense(groupId, draftToExpense(draft, expense, "settlement"));
    } catch (error) {
      resyncInBackground(groupId);
      handleError(error);
    }
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

  return {
    getState,
    subscribe,
    refreshGroups,
    refreshGroupDetail,
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
    createInvite,
    acceptInvite,
    uploadGroupImage,
    updateGroupCover,
  };
}

export type CloudGroupsStore = ReturnType<typeof createCloudGroupsStore>;

export function createCloudApiClient(authToken: string): ApiClientLike {
  return createApiClient({ authToken });
}
