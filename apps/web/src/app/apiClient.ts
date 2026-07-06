import type {
  ConfirmSettlementRequest,
  AcceptInviteRequest,
  CreateVirtualMemberRequest,
  CreateExpenseRequest,
  CreateGroupRequest,
  CreateInviteRequest,
  RemoveGroupMemberRequest,
  RenameGroupMemberRequest,
  UpdateGroupRequest,
  UploadGroupImageRequest,
} from "../contracts/schemas";

type ApiClientOptions = {
  baseUrl?: string;
  authToken: string;
  fetcher?: typeof fetch;
};

export type GroupSummary = {
  id: string;
  name: string;
  currency: string;
  owner_member_id: string;
  cover_image_url?: string | null;
};

export type ArchivedGroupSummary = GroupSummary & {
  archived_at: string;
  /** The caller's own group_members.id for this archived group (see groupRepository.ts's ArchivedGroupRecord doc). */
  caller_member_id: string;
};

export type GroupMemberSummary = {
  id: string;
  group_id: string;
  user_id: string | null;
  display_name: string;
  role: "owner" | "member";
  status: "active" | "removed";
};

export type ExpensePaymentSummary = {
  payer_member_id: string;
  amount_minor: number;
  currency: string;
};

export type ExpenseShareSummary = {
  member_id: string;
  share_type: string;
  share_value?: number;
  amount_minor: number;
};

export type ExpenseSummary = {
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
  expense_payments?: ExpensePaymentSummary[];
  expense_shares?: ExpenseShareSummary[];
};

export type BalanceSummary = {
  memberId: string;
  balance: {
    amount_minor: number;
    currency: string;
  };
};

export type SettlementTransferSummary = {
  fromMemberId: string;
  toMemberId: string;
  amount: {
    amount_minor: number;
    currency: string;
  };
};

export type GroupDetail = {
  group: GroupSummary;
  members: GroupMemberSummary[];
  expenses: ExpenseSummary[];
  balances: BalanceSummary[];
};

export type EquoApiClient = ReturnType<typeof createApiClient>;

export type ApiClientError = Error & { code?: string };

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json();

  if (!response.ok) {
    const message = payload?.error?.message ?? "Request failed";
    const error: ApiClientError = new Error(message);
    error.code = payload?.error?.code;
    throw error;
  }

  return payload as T;
}

export function createApiClient({ baseUrl = "/api/v1", authToken, fetcher = fetch }: ApiClientOptions) {
  async function request<T>(path: string, init: RequestInit): Promise<T> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(init.headers as Record<string, string> | undefined),
    };

    if (authToken.trim()) {
      headers.Authorization = `Bearer ${authToken}`;
    }

    const response = await fetcher(`${baseUrl}${path}`, {
      ...init,
      credentials: "same-origin",
      headers,
    });

    return readJson<T>(response);
  }

  return {
    exchangeGoogleToken(idToken: string) {
      return request<{
        session: {
          token: string;
          expires_at: string;
          user: { id: string; email: string; display_name: string };
        };
      }>("/auth/google", {
        method: "POST",
        body: JSON.stringify({ id_token: idToken }),
      });
    },
    exchangeSupabaseToken(accessToken: string) {
      return request<{
        session: {
          token: string;
          expires_at: string;
          user: { id: string; email: string; display_name: string };
        };
      }>("/auth/supabase", {
        method: "POST",
        body: JSON.stringify({ access_token: accessToken }),
      });
    },
    createGroup(payload: CreateGroupRequest) {
      return request<{ group: GroupSummary; owner_member: GroupMemberSummary }>("/groups", {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    listGroups() {
      return request<{ groups: GroupSummary[] }>("/groups", {
        method: "GET",
      });
    },
    listArchivedGroups() {
      return request<{ groups: ArchivedGroupSummary[] }>("/groups/archived", {
        method: "GET",
      });
    },
    getGroupDetail(groupId: string) {
      return request<GroupDetail>(`/groups/${groupId}`, {
        method: "GET",
      });
    },
    updateGroup(groupId: string, payload: UpdateGroupRequest) {
      return request<{ group: GroupSummary }>(`/groups/${groupId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    createVirtualMember(groupId: string, payload: CreateVirtualMemberRequest) {
      return request<{ member: GroupMemberSummary }>(`/groups/${groupId}/members`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    renameGroupMember(groupId: string, memberId: string, payload: RenameGroupMemberRequest) {
      return request<{ member: GroupMemberSummary }>(`/groups/${groupId}/members/${memberId}`, {
        method: "PATCH",
        body: JSON.stringify(payload),
      });
    },
    removeGroupMember(groupId: string, memberId: string, payload: RemoveGroupMemberRequest) {
      return request<{ member: GroupMemberSummary }>(`/groups/${groupId}/members/${memberId}`, {
        method: "DELETE",
        body: JSON.stringify(payload),
      });
    },
    archiveGroup(groupId: string, payload: { client_request_id: string }) {
      return request<{ group: GroupSummary }>(`/groups/${groupId}/archive`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    unarchiveGroup(groupId: string, payload: { client_request_id: string }) {
      return request<{ group: GroupSummary }>(`/groups/${groupId}/unarchive`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    deleteGroup(groupId: string, payload: { client_request_id: string }) {
      return request<{ group: GroupSummary }>(`/groups/${groupId}`, {
        method: "DELETE",
        body: JSON.stringify(payload),
      });
    },
    createInvite(groupId: string, payload: CreateInviteRequest) {
      return request<{ invite: { token: string; max_uses: number } }>(`/groups/${groupId}/invites`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    acceptInvite(token: string, payload: AcceptInviteRequest) {
      return request<{ group: GroupSummary; member: GroupMemberSummary; claimed: boolean }>(
        `/invites/${token}/accept`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
    },
    createExpense(groupId: string, payload: CreateExpenseRequest) {
      return request<{ expense: { id: string; title: string; amount_minor: number; currency: string } }>(
        `/groups/${groupId}/expenses`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
    },
    deleteExpense(groupId: string, expenseId: string, payload: { client_request_id: string }) {
      return request<{ expense: { id: string } }>(`/groups/${groupId}/expenses/${expenseId}`, {
        method: "DELETE",
        body: JSON.stringify(payload),
      });
    },
    uploadGroupImage(groupId: string, payload: UploadGroupImageRequest) {
      return request<{ image: { url: string } }>(`/groups/${groupId}/images`, {
        method: "POST",
        body: JSON.stringify(payload),
      });
    },
    calculateSettlement(groupId: string) {
      return request<{
        settlement: { id: string; settlement_version: number; status: string };
        transfers: SettlementTransferSummary[];
      }>(`/groups/${groupId}/settlement/calculate`, {
        method: "POST",
        body: JSON.stringify({ client_request_id: crypto.randomUUID() }),
      });
    },
    confirmSettlement(groupId: string, settlementId: string, payload: ConfirmSettlementRequest) {
      return request<{ settlement: { id: string; status: string } }>(
        `/groups/${groupId}/settlement/${settlementId}/confirm`,
        {
          method: "POST",
          body: JSON.stringify(payload),
        },
      );
    },
  };
}
