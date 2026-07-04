import { describe, expect, test } from "vitest";
import type { GroupRepository } from "../repositories/groupRepository.js";
import {
  handleAcceptInvite,
  handleArchiveGroup,
  handleCreateGroup,
  handleCreateInvite,
  handleCreateVirtualMember,
  handleDeleteGroup,
  handleGetGroupDetail,
  handleListArchivedGroups,
  handleListGroups,
  handleUnarchiveGroup,
  handleUpdateGroup,
} from "./groups.js";

const context = {
  user: {
    id: "user_alice",
    google_sub: "google-alice",
    email: "alice@example.com",
    display_name: "Alice",
  },
};

function makeRepository(overrides: Partial<GroupRepository> = {}): GroupRepository {
  return {
    async listGroups() {
      return [{ id: "group_1", name: "Tokyo Trip", currency: "TWD", owner_member_id: "member_owner" }];
    },
    async listArchivedGroups() {
      return [
        {
          id: "group_2",
          name: "Osaka Trip",
          currency: "TWD",
          owner_member_id: "member_owner",
          archived_at: "2026-07-01T00:00:00.000Z",
        },
      ];
    },
    async listMembers() {
      return [
        {
          id: "member_owner",
          group_id: "group_1",
          user_id: "user_alice",
          display_name: "Alice",
          role: "owner",
          status: "active",
        },
      ];
    },
    async createGroup() {
      return {
        group: { id: "group_1", name: "?曹漪??", currency: "TWD", owner_member_id: "member_owner" },
        ownerMember: {
          id: "member_owner",
          group_id: "group_1",
          user_id: "user_alice",
          display_name: "Alice",
          role: "owner",
          status: "active",
        },
      };
    },
    async updateGroup(groupId, request) {
      return { id: groupId, name: request.name, currency: "TWD", owner_member_id: "member_owner" };
    },
    async archiveGroup(groupId) {
      return { id: groupId, name: "Tokyo Trip", currency: "TWD", owner_member_id: "member_owner" };
    },
    async unarchiveGroup(groupId) {
      return { id: groupId, name: "Osaka Trip", currency: "TWD", owner_member_id: "member_owner" };
    },
    async deleteGroup(groupId) {
      return { id: groupId, name: "Tokyo Trip", currency: "TWD", owner_member_id: "member_owner" };
    },
    async createVirtualMember(groupId, displayName) {
      return {
        id: "member_virtual",
        group_id: groupId,
        user_id: null,
        display_name: displayName,
        role: "member",
        status: "active",
      };
    },
    async findActiveMember() {
      return {
        id: "member_owner",
        group_id: "group_1",
        user_id: "user_alice",
        display_name: "Alice",
        role: "owner",
        status: "active",
      };
    },
    async createInvite() {
      return {
        id: "invite_1",
        group_id: "group_1",
        token_hash: "hashed_token",
        token: "EQO7TWD",
        max_uses: 5,
        use_count: 0,
      };
    },
    async acceptInvite() {
      return {
        group: { id: "group_1", name: "?曹漪??", currency: "TWD", owner_member_id: "member_owner" },
        member: {
          id: "member_virtual",
          group_id: "group_1",
          user_id: "user_alice",
          display_name: "Alice",
          role: "member",
          status: "active",
        },
        claimed: true,
      };
    },
    async hashInviteToken() {
      return "hashed_token";
    },
    async findInviteByTokenHash() {
      return {
        id: "invite_1",
        group_id: "group_1",
        token_hash: "hashed_token",
        max_uses: 5,
        use_count: 0,
      };
    },
    async recordClientRequest() {},
    ...overrides,
  };
}

const expenseRepository = {
  async createExpense() {
    throw new Error("not used");
  },
  async listExpenses() {
    return [
      {
        id: "expense_1",
        group_id: "group_1",
        title: "Dinner",
        kind: "expense",
        amount_minor: 120000,
        currency: "TWD",
        note: "Split unevenly, Bob paid",
        transfer_to_member_id: null,
        version: 1,
        client_request_id: "expense_req",
        expense_payments: [{ payer_member_id: "member_bob", amount_minor: 120000, currency: "TWD" }],
        expense_shares: [
          { member_id: "member_owner", share_type: "fixed", amount_minor: 80000 },
          { member_id: "member_carol", share_type: "fixed", amount_minor: 40000 },
        ],
      },
    ];
  },
  async softDeleteExpense() {
    throw new Error("not used");
  },
  async recordClientRequest() {},
};

const settlementRepository = {
  async listBalances() {
    return [{ memberId: "member_owner", balance: { amount_minor: 120000, currency: "TWD" as const } }];
  },
  async calculateCurrentSettlement() {
    throw new Error("not used");
  },
  async confirmSettlement() {
    throw new Error("not used");
  },
};

describe("group handlers", () => {
  test("creates a group with an owner member", async () => {
    const result = await handleCreateGroup(makeRepository(), context, {
      client_request_id: "req_group",
      name: "?曹漪??",
      currency: "TWD",
    });

    expect(result.status).toBe(201);
    expect(result.ok && result.body).toMatchObject({
      group: { id: "group_1" },
      owner_member: { role: "owner" },
    });
  });

  test("lists groups for the current user", async () => {
    const result = await handleListGroups(makeRepository(), context);

    expect(result.status).toBe(200);
    expect(result.ok && result.body).toMatchObject({
      groups: [{ id: "group_1", name: "Tokyo Trip" }],
    });
  });

  test("lists archived groups for the current user", async () => {
    const result = await handleListArchivedGroups(makeRepository(), context);

    expect(result.status).toBe(200);
    expect(result.ok && result.body).toMatchObject({
      groups: [{ id: "group_2", name: "Osaka Trip", archived_at: "2026-07-01T00:00:00.000Z" }],
    });
  });

  test("returns group detail with members, expenses, and balances", async () => {
    const result = await handleGetGroupDetail(
      makeRepository(),
      expenseRepository,
      settlementRepository,
      context,
      "group_1",
    );

    expect(result.status).toBe(200);
    expect(result.ok && result.body).toMatchObject({
      group: { id: "group_1" },
      members: [{ id: "member_owner" }],
      expenses: [
        {
          id: "expense_1",
          title: "Dinner",
          note: "Split unevenly, Bob paid",
          transfer_to_member_id: null,
          expense_payments: [{ payer_member_id: "member_bob", amount_minor: 120000, currency: "TWD" }],
          expense_shares: [
            { member_id: "member_owner", share_type: "fixed", amount_minor: 80000 },
            { member_id: "member_carol", share_type: "fixed", amount_minor: 40000 },
          ],
        },
      ],
      balances: [{ memberId: "member_owner" }],
    });
    // The payer (member_bob) is excluded from expense_shares while still present in expense_payments.
    const expense = result.ok ? (result.body as { expenses: Array<{ expense_shares: Array<{ member_id: string }> }> }).expenses[0] : undefined;
    expect(expense?.expense_shares.some((share) => share.member_id === "member_bob")).toBe(false);
  });

  test("updates a group after membership check", async () => {
    const result = await handleUpdateGroup(makeRepository(), context, "group_1", {
      client_request_id: "req_update_group",
      name: "Osaka Trip",
    });

    expect(result.status).toBe(200);
    expect(result.ok && result.body).toMatchObject({
      group: { id: "group_1", name: "Osaka Trip" },
    });
  });

  test("creates a virtual member after membership check", async () => {
    const result = await handleCreateVirtualMember(makeRepository(), context, "group_1", {
      client_request_id: "req_virtual_member",
      display_name: "Bob",
    });

    expect(result.status).toBe(201);
    expect(result.ok && result.body).toMatchObject({
      member: { display_name: "Bob", user_id: null },
    });
  });

  test("archives and deletes a group after membership check", async () => {
    const archiveResult = await handleArchiveGroup(makeRepository(), context, "group_1", "req_archive");
    const deleteResult = await handleDeleteGroup(makeRepository(), context, "group_1", "req_delete");

    expect(archiveResult.status).toBe(200);
    expect(deleteResult.status).toBe(200);
    expect(archiveResult.ok && archiveResult.body).toMatchObject({ group: { id: "group_1" } });
    expect(deleteResult.ok && deleteResult.body).toMatchObject({ group: { id: "group_1" } });
  });

  test("unarchives a group after membership check", async () => {
    const result = await handleUnarchiveGroup(makeRepository(), context, "group_2", "req_unarchive");

    expect(result.status).toBe(200);
    expect(result.ok && result.body).toMatchObject({ group: { id: "group_2", name: "Osaka Trip" } });
  });

  test("rejects unarchive when user is not a group member", async () => {
    const result = await handleUnarchiveGroup(
      makeRepository({ findActiveMember: async () => null }),
      context,
      "group_2",
      "req_unarchive",
    );

    expect(result.status).toBe(403);
    expect(!result.ok && result.body.error.code).toBe("FORBIDDEN");
  });

  test("rejects invite creation when user is not a group member", async () => {
    const result = await handleCreateInvite(
      makeRepository({ findActiveMember: async () => null }),
      context,
      "group_1",
      { client_request_id: "req_invite", max_uses: 5 },
    );

    expect(result.status).toBe(403);
    expect(!result.ok && result.body.error.code).toBe("FORBIDDEN");
  });

  test("accepts invite and claims a virtual member", async () => {
    const result = await handleAcceptInvite(makeRepository(), context, "EQO7TWD", {
      client_request_id: "req_accept",
      display_name: "Alice",
      claim_member_id: "member_virtual",
    });

    expect(result.status).toBe(200);
    expect(result.ok && result.body).toMatchObject({
      member: { id: "member_virtual" },
      claimed: true,
    });
  });
});
