import type { CreateGroupRequest } from "../contracts/schemas";
import { createApiClient, type EquoApiClient, type GroupDetail } from "./apiClient";
import { toCreateExpenseRequest, toGroup, toGroupUiData, toSettlementTransferRequest } from "./cloudAdapters";
import type { Expense, Group, Member } from "./appTypes";
import type { ExpenseDraft } from "./ExpenseComposerSheet";

export type CloudGroupData = {
  group: Group;
  members: Member[];
  expenses: Expense[];
};

export type CloudGroupsState = {
  groups: Group[];
  groupDetails: Record<string, CloudGroupData>;
  loadingGroups: boolean;
  loadingGroupIds: Record<string, boolean>;
};

export type ApiClientLike = Pick<
  EquoApiClient,
  | "createGroup"
  | "listGroups"
  | "getGroupDetail"
  | "updateGroup"
  | "createVirtualMember"
  | "archiveGroup"
  | "deleteGroup"
  | "createInvite"
  | "acceptInvite"
  | "createExpense"
  | "deleteExpense"
>;

function isUnauthenticatedError(error: unknown): boolean {
  const code = (error as { code?: string } | null)?.code;
  if (code === "UNAUTHENTICATED") return true;
  const message = error instanceof Error ? error.message : String(error);
  return /sign in with google|profile could not be resolved|unauthenticated/i.test(message);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function initialState(): CloudGroupsState {
  return {
    groups: [],
    groupDetails: {},
    loadingGroups: false,
    loadingGroupIds: {},
  };
}

export type CreateCloudGroupsStoreOptions = {
  apiClient: ApiClientLike;
  onSessionExpired: () => void;
};

/**
 * Thin async layer owning cloud state: the groups list, a per-group detail
 * cache, loading flags, and mutation functions. Every mutation follows a
 * simple "call API, then re-fetch" model - there are no optimistic updates.
 *
 * This is a plain, hook-free store so it can be unit tested directly with a
 * fake api client (mirroring apiClient.test.ts) without any DOM/React
 * testing dependency. React components bind to it via subscribe().
 */
export function createCloudGroupsStore({ apiClient, onSessionExpired }: CreateCloudGroupsStoreOptions) {
  let state = initialState();
  const listeners = new Set<() => void>();

  function setState(patch: Partial<CloudGroupsState>) {
    state = { ...state, ...patch };
    listeners.forEach((listener) => listener());
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

  function handleError(error: unknown): never {
    if (isUnauthenticatedError(error)) {
      onSessionExpired();
    }
    throw new Error(errorMessage(error));
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
      const { group } = await apiClient.createGroup({
        client_request_id: crypto.randomUUID(),
        ...payload,
      });
      await refreshGroups();
      return toGroup(group);
    } catch (error) {
      return handleError(error);
    }
  }

  async function renameGroup(groupId: string, name: string) {
    try {
      await apiClient.updateGroup(groupId, { client_request_id: crypto.randomUUID(), name });
      await Promise.all([refreshGroups(), refreshGroupDetail(groupId)]);
    } catch (error) {
      handleError(error);
    }
  }

  async function addVirtualMember(groupId: string, displayName: string) {
    try {
      await apiClient.createVirtualMember(groupId, {
        client_request_id: crypto.randomUUID(),
        display_name: displayName,
      });
      await refreshGroupDetail(groupId);
    } catch (error) {
      handleError(error);
    }
  }

  async function archiveGroup(groupId: string) {
    try {
      await apiClient.archiveGroup(groupId, { client_request_id: crypto.randomUUID() });
      await refreshGroups();
    } catch (error) {
      handleError(error);
    }
  }

  async function deleteGroup(groupId: string) {
    try {
      await apiClient.deleteGroup(groupId, { client_request_id: crypto.randomUUID() });
      await refreshGroups();
    } catch (error) {
      handleError(error);
    }
  }

  async function addExpense(groupId: string, draft: ExpenseDraft, groupCurrency: string) {
    try {
      await apiClient.createExpense(groupId, toCreateExpenseRequest(draft, groupCurrency));
      await refreshGroupDetail(groupId);
    } catch (error) {
      handleError(error);
    }
  }

  async function editExpense(groupId: string, expenseId: string, draft: ExpenseDraft, groupCurrency: string) {
    try {
      await apiClient.deleteExpense(groupId, expenseId, { client_request_id: crypto.randomUUID() });
      await apiClient.createExpense(groupId, toCreateExpenseRequest(draft, groupCurrency));
      await refreshGroupDetail(groupId);
    } catch (error) {
      handleError(error);
    }
  }

  async function deleteExpense(groupId: string, expenseId: string) {
    try {
      await apiClient.deleteExpense(groupId, expenseId, { client_request_id: crypto.randomUUID() });
      await refreshGroupDetail(groupId);
    } catch (error) {
      handleError(error);
    }
  }

  async function settleTransfer(groupId: string, fromId: string, toId: string, amountMinor: number, currency: string) {
    try {
      await apiClient.createExpense(groupId, toSettlementTransferRequest(fromId, toId, amountMinor, currency));
      await refreshGroupDetail(groupId);
    } catch (error) {
      handleError(error);
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
      await refreshGroups();
      return toGroup(result.group);
    } catch (error) {
      return handleError(error);
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
    archiveGroup,
    deleteGroup,
    addExpense,
    editExpense,
    deleteExpense,
    settleTransfer,
    createInvite,
    acceptInvite,
  };
}

export type CloudGroupsStore = ReturnType<typeof createCloudGroupsStore>;

export function createCloudApiClient(authToken: string): ApiClientLike {
  return createApiClient({ authToken });
}
