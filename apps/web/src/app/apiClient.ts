import type {
  ConfirmSettlementRequest,
  AcceptInviteRequest,
  CreateVirtualMemberRequest,
  CreateExpenseRequest,
  CreateGroupRequest,
  CreateInviteRequest,
  UpdateGroupRequest,
} from "../contracts/schemas";
import { calculateSettlement as calculateSettlementTransfers } from "../domain/settlement";

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
};

export type GroupMemberSummary = {
  id: string;
  group_id: string;
  user_id: string | null;
  display_name: string;
  role: "owner" | "member";
  status: "active" | "removed";
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
  created_at?: string;
  version: number;
  client_request_id: string;
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

async function readJson<T>(response: Response): Promise<T> {
  const payload = await response.json();

  if (!response.ok) {
    const message = payload?.error?.message ?? "Request failed";
    throw new Error(message);
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
    archiveGroup(groupId: string, payload: { client_request_id: string }) {
      return request<{ group: GroupSummary }>(`/groups/${groupId}/archive`, {
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

export function createDemoApiClient() {
  const groups = new Map<string, GroupSummary>();
  const members = new Map<string, GroupMemberSummary[]>();
  const inviteTokens = new Map<string, string>();
  const expenses: Array<{
    id: string;
    group_id: string;
    title: string;
    kind: string;
    category: string;
    amount_minor: number;
    currency: string;
    expense_date: string;
    expense_payments: CreateExpenseRequest["expense_payments"];
    expense_shares: CreateExpenseRequest["expense_shares"];
  }> = [];

  return {
    async exchangeGoogleToken(_idToken: string) {
      return {
        session: {
          token: "demo-session",
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
          user: { id: "demo-user", email: "demo@equo.local", display_name: "Demo" },
        },
      };
    },
    async exchangeSupabaseToken(_accessToken: string) {
      return {
        session: {
          token: "demo-session",
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1_000).toISOString(),
          user: { id: "demo-user", email: "demo@equo.local", display_name: "Demo" },
        },
      };
    },
    async createGroup(payload: CreateGroupRequest) {
      const id = `demo_group_${groups.size + 1}`;
      const group = {
        id,
        name: payload.name,
        currency: payload.currency,
        owner_member_id: `demo_owner_${groups.size + 1}`,
      };
      groups.set(id, group);
      members.set(id, [
        {
          id: group.owner_member_id,
          group_id: id,
          user_id: "demo-user",
          display_name: "Demo",
          role: "owner",
          status: "active",
        },
      ]);
      return { group, owner_member: members.get(id)?.[0] as GroupMemberSummary };
    },
    async listGroups() {
      return { groups: Array.from(groups.values()).reverse() };
    },
    async getGroupDetail(groupId: string) {
      const group = groups.get(groupId);

      if (!group) {
        throw new Error("Group not found");
      }

      const groupExpenses = expenses.filter((expense) => expense.group_id === groupId);
      const balances = new Map<string, number>();

      for (const expense of groupExpenses) {
        for (const payment of expense.expense_payments) {
          balances.set(payment.payer_member_id, (balances.get(payment.payer_member_id) ?? 0) + payment.amount_minor);
        }

        for (const share of expense.expense_shares) {
          balances.set(share.member_id, (balances.get(share.member_id) ?? 0) - share.amount_minor);
        }
      }

      return {
        group,
        members: members.get(groupId) ?? [],
        expenses: groupExpenses.map((expense, index) => ({
          ...expense,
          kind: "expense",
          created_at: new Date().toISOString(),
          version: 1,
          client_request_id: `demo_expense_req_${index + 1}`,
        })),
        balances: Array.from(balances.entries()).map(([memberId, amount_minor]) => ({
          memberId,
          balance: { amount_minor, currency: group.currency },
        })),
      };
    },
    async updateGroup(groupId: string, payload: UpdateGroupRequest) {
      const group = groups.get(groupId);
      if (!group) {
        throw new Error("Group not found");
      }

      const updatedGroup = { ...group, name: payload.name };
      groups.set(groupId, updatedGroup);
      return { group: updatedGroup };
    },
    async createVirtualMember(groupId: string, payload: CreateVirtualMemberRequest) {
      const group = groups.get(groupId);
      if (!group) {
        throw new Error("Group not found");
      }

      const member = {
        id: `demo_virtual_${groupId}_${(members.get(groupId)?.length ?? 0) + 1}`,
        group_id: groupId,
        user_id: null,
        display_name: payload.display_name,
        role: "member" as const,
        status: "active" as const,
      };
      members.set(groupId, [...(members.get(groupId) ?? []), member]);
      return { member };
    },
    async archiveGroup(groupId: string, _payload: { client_request_id: string }) {
      const group = groups.get(groupId);
      if (!group) {
        throw new Error("Group not found");
      }
      groups.delete(groupId);
      members.delete(groupId);
      return { group };
    },
    async deleteGroup(groupId: string, _payload: { client_request_id: string }) {
      const group = groups.get(groupId);
      if (!group) {
        throw new Error("Group not found");
      }
      groups.delete(groupId);
      members.delete(groupId);
      return { group };
    },
    async createInvite(groupId: string, payload: CreateInviteRequest) {
      const groupMembers = members.get(groupId) ?? [];
      if (groupMembers.length === 1) {
        groupMembers.push({
          id: `demo_member_${groupId.slice(-1)}_2`,
          group_id: groupId,
          user_id: null,
          display_name: "Demo 夥伴",
          role: "member",
          status: "active",
        });
        members.set(groupId, groupMembers);
      }
      const token = `EQO${groupId.slice(-1).toUpperCase()}${payload.max_uses}TWD`;
      inviteTokens.set(token, groupId);

      return {
        invite: {
          token,
          max_uses: payload.max_uses,
        },
      };
    },
    async acceptInvite(token: string, payload: AcceptInviteRequest) {
      const groupId = inviteTokens.get(token);
      const group = groupId ? groups.get(groupId) : undefined;

      if (!groupId || !group) {
        throw new Error("Invite is expired, revoked, or unavailable.");
      }

      const member = {
        id: `demo_joined_${members.get(groupId)?.length ?? 0}_${payload.display_name}`,
        group_id: groupId,
        user_id: "demo-guest",
        display_name: payload.display_name,
        role: "member" as const,
        status: "active" as const,
      };
      members.set(groupId, [...(members.get(groupId) ?? []), member]);

      return { group, member, claimed: false };
    },
    async createExpense(groupId: string, payload: CreateExpenseRequest) {
      const expense = {
        id: `demo_expense_${expenses.length + 1}`,
        group_id: groupId,
        title: payload.title,
        kind: payload.kind,
        category: payload.category,
        amount_minor: payload.amount_minor,
        currency: payload.currency,
        expense_date: payload.expense_date,
        expense_payments: payload.expense_payments,
        expense_shares: payload.expense_shares,
      };
      expenses.push(expense);
      return { expense };
    },
    async calculateSettlement(groupId: string) {
      const detail = await this.getGroupDetail(groupId);
      const groupExpenses = expenses.filter((expense) => expense.group_id === groupId);
      const transfers = calculateSettlementTransfers(detail.balances);

      return {
        settlement: {
          id: `demo_settlement_${groupExpenses.length}`,
          settlement_version: groupExpenses.length,
          status: "draft",
        },
        transfers,
      };
    },
    async confirmSettlement(_groupId: string, settlementId: string, _payload: ConfirmSettlementRequest) {
      return {
        settlement: {
          id: settlementId,
          status: "confirmed",
        },
      };
    },
  };
}
