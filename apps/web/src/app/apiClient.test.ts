import { describe, expect, test } from "vitest";
import { createApiClient, createDemoApiClient } from "./apiClient";

describe("createDemoApiClient", () => {
  test("runs the MVP flow without a backend token", async () => {
    const client = createDemoApiClient();

    const group = await client.createGroup({
      client_request_id: "group_req",
      name: "Tokyo Trip",
      currency: "TWD",
    });
    const invite = await client.createInvite(group.group.id, {
      client_request_id: "invite_req",
      max_uses: 3,
    });
    const expense = await client.createExpense(group.group.id, {
      client_request_id: "expense_req",
      title: "Dinner",
      kind: "expense",
      category: "food",
      amount_minor: 120000,
      currency: "TWD",
      expense_date: "2026-06-30",
      expense_payments: [
        {
          payer_member_id: group.group.owner_member_id,
          amount_minor: 120000,
          currency: "TWD",
        },
      ],
      expense_shares: [
        {
          member_id: group.group.owner_member_id,
          share_type: "fixed",
          amount_minor: 120000,
        },
      ],
    });
    const settlement = await client.calculateSettlement(group.group.id);

    expect(group.group.name).toBe("Tokyo Trip");
    expect(invite.invite.token).toMatch(/^EQO/);
    expect(expense.expense.title).toBe("Dinner");
    expect(settlement.settlement.status).toBe("draft");
  });

  test("adds a demo member after creating an invite so split controls can be exercised", async () => {
    const client = createDemoApiClient();
    const group = await client.createGroup({
      client_request_id: "group_req",
      name: "Tokyo Trip",
      currency: "TWD",
    });

    await client.createInvite(group.group.id, {
      client_request_id: "invite_req",
      max_uses: 3,
    });

    await expect(client.getGroupDetail(group.group.id)).resolves.toMatchObject({
      members: [
        { display_name: "Demo", role: "owner" },
        { display_name: "Demo 夥伴", role: "member" },
      ],
    });
  });

  test("updates a demo group and creates a virtual member", async () => {
    const client = createDemoApiClient();
    const group = await client.createGroup({
      client_request_id: "group_req",
      name: "Tokyo Trip",
      currency: "TWD",
    });

    await expect(
      client.updateGroup(group.group.id, {
        client_request_id: "group_update_req",
        name: "Osaka Trip",
      }),
    ).resolves.toMatchObject({
      group: { name: "Osaka Trip" },
    });

    await expect(
      client.createVirtualMember(group.group.id, {
        client_request_id: "member_req",
        display_name: "Bob",
      }),
    ).resolves.toMatchObject({
      member: { display_name: "Bob", user_id: null },
    });

    await expect(client.getGroupDetail(group.group.id)).resolves.toMatchObject({
      group: { name: "Osaka Trip" },
      members: [{ display_name: "Demo" }, { display_name: "Bob" }],
    });
  });

  test("archives and deletes demo groups", async () => {
    const client = createDemoApiClient();
    const archiveGroup = await client.createGroup({
      client_request_id: "group_archive_req",
      name: "Archive Trip",
      currency: "TWD",
    });
    const deleteGroup = await client.createGroup({
      client_request_id: "group_delete_req",
      name: "Delete Trip",
      currency: "TWD",
    });

    await expect(
      client.archiveGroup(archiveGroup.group.id, { client_request_id: "archive_req" }),
    ).resolves.toMatchObject({
      group: { name: "Archive Trip" },
    });
    await expect(
      client.deleteGroup(deleteGroup.group.id, { client_request_id: "delete_req" }),
    ).resolves.toMatchObject({
      group: { name: "Delete Trip" },
    });
    await expect(client.listGroups()).resolves.toMatchObject({ groups: [] });
  });

  test("calculates demo balances from payments and selected shares", async () => {
    const client = createDemoApiClient();
    const group = await client.createGroup({
      client_request_id: "group_req",
      name: "Tokyo Trip",
      currency: "TWD",
    });
    await client.createInvite(group.group.id, {
      client_request_id: "invite_req",
      max_uses: 3,
    });
    const detail = await client.getGroupDetail(group.group.id);

    await client.createExpense(group.group.id, {
      client_request_id: "expense_req",
      title: "Lunch",
      kind: "expense",
      category: "food",
      amount_minor: 100000,
      currency: "TWD",
      expense_date: "2026-07-01",
      expense_payments: [
        {
          payer_member_id: group.group.owner_member_id,
          amount_minor: 100000,
          currency: "TWD",
        },
      ],
      expense_shares: detail.members.map((member) => ({
        member_id: member.id,
        share_type: "fixed",
        amount_minor: 50000,
      })),
    });

    await expect(client.getGroupDetail(group.group.id)).resolves.toMatchObject({
      balances: [
        { memberId: group.group.owner_member_id, balance: { amount_minor: 50000 } },
        { memberId: detail.members[1].id, balance: { amount_minor: -50000 } },
      ],
    });
  });

  test("returns demo settlement transfers from current balances", async () => {
    const client = createDemoApiClient();
    const group = await client.createGroup({
      client_request_id: "group_req",
      name: "Tokyo Trip",
      currency: "TWD",
    });
    await client.createInvite(group.group.id, {
      client_request_id: "invite_req",
      max_uses: 3,
    });
    const detail = await client.getGroupDetail(group.group.id);

    await client.createExpense(group.group.id, {
      client_request_id: "expense_req",
      title: "Coffee",
      kind: "expense",
      category: "food",
      amount_minor: 50000,
      currency: "TWD",
      expense_date: "2026-07-01",
      expense_payments: [
        {
          payer_member_id: group.group.owner_member_id,
          amount_minor: 50000,
          currency: "TWD",
        },
      ],
      expense_shares: detail.members.map((member) => ({
        member_id: member.id,
        share_type: "fixed",
        amount_minor: 25000,
      })),
    });

    await expect(client.calculateSettlement(group.group.id)).resolves.toMatchObject({
      transfers: [
        {
          fromMemberId: detail.members[1].id,
          toMemberId: group.group.owner_member_id,
          amount: { amount_minor: 25000, currency: "TWD" },
        },
      ],
    });
  });

  test("accepts a demo invite token into the invited group", async () => {
    const client = createDemoApiClient();
    const group = await client.createGroup({
      client_request_id: "group_req",
      name: "Tokyo Trip",
      currency: "TWD",
    });
    const invite = await client.createInvite(group.group.id, {
      client_request_id: "invite_req",
      max_uses: 3,
    });

    await expect(
      client.acceptInvite(invite.invite.token, {
        client_request_id: "accept_req",
        display_name: "Guest",
      }),
    ).resolves.toMatchObject({
      group: { id: group.group.id, name: "Tokyo Trip" },
      member: { display_name: "Guest", role: "member" },
    });
  });
});

describe("createApiClient", () => {
  test("uses same-origin credentials and omits Authorization when no token is present", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createApiClient({
      authToken: "",
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return {
          ok: true,
          async json() {
            return { group: { id: "group_1", name: "Cookie Trip", currency: "TWD", owner_member_id: "member_1" } };
          },
        } as Response;
      },
    });

    await client.createGroup({
      client_request_id: "group_req",
      name: "Cookie Trip",
      currency: "TWD",
    });

    expect(calls[0].init.credentials).toBe("same-origin");
    expect(calls[0].init.headers).not.toMatchObject({ Authorization: expect.any(String) });
  });

  test("loads groups from the backend", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createApiClient({
      authToken: "session-token",
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return {
          ok: true,
          async json() {
            return {
              groups: [{ id: "group_1", name: "Tokyo Trip", currency: "TWD", owner_member_id: "member_1" }],
            };
          },
        } as Response;
      },
    });

    await expect(client.listGroups()).resolves.toMatchObject({
      groups: [{ id: "group_1", name: "Tokyo Trip" }],
    });

    expect(calls[0].url).toBe("/api/v1/groups");
    expect(calls[0].init.method).toBe("GET");
    expect(calls[0].init.headers).toMatchObject({ Authorization: "Bearer session-token" });
  });

  test("loads a group detail from the backend", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createApiClient({
      authToken: "session-token",
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return {
          ok: true,
          async json() {
            return {
              group: { id: "group_1", name: "Tokyo Trip", currency: "TWD", owner_member_id: "member_1" },
              members: [],
              expenses: [],
              balances: [],
            };
          },
        } as Response;
      },
    });

    await expect(client.getGroupDetail("group_1")).resolves.toMatchObject({
      group: { id: "group_1" },
    });

    expect(calls[0].url).toBe("/api/v1/groups/group_1");
    expect(calls[0].init.method).toBe("GET");
  });

  test("accepts an invite through the backend", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createApiClient({
      authToken: "session-token",
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return {
          ok: true,
          async json() {
            return {
              group: { id: "group_1", name: "Tokyo Trip", currency: "TWD", owner_member_id: "member_1" },
              member: {
                id: "member_2",
                group_id: "group_1",
                user_id: "user_2",
                display_name: "Guest",
                role: "member",
                status: "active",
              },
              claimed: false,
            };
          },
        } as Response;
      },
    });

    await expect(
      client.acceptInvite("EQO123", {
        client_request_id: "accept_req",
        display_name: "Guest",
      }),
    ).resolves.toMatchObject({
      group: { id: "group_1" },
      member: { display_name: "Guest" },
    });

    expect(calls[0].url).toBe("/api/v1/invites/EQO123/accept");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe(JSON.stringify({ client_request_id: "accept_req", display_name: "Guest" }));
  });

  test("exchanges a Google ID token for an Equo session", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const client = createApiClient({
      authToken: "",
      fetcher: async (url, init) => {
        calls.push({ url: String(url), init: init ?? {} });
        return {
          ok: true,
          async json() {
            return {
              session: {
                token: "equo-session",
                expires_at: "2026-07-07T00:00:00.000Z",
                user: {
                  id: "user_1",
                  email: "alice@example.com",
                  display_name: "Alice",
                },
              },
            };
          },
        } as Response;
      },
    });

    await expect(client.exchangeGoogleToken("google-id-token")).resolves.toMatchObject({
      session: { token: "equo-session" },
    });

    expect(calls[0].url).toBe("/api/v1/auth/google");
    expect(calls[0].init.method).toBe("POST");
    expect(calls[0].init.body).toBe(JSON.stringify({ id_token: "google-id-token" }));
  });
});
