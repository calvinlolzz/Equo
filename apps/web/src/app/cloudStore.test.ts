import { describe, expect, test, vi } from "vitest";
import type { BalanceSummary, ExpenseSummary, GroupDetail, GroupMemberSummary } from "./apiClient";
import type { ApiClientLike } from "./cloudStore";
import { createCloudGroupsStore } from "./cloudStore";
import { clearCloudCache, loadCloudCache, saveCloudCache, type CacheStorage } from "./cloudCache";
import type { ExpenseDraft } from "./ExpenseComposerSheet";

function memoryStorage(): CacheStorage {
  const values = new Map<string, string>();

  return {
    getItem(key: string) {
      return values.get(key) ?? null;
    },
    setItem(key: string, value: string) {
      values.set(key, value);
    },
    removeItem(key: string) {
      values.delete(key);
    },
  };
}

const group1 = { id: "group_1", name: "Tokyo Trip", currency: "TWD", owner_member_id: "member_1" };
const member1 = {
  id: "member_1",
  group_id: "group_1",
  user_id: "user_1",
  display_name: "Alice",
  role: "owner" as const,
  status: "active" as const,
};

/** Fills in the get_group_detail v3 aggregate fields (expense_count/spend_total_minor/spend_by_day/member_day_shares) so fixtures only need to spell out what they actually vary. */
function makeGroupDetail(overrides: {
  group?: typeof group1 & { kind?: "shared" | "personal" };
  members?: GroupMemberSummary[];
  expenses?: ExpenseSummary[];
  balances?: BalanceSummary[];
  expense_count?: number;
  spend_total_minor?: number;
  spend_by_day?: GroupDetail["spend_by_day"];
  spend_by_category?: GroupDetail["spend_by_category"];
  member_day_shares?: GroupDetail["member_day_shares"];
}): GroupDetail {
  return {
    group: overrides.group ?? group1,
    members: overrides.members ?? [member1],
    expenses: overrides.expenses ?? [],
    balances: overrides.balances ?? [],
    expense_count: overrides.expense_count ?? (overrides.expenses?.length ?? 0),
    spend_total_minor: overrides.spend_total_minor ?? 0,
    spend_by_day: overrides.spend_by_day ?? [],
    spend_by_category: overrides.spend_by_category ?? [],
    member_day_shares: overrides.member_day_shares ?? [],
  };
}

function makeFakeApiClient(overrides: Partial<ApiClientLike> = {}): ApiClientLike {
  return {
    createGroup: vi.fn(async () => ({ group: group1, owner_member: member1 })),
    listGroups: vi.fn(async () => ({ groups: [group1] })),
    listArchivedGroups: vi.fn(async () => ({ groups: [] })),
    getGroupDetail: vi.fn(async () => makeGroupDetail({ members: [member1] })),
    listExpensesPage: vi.fn(async () => ({ expenses: [] })),
    updateGroup: vi.fn(async () => ({ group: group1 })),
    createVirtualMember: vi.fn(async () => ({
      member: { id: "member_2", group_id: "group_1", user_id: null, display_name: "Bob", role: "member" as const, status: "active" as const },
    })),
    renameGroupMember: vi.fn(async () => ({
      member: { id: "member_2", group_id: "group_1", user_id: null, display_name: "Bobby", role: "member" as const, status: "active" as const },
    })),
    removeGroupMember: vi.fn(async () => ({
      member: { id: "member_2", group_id: "group_1", user_id: null, display_name: "Bob", role: "member" as const, status: "removed" as const },
    })),
    archiveGroup: vi.fn(async () => ({ group: group1 })),
    unarchiveGroup: vi.fn(async () => ({ group: group1 })),
    deleteGroup: vi.fn(async () => ({ group: group1 })),
    createInvite: vi.fn(async () => ({ invite: { token: "INVITE123", max_uses: 10 } })),
    acceptInvite: vi.fn(async () => ({ group: group1, member: member1, claimed: false })),
    createExpense: vi.fn(async () => ({ expense: { id: "expense_1", title: "Dinner", amount_minor: 1000, currency: "TWD" } })),
    replaceExpense: vi.fn(async () => ({
      expense: { id: "expense_2", title: "Lunch", amount_minor: 1000, currency: "TWD" },
    })),
    deleteExpense: vi.fn(async () => ({ expense: { id: "expense_1" } })),
    uploadGroupImage: vi.fn(async () => ({ image: { url: "https://cdn.equo.local/image.jpg" } })),
    searchExpenses: vi.fn(async () => ({ expenses: [], match_count: 0, match_total_minor: 0, has_more: false })),
    ...overrides,
  } as ApiClientLike;
}

const baseDraft: ExpenseDraft = {
  title: "Lunch",
  amountMinor: 1000,
  createdAt: "2026-07-04T10:00:00.000Z",
  payerId: "member_1",
  shareMemberIds: ["member_1"],
  category: "food",
};

describe("createCloudGroupsStore", () => {
  test("refreshGroups populates state.groups from the api client", async () => {
    const apiClient = makeFakeApiClient();
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });

    await store.refreshGroups();

    expect(store.getState().groups).toEqual([{ id: "group_1", name: "Tokyo Trip", currency: "TWD", coverImageUrl: undefined }]);
    expect(store.getState().groupsSyncAttempted).toBe(true);
  });

  test("refreshGroupDetail populates the per-group cache with adapted data", async () => {
    const apiClient = makeFakeApiClient();
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });

    const data = await store.refreshGroupDetail("group_1");

    expect(data.group).toEqual({ id: "group_1", name: "Tokyo Trip", currency: "TWD", coverImageUrl: undefined });
    expect(data.members).toEqual([{ id: "member_1", name: "Alice", role: "owner", virtual: false, userId: "user_1" }]);
    expect(store.getState().groupDetails.group_1).toBe(data);
    expect(store.getState().loadingGroupIds.group_1).toBeUndefined();
  });

  // [MV]
  test("refreshGroupDetail inherits kind and monthlyBudgetMinor from the list entry when the detail omits both", async () => {
    // get_group_detail carries neither field (see the plan's §0) - the fake
    // getGroupDetail below returns the bare group1 fixture, same as every
    // other test here, so this only passes if refreshGroupDetail itself
    // reaches into state.groups for what the detail didn't say.
    const listGroup = { ...group1, kind: "personal" as const, monthly_budget_minor: 500000 };
    const apiClient = makeFakeApiClient({ listGroups: vi.fn(async () => ({ groups: [listGroup] })) });
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
    await store.refreshGroups();

    const data = await store.refreshGroupDetail("group_1");

    expect(data.group.kind).toBe("personal");
    expect(data.group.monthlyBudgetMinor).toBe(500000);
  });

  describe("refreshGroupDetail's background-poll window vs. auto-paged history", () => {
    /**
     * `count` rows, one day apart, newest first (index 0 = most recent) -
     * matching the server's own expense_date desc ordering, so a `.slice`
     * of this array is exactly what a capped server window would return.
     */
    function makeRows(count: number): ExpenseSummary[] {
      const base = new Date("2026-06-01T00:00:00.000Z").getTime();
      const day = 24 * 60 * 60 * 1000;
      return Array.from({ length: count }, (_, i) => {
        const iso = new Date(base - i * day).toISOString();
        return {
          id: `expense_${i}`,
          group_id: "group_1",
          title: `Row ${i}`,
          kind: "expense" as const,
          amount_minor: 100,
          currency: "TWD",
          expense_date: iso.slice(0, 10),
          created_at: iso,
          version: 1,
          client_request_id: `req_${i}`,
        };
      });
    }

    // [MV]
    test("personal ledger: 150 auto-paged rows survive a poll whose fresh window is only the newest 100", async () => {
      const rows = makeRows(150);
      const apiClient = makeFakeApiClient({
        getGroupDetail: vi.fn(async () =>
          makeGroupDetail({
            group: { ...group1, kind: "personal" as const },
            expenses: rows.slice(0, 100),
            expense_count: 150,
          }),
        ),
        listExpensesPage: vi.fn(async () => ({ expenses: rows.slice(100, 150) })),
      });
      const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
      await store.refreshGroupDetail("group_1");
      // App.tsx's auto-paging effect pulls the rest of the ledger's history
      // in past the server's own EXPENSE_WINDOW_LIMIT.
      await store.loadMoreExpenses("group_1");
      expect(store.getState().groupDetails.group_1.expenses).toHaveLength(150);

      // A ~20s background poll re-reads get_group_detail, which is capped
      // back down to the newest 100 - it knows nothing about the 50 older
      // rows auto-paging fetched.
      await store.refreshGroupDetail("group_1", { background: true });

      const expenses = store.getState().groupDetails.group_1.expenses;
      expect(expenses).toHaveLength(150);
      expect(expenses.map((expense) => expense.id)).toEqual(rows.map((row) => row.id));
    });

    // [MV]
    test("shared group: the same poll replaces the loaded window outright, dropping the auto-paged rows", async () => {
      const rows = makeRows(150);
      const apiClient = makeFakeApiClient({
        getGroupDetail: vi.fn(async () =>
          makeGroupDetail({
            group: group1,
            expenses: rows.slice(0, 100),
            expense_count: 150,
          }),
        ),
        listExpensesPage: vi.fn(async () => ({ expenses: rows.slice(100, 150) })),
      });
      const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
      await store.refreshGroupDetail("group_1");
      await store.loadMoreExpenses("group_1");
      expect(store.getState().groupDetails.group_1.expenses).toHaveLength(150);

      await store.refreshGroupDetail("group_1", { background: true });

      expect(store.getState().groupDetails.group_1.expenses).toHaveLength(100);
    });
  });

  test("createGroup applies the response locally with no follow-up fetch", async () => {
    const apiClient = makeFakeApiClient();
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });

    const group = await store.createGroup({ name: "Tokyo Trip", currency: "TWD" });

    expect(group).toEqual({ id: "group_1", name: "Tokyo Trip", currency: "TWD", coverImageUrl: undefined });
    expect(apiClient.createGroup).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Tokyo Trip", currency: "TWD", client_request_id: expect.any(String) }),
    );
    expect(apiClient.listGroups).not.toHaveBeenCalled();
    expect(apiClient.getGroupDetail).not.toHaveBeenCalled();
    expect(store.getState().groups).toEqual([{ id: "group_1", name: "Tokyo Trip", currency: "TWD", coverImageUrl: undefined }]);
    expect(store.getState().groupDetails.group_1).toEqual({
      group: { id: "group_1", name: "Tokyo Trip", currency: "TWD", coverImageUrl: undefined },
      members: [{ id: "member_1", name: "Alice", role: "owner", virtual: false, userId: "user_1" }],
      expenses: [],
      balances: [{ memberId: "member_1", balance: { amount_minor: 0, currency: "TWD" } }],
      aggregates: { expenseCount: 0, spendTotalMinor: 0, spendByDay: [], spendByCategory: [], memberDayShares: [] },
    });
  });

  test("createGroup inserts the new group at the head of an existing list", async () => {
    const existingGroup = { id: "group_0", name: "Old Trip", currency: "TWD", owner_member_id: "member_0" };
    const apiClient = makeFakeApiClient({ listGroups: vi.fn(async () => ({ groups: [existingGroup] })) });
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
    await store.refreshGroups();

    await store.createGroup({ name: "Tokyo Trip", currency: "TWD" });

    expect(store.getState().groups.map((group) => group.id)).toEqual(["group_1", "group_0"]);
  });

  test("renameGroup patches the group list entry and detail cache locally, no refetch", async () => {
    const apiClient = makeFakeApiClient({ updateGroup: vi.fn(async () => ({ group: { ...group1, name: "Osaka Trip" } })) });
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
    await store.refreshGroups();
    await store.refreshGroupDetail("group_1");

    await store.renameGroup("group_1", "Osaka Trip");

    expect(apiClient.updateGroup).toHaveBeenCalledWith("group_1", {
      client_request_id: expect.any(String),
      name: "Osaka Trip",
    });
    expect(apiClient.listGroups).toHaveBeenCalledTimes(1);
    expect(apiClient.getGroupDetail).toHaveBeenCalledTimes(1);
    expect(store.getState().groups[0].name).toBe("Osaka Trip");
    expect(store.getState().groupDetails.group_1.group.name).toBe("Osaka Trip");
  });

  // [MV]
  test("renameGroup keeps the list entry's kind when the write response doesn't carry it", async () => {
    // updateGroup's fake response here is the bare group1 fixture (no kind) -
    // same shape as a real rename response, which never echoes kind back.
    const listGroup = { ...group1, kind: "personal" as const };
    const apiClient = makeFakeApiClient({ listGroups: vi.fn(async () => ({ groups: [listGroup] })) });
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
    await store.refreshGroups();

    await store.renameGroup("group_1", "我的帳本");

    expect(store.getState().groups[0].kind).toBe("personal");
  });

  test("addVirtualMember appends the mapped member to the cached detail, no refetch", async () => {
    const apiClient = makeFakeApiClient();
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
    await store.refreshGroupDetail("group_1");

    await store.addVirtualMember("group_1", "Bob");

    expect(apiClient.createVirtualMember).toHaveBeenCalledWith("group_1", {
      client_request_id: expect.any(String),
      display_name: "Bob",
    });
    expect(apiClient.getGroupDetail).toHaveBeenCalledTimes(1);
    expect(store.getState().groupDetails.group_1.members).toEqual([
      { id: "member_1", name: "Alice", role: "owner", virtual: false, userId: "user_1" },
      { id: "member_2", name: "Bob", role: "member", virtual: true, userId: null },
    ]);
  });

  test("renameMember patches the cached member in place, no refetch", async () => {
    const virtualMember = {
      id: "member_2",
      group_id: "group_1",
      user_id: null,
      display_name: "Bob",
      role: "member" as const,
      status: "active" as const,
    };
    const apiClient = makeFakeApiClient({
      getGroupDetail: vi.fn(async () => makeGroupDetail({ members: [member1, virtualMember] })),
    });
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
    await store.refreshGroupDetail("group_1");

    await store.renameMember("group_1", "member_2", "Bobby");

    expect(apiClient.renameGroupMember).toHaveBeenCalledWith("group_1", "member_2", {
      client_request_id: expect.any(String),
      display_name: "Bobby",
    });
    expect(apiClient.getGroupDetail).toHaveBeenCalledTimes(1);
    expect(store.getState().groupDetails.group_1.members).toEqual([
      { id: "member_1", name: "Alice", role: "owner", virtual: false, userId: "user_1" },
      { id: "member_2", name: "Bobby", role: "member", virtual: true, userId: null },
    ]);
  });

  test("removeMember drops the member from the cached detail, no refetch", async () => {
    const virtualMember = {
      id: "member_2",
      group_id: "group_1",
      user_id: null,
      display_name: "Bob",
      role: "member" as const,
      status: "active" as const,
    };
    const apiClient = makeFakeApiClient({
      getGroupDetail: vi.fn(async () => makeGroupDetail({ members: [member1, virtualMember] })),
    });
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
    await store.refreshGroupDetail("group_1");

    await store.removeMember("group_1", "member_2");

    expect(apiClient.removeGroupMember).toHaveBeenCalledWith("group_1", "member_2", {
      client_request_id: expect.any(String),
    });
    expect(apiClient.getGroupDetail).toHaveBeenCalledTimes(1);
    expect(store.getState().groupDetails.group_1.members).toEqual([
      { id: "member_1", name: "Alice", role: "owner", virtual: false, userId: "user_1" },
    ]);
  });

  test("removeMember preserves the API error code and re-syncs in the background on failure", async () => {
    const balanceError = Object.assign(new Error("Member still has an unsettled balance and cannot be removed."), {
      code: "MEMBER_HAS_BALANCE",
    });
    const apiClient = makeFakeApiClient({
      removeGroupMember: vi.fn(async () => {
        throw balanceError;
      }),
    });
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
    await store.refreshGroupDetail("group_1");
    (apiClient.getGroupDetail as ReturnType<typeof vi.fn>).mockClear();

    await expect(store.removeMember("group_1", "member_2")).rejects.toMatchObject({
      message: "Member still has an unsettled balance and cannot be removed.",
      code: "MEMBER_HAS_BALANCE",
    });

    // Cached members stay untouched and a background resync fires.
    expect(store.getState().groupDetails.group_1.members).toEqual([
      { id: "member_1", name: "Alice", role: "owner", virtual: false, userId: "user_1" },
    ]);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(apiClient.listGroups).toHaveBeenCalledTimes(1);
    expect(apiClient.getGroupDetail).toHaveBeenCalledTimes(1);
  });

  test("archiveGroup and deleteGroup remove the group from state with no refetch", async () => {
    const apiClient = makeFakeApiClient();
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
    await store.refreshGroups();
    await store.refreshGroupDetail("group_1");

    await store.archiveGroup("group_1");

    expect(apiClient.archiveGroup).toHaveBeenCalledWith("group_1", { client_request_id: expect.any(String) });
    expect(apiClient.listGroups).toHaveBeenCalledTimes(1);
    expect(store.getState().groups).toEqual([]);
    expect(store.getState().groupDetails.group_1).toBeUndefined();

    await store.refreshGroups();
    await store.refreshGroupDetail("group_1");
    await store.deleteGroup("group_1");

    expect(apiClient.deleteGroup).toHaveBeenCalledWith("group_1", { client_request_id: expect.any(String) });
    expect(store.getState().groups).toEqual([]);
    expect(store.getState().groupDetails.group_1).toBeUndefined();
  });

  test("listArchivedGroups maps cover_image_url and returns the archived list", async () => {
    const apiClient = makeFakeApiClient({
      listArchivedGroups: vi.fn(async () => ({
        groups: [
          {
            id: "group_2",
            name: "Old Trip",
            currency: "TWD",
            owner_member_id: "member_1",
            archived_at: "2026-01-01T00:00:00.000Z",
            cover_image_url: "https://cdn.equo.local/cover.jpg",
            caller_member_id: "member_1",
          },
        ],
      })),
    });
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });

    const archived = await store.listArchivedGroups();

    expect(archived).toEqual([
      {
        id: "group_2",
        name: "Old Trip",
        currency: "TWD",
        coverImageUrl: "https://cdn.equo.local/cover.jpg",
        ownerMemberId: "member_1",
        callerMemberId: "member_1",
      },
    ]);
  });

  test("unarchiveGroup inserts the returned group into state with no full list refetch", async () => {
    const apiClient = makeFakeApiClient();
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });

    const group = await store.unarchiveGroup("group_1");

    expect(group).toEqual({ id: "group_1", name: "Tokyo Trip", currency: "TWD", coverImageUrl: undefined });
    expect(apiClient.unarchiveGroup).toHaveBeenCalledWith("group_1", { client_request_id: expect.any(String) });
    expect(apiClient.listGroups).not.toHaveBeenCalled();
    expect(store.getState().groups).toEqual([{ id: "group_1", name: "Tokyo Trip", currency: "TWD", coverImageUrl: undefined }]);
  });

  test("uploadGroupImage returns the uploaded url", async () => {
    const apiClient = makeFakeApiClient();
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });

    const url = await store.uploadGroupImage("group_1", "cover", "data:image/jpeg;base64,abc");

    expect(url).toBe("https://cdn.equo.local/image.jpg");
    expect(apiClient.uploadGroupImage).toHaveBeenCalledWith("group_1", {
      client_request_id: expect.any(String),
      kind: "cover",
      data_url: "data:image/jpeg;base64,abc",
    });
  });

  test("updateGroupCover patches the group list entry and detail cache locally, no refetch", async () => {
    const apiClient = makeFakeApiClient({
      updateGroup: vi.fn(async () => ({ group: { ...group1, cover_image_url: "https://cdn.equo.local/cover.jpg" } })),
    });
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
    await store.refreshGroups();
    await store.refreshGroupDetail("group_1");

    await store.updateGroupCover("group_1", "Tokyo Trip", "https://cdn.equo.local/cover.jpg");

    expect(apiClient.updateGroup).toHaveBeenCalledWith("group_1", {
      client_request_id: expect.any(String),
      name: "Tokyo Trip",
      cover_image_url: "https://cdn.equo.local/cover.jpg",
    });
    expect(apiClient.listGroups).toHaveBeenCalledTimes(1);
    expect(apiClient.getGroupDetail).toHaveBeenCalledTimes(1);
    expect(store.getState().groups[0].coverImageUrl).toBe("https://cdn.equo.local/cover.jpg");
    expect(store.getState().groupDetails.group_1.group.coverImageUrl).toBe("https://cdn.equo.local/cover.jpg");
  });

  test("addExpense builds the expense locally from the draft + response, no refetch", async () => {
    const apiClient = makeFakeApiClient();
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
    await store.refreshGroupDetail("group_1");

    await store.addExpense("group_1", baseDraft, "TWD");

    expect(apiClient.createExpense).toHaveBeenCalledWith(
      "group_1",
      expect.objectContaining({ kind: "expense", amount_minor: 1000, currency: "TWD" }),
    );
    expect(apiClient.getGroupDetail).toHaveBeenCalledTimes(1);
    const expenses = store.getState().groupDetails.group_1.expenses;
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({
      id: "expense_1",
      title: "Dinner",
      amountMinor: 1000,
      currency: "TWD",
      payerId: "member_1",
      shareMemberIds: ["member_1"],
      kind: "expense",
      category: "food",
    });
  });

  test("addExpense prepends the new expense ahead of existing ones", async () => {
    const apiClient = makeFakeApiClient({
      getGroupDetail: vi.fn(async () =>
        makeGroupDetail({
          expenses: [
            {
              id: "expense_0",
              group_id: "group_1",
              title: "Older",
              kind: "expense",
              amount_minor: 500,
              currency: "TWD",
              expense_date: "2026-07-01",
              version: 1,
              client_request_id: "req_0",
            },
          ],
          balances: [{ memberId: "member_1", balance: { amount_minor: 0, currency: "TWD" } }],
        }),
      ),
    });
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
    await store.refreshGroupDetail("group_1");

    await store.addExpense("group_1", baseDraft, "TWD");

    const expenses = store.getState().groupDetails.group_1.expenses;
    expect(expenses.map((expense) => expense.id)).toEqual(["expense_1", "expense_0"]);
  });

  test("addExpense patches balances and aggregates for the new expense", async () => {
    const apiClient = makeFakeApiClient({
      getGroupDetail: vi.fn(async () =>
        makeGroupDetail({
          members: [member1, { id: "member_2", group_id: "group_1", user_id: null, display_name: "Bob", role: "member" as const, status: "active" as const }],
          balances: [
            { memberId: "member_1", balance: { amount_minor: 0, currency: "TWD" } },
            { memberId: "member_2", balance: { amount_minor: 0, currency: "TWD" } },
          ],
        }),
      ),
      createExpense: vi.fn(async () => ({ expense: { id: "expense_1", title: "Lunch", amount_minor: 1000, currency: "TWD" } })),
    });
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
    await store.refreshGroupDetail("group_1");

    const draft: ExpenseDraft = {
      title: "Lunch",
      amountMinor: 1000,
      createdAt: "2026-07-04T10:00:00.000Z",
      payerId: "member_1",
      shareMemberIds: ["member_1", "member_2"],
      category: "food",
    };
    await store.addExpense("group_1", draft, "TWD");

    const detail = store.getState().groupDetails.group_1;
    expect(detail.balances).toEqual(
      expect.arrayContaining([
        { memberId: "member_1", balance: { amount_minor: 500, currency: "TWD" } },
        { memberId: "member_2", balance: { amount_minor: -500, currency: "TWD" } },
      ]),
    );
    expect(detail.aggregates.expenseCount).toBe(1);
    expect(detail.aggregates.spendTotalMinor).toBe(1000);
  });

  test("the group list's balance follows the caller's own balance in the open group", async () => {
    const apiClient = makeFakeApiClient({
      getGroupDetail: vi.fn(async () =>
        makeGroupDetail({
          members: [
            member1,
            { id: "member_2", group_id: "group_1", user_id: null, display_name: "Bob", role: "member" as const, status: "active" as const },
          ],
          balances: [
            { memberId: "member_1", balance: { amount_minor: 0, currency: "TWD" } },
            { memberId: "member_2", balance: { amount_minor: 0, currency: "TWD" } },
          ],
        }),
      ),
      createExpense: vi.fn(async () => ({
        expense: { id: "expense_1", title: "Lunch", amount_minor: 1000, currency: "TWD" },
      })),
    });
    // userId is what makes "the caller's own member row" resolvable - member1
    // is user_1's row in this group.
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn(), userId: "user_1" });

    await store.refreshGroups();
    await store.refreshGroupDetail("group_1");
    expect(store.getState().groups[0].balanceMinor).toBe(0);

    await store.addExpense(
      "group_1",
      {
        title: "Lunch",
        amountMinor: 1000,
        createdAt: "2026-07-04T10:00:00.000Z",
        payerId: "member_1",
        shareMemberIds: ["member_1", "member_2"],
        category: "food",
      },
      "TWD",
    );

    // Paid 1000, owes 500 of it: the list must agree with the group screen the
    // user just came from, without waiting for the next background refresh.
    expect(store.getState().groups[0].balanceMinor).toBe(500);
  });

  test("a rename does not blank the balance and unread count the list already had", async () => {
    const apiClient = makeFakeApiClient({
      listGroups: vi.fn(async () => ({ groups: [{ ...group1, unread_count: 2, balance_minor: -4200 }] })),
      updateGroup: vi.fn(async () => ({ group: { ...group1, name: "Kyoto Trip" } })),
    });
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn(), userId: "user_1" });
    await store.refreshGroups();

    await store.renameGroup("group_1", "Kyoto Trip");

    // The write response carries neither - and a rename that reads as "your
    // debts are settled" is worse than one that is briefly out of date.
    expect(store.getState().groups[0]).toMatchObject({
      name: "Kyoto Trip",
      balanceMinor: -4200,
      unreadCount: 2,
    });
  });

  test("editExpense edits through ONE atomic request and replaces the expense in place locally", async () => {
    const apiClient = makeFakeApiClient({
      getGroupDetail: vi.fn(async () =>
        makeGroupDetail({
          expenses: [
            {
              id: "expense_1",
              group_id: "group_1",
              title: "Lunch (old)",
              kind: "expense",
              amount_minor: 800,
              currency: "TWD",
              expense_date: "2026-07-01",
              version: 1,
              client_request_id: "req_orig",
              expense_payments: [{ payer_member_id: "member_1", amount_minor: 800, currency: "TWD" }],
              expense_shares: [{ member_id: "member_1", share_type: "fixed", amount_minor: 800 }],
            },
          ],
          balances: [{ memberId: "member_1", balance: { amount_minor: 0, currency: "TWD" } }],
          spend_total_minor: 800,
        }),
      ),
    });
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
    await store.refreshGroupDetail("group_1");

    await store.editExpense("group_1", "expense_1", baseDraft, "TWD");

    // An edit used to be DELETE then POST from here - two requests with no
    // transaction between them, so a create that failed after the delete landed
    // destroyed the entry outright. It is now a single PUT that the database
    // runs as one transaction (replace_expense).
    expect(apiClient.replaceExpense).toHaveBeenCalledWith(
      "group_1",
      "expense_1",
      expect.objectContaining({ client_request_id: expect.any(String) }),
    );
    expect(apiClient.deleteExpense).not.toHaveBeenCalled();
    expect(apiClient.getGroupDetail).toHaveBeenCalledTimes(1);

    const detail = store.getState().groupDetails.group_1;
    expect(detail.expenses).toHaveLength(1);
    expect(detail.expenses[0].id).toBe("expense_2");
    expect(detail.expenses[0].title).toBe("Lunch");
    // The old 800-minor expense's balance/aggregate contribution is removed
    // and the new 1000-minor one applied - net effect is the new expense's
    // own contribution (member_1 is the sole payer and share member here).
    expect(detail.balances).toEqual([{ memberId: "member_1", balance: { amount_minor: 0, currency: "TWD" } }]);
    expect(detail.aggregates.expenseCount).toBe(1);
    expect(detail.aggregates.spendTotalMinor).toBe(1000);
  });

  test("editExpense leaves the original expense intact when the edit fails", async () => {
    const apiClient = makeFakeApiClient({
      getGroupDetail: vi.fn(async () =>
        makeGroupDetail({
          expenses: [
            {
              id: "expense_1",
              group_id: "group_1",
              title: "Lunch (old)",
              kind: "expense",
              amount_minor: 800,
              currency: "TWD",
              expense_date: "2026-07-01",
              version: 1,
              client_request_id: "req_orig",
              expense_payments: [{ payer_member_id: "member_1", amount_minor: 800, currency: "TWD" }],
              expense_shares: [{ member_id: "member_1", share_type: "fixed", amount_minor: 800 }],
            },
          ],
          balances: [{ memberId: "member_1", balance: { amount_minor: 0, currency: "TWD" } }],
          spend_total_minor: 800,
        }),
      ),
      replaceExpense: vi.fn(async () => {
        throw new Error("network down");
      }),
    });
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
    await store.refreshGroupDetail("group_1");

    await expect(store.editExpense("group_1", "expense_1", baseDraft, "TWD")).rejects.toThrow("network down");

    // The whole point of the single atomic request: a failed edit must not have
    // taken the original entry with it. The cached copy still holds it, and the
    // server's copy was never deleted.
    const detail = store.getState().groupDetails.group_1;
    expect(detail.expenses).toHaveLength(1);
    expect(detail.expenses[0].id).toBe("expense_1");
    expect(detail.aggregates.spendTotalMinor).toBe(800);
  });

  test("deleteExpense removes the expense from the cached detail and reverses its balance/aggregate contribution, no refetch", async () => {
    const apiClient = makeFakeApiClient({
      getGroupDetail: vi.fn(async () =>
        makeGroupDetail({
          expenses: [
            {
              id: "expense_1",
              group_id: "group_1",
              title: "Lunch",
              kind: "expense",
              amount_minor: 1000,
              currency: "TWD",
              expense_date: "2026-07-01",
              version: 1,
              client_request_id: "req_1",
              expense_payments: [{ payer_member_id: "member_1", amount_minor: 1000, currency: "TWD" }],
              expense_shares: [{ member_id: "member_1", share_type: "fixed", amount_minor: 1000 }],
            },
          ],
          balances: [{ memberId: "member_1", balance: { amount_minor: 0, currency: "TWD" } }],
          expense_count: 1,
          spend_total_minor: 1000,
        }),
      ),
    });
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
    await store.refreshGroupDetail("group_1");

    await store.deleteExpense("group_1", "expense_1");

    expect(apiClient.deleteExpense).toHaveBeenCalledWith("group_1", "expense_1", {
      client_request_id: expect.any(String),
    });
    expect(apiClient.getGroupDetail).toHaveBeenCalledTimes(1);
    const detail = store.getState().groupDetails.group_1;
    expect(detail.expenses).toEqual([]);
    expect(detail.balances).toEqual([{ memberId: "member_1", balance: { amount_minor: 0, currency: "TWD" } }]);
    expect(detail.aggregates.expenseCount).toBe(0);
    expect(detail.aggregates.spendTotalMinor).toBe(0);
  });

  test("settleTransfer creates a transfer-kind expense and prepends the settlement locally, no refetch", async () => {
    const member2 = { id: "member_2", group_id: "group_1", user_id: "user_2", display_name: "Bob", role: "member" as const, status: "active" as const };
    const apiClient = makeFakeApiClient({
      getGroupDetail: vi.fn(async () =>
        makeGroupDetail({
          members: [member1, member2],
          balances: [
            { memberId: "member_1", balance: { amount_minor: -500, currency: "TWD" } },
            { memberId: "member_2", balance: { amount_minor: 500, currency: "TWD" } },
          ],
        }),
      ),
      createExpense: vi.fn(async () => ({ expense: { id: "expense_settle_1", title: "Settle up", amount_minor: 500, currency: "TWD" } })),
    });
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
    await store.refreshGroupDetail("group_1");

    await store.settleTransfer("group_1", "member_1", "member_2", 500, "TWD");

    expect(apiClient.createExpense).toHaveBeenCalledWith(
      "group_1",
      expect.objectContaining({ kind: "transfer", transfer_to_member_id: "member_2", amount_minor: 500 }),
    );
    expect(apiClient.getGroupDetail).toHaveBeenCalledTimes(1);
    const detail = store.getState().groupDetails.group_1;
    expect(detail.expenses).toHaveLength(1);
    expect(detail.expenses[0]).toMatchObject({
      id: "expense_settle_1",
      kind: "settlement",
      payerId: "member_1",
      shareMemberIds: ["member_2"],
      amountMinor: 500,
    });
    // A settlement transfer zeroes out the existing debt: member_1 (-500)
    // pays member_2 (+500), netting both to 0. expenseCount increments
    // (settlements count toward it) but spendTotalMinor stays untouched
    // (settlements are excluded from spend aggregates).
    expect(detail.balances).toEqual(
      expect.arrayContaining([
        { memberId: "member_1", balance: { amount_minor: 0, currency: "TWD" } },
        { memberId: "member_2", balance: { amount_minor: 0, currency: "TWD" } },
      ]),
    );
    expect(detail.aggregates.expenseCount).toBe(1);
    expect(detail.aggregates.spendTotalMinor).toBe(0);
  });

  test("loadMoreExpenses appends an older page using the oldest loaded expense as the cursor, deduped by id", async () => {
    const apiClient = makeFakeApiClient({
      getGroupDetail: vi.fn(async () =>
        makeGroupDetail({
          expenses: [
            {
              id: "expense_2",
              group_id: "group_1",
              title: "Newer",
              kind: "expense",
              amount_minor: 500,
              currency: "TWD",
              expense_date: "2026-07-05",
              created_at: "2026-07-05T00:00:00.000Z",
              version: 1,
              client_request_id: "req_2",
            },
          ],
          expense_count: 2,
        }),
      ),
      listExpensesPage: vi.fn(async () => ({
        expenses: [
          {
            id: "expense_1",
            group_id: "group_1",
            title: "Older",
            kind: "expense",
            amount_minor: 300,
            currency: "TWD",
            expense_date: "2026-07-01",
            created_at: "2026-07-01T00:00:00.000Z",
            version: 1,
            client_request_id: "req_1",
          },
        ],
      })),
    });
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
    await store.refreshGroupDetail("group_1");

    await store.loadMoreExpenses("group_1");

    expect(apiClient.listExpensesPage).toHaveBeenCalledWith("group_1", {
      beforeDate: "2026-07-05",
      beforeCreatedAt: "2026-07-05T00:00:00.000Z",
    });
    const expenses = store.getState().groupDetails.group_1.expenses;
    expect(expenses.map((expense) => expense.id)).toEqual(["expense_2", "expense_1"]);
  });

  test("loadMoreExpenses dedupes pages that overlap with already-loaded expenses", async () => {
    const apiClient = makeFakeApiClient({
      getGroupDetail: vi.fn(async () =>
        makeGroupDetail({
          expenses: [
            {
              id: "expense_1",
              group_id: "group_1",
              title: "Loaded",
              kind: "expense",
              amount_minor: 500,
              currency: "TWD",
              expense_date: "2026-07-05",
              created_at: "2026-07-05T00:00:00.000Z",
              version: 1,
              client_request_id: "req_1",
            },
          ],
          expense_count: 2,
        }),
      ),
      listExpensesPage: vi.fn(async () => ({
        expenses: [
          {
            id: "expense_1",
            group_id: "group_1",
            title: "Loaded",
            kind: "expense",
            amount_minor: 500,
            currency: "TWD",
            expense_date: "2026-07-05",
            created_at: "2026-07-05T00:00:00.000Z",
            version: 1,
            client_request_id: "req_1",
          },
        ],
      })),
    });
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
    await store.refreshGroupDetail("group_1");

    await store.loadMoreExpenses("group_1");

    const expenses = store.getState().groupDetails.group_1.expenses;
    expect(expenses.map((expense) => expense.id)).toEqual(["expense_1"]);
  });

  test("createInvite returns the real token from the api", async () => {
    const apiClient = makeFakeApiClient();
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });

    const token = await store.createInvite("group_1");

    expect(token).toBe("INVITE123");
    expect(apiClient.createInvite).toHaveBeenCalledWith("group_1", {
      client_request_id: expect.any(String),
      max_uses: 10,
    });
  });

  test("acceptInvite joins the group and inserts it into state with no full list refetch", async () => {
    const apiClient = makeFakeApiClient();
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });

    const group = await store.acceptInvite("INVITE123", "Guest");

    expect(group).toEqual({ id: "group_1", name: "Tokyo Trip", currency: "TWD", coverImageUrl: undefined });
    expect(apiClient.acceptInvite).toHaveBeenCalledWith("INVITE123", {
      client_request_id: expect.any(String),
      display_name: "Guest",
    });
    expect(apiClient.listGroups).not.toHaveBeenCalled();
    expect(store.getState().groups).toEqual([{ id: "group_1", name: "Tokyo Trip", currency: "TWD", coverImageUrl: undefined }]);
  });

  test("calls onSessionExpired and throws when the api reports UNAUTHENTICATED via error.code", async () => {
    const onSessionExpired = vi.fn();
    const authError = Object.assign(new Error("Please sign in with Google."), { code: "UNAUTHENTICATED" });
    const apiClient = makeFakeApiClient({
      listGroups: vi.fn(async () => {
        throw authError;
      }),
    });
    const store = createCloudGroupsStore({ apiClient, onSessionExpired });

    await expect(store.refreshGroups()).rejects.toThrow("Please sign in with Google.");
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
  });

  test("does not call onSessionExpired for ordinary errors, but still throws for the caller to toast", async () => {
    const onSessionExpired = vi.fn();
    const apiClient = makeFakeApiClient({
      createExpense: vi.fn(async () => {
        throw new Error("Amount must be positive.");
      }),
    });
    const store = createCloudGroupsStore({ apiClient, onSessionExpired });

    await expect(store.addExpense("group_1", baseDraft, "TWD")).rejects.toThrow("Amount must be positive.");
    expect(onSessionExpired).not.toHaveBeenCalled();
  });

  test("on mutation failure, fires a background refresh to re-sync truth", async () => {
    const apiClient = makeFakeApiClient({
      updateGroup: vi.fn(async () => {
        throw new Error("Network blip.");
      }),
    });
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
    await store.refreshGroups();
    await store.refreshGroupDetail("group_1");
    (apiClient.listGroups as any).mockClear();
    (apiClient.getGroupDetail as any).mockClear();

    await expect(store.renameGroup("group_1", "Osaka Trip")).rejects.toThrow("Network blip.");

    // The background resync is fire-and-forget; give its microtasks a tick.
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(apiClient.listGroups).toHaveBeenCalledTimes(1);
    expect(apiClient.getGroupDetail).toHaveBeenCalledTimes(1);
  });

  test("subscribe notifies listeners on state changes", async () => {
    const apiClient = makeFakeApiClient();
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    await store.refreshGroups();

    expect(listener).toHaveBeenCalled();
    unsubscribe();
  });

  describe("stale-while-revalidate cloud cache", () => {
    test("seeds initial state from a cached snapshot for the same user", () => {
      const cacheStorage = memoryStorage();
      saveCloudCache(
        {
          userId: "user_1",
          groups: [{ id: "group_1", name: "Tokyo Trip", currency: "TWD", coverImageUrl: undefined }],
          groupDetails: {
            group_1: {
              group: { id: "group_1", name: "Tokyo Trip", currency: "TWD", coverImageUrl: undefined },
              members: [{ id: "member_1", name: "Alice", role: "owner", virtual: false, userId: "user_1" }],
              expenses: [],
              balances: [{ memberId: "member_1", balance: { amount_minor: 0, currency: "TWD" } }],
              aggregates: { expenseCount: 0, spendTotalMinor: 0, spendByDay: [], spendByCategory: [], memberDayShares: [] },
            },
          },
        },
        cacheStorage,
      );

      const store = createCloudGroupsStore({
        apiClient: makeFakeApiClient(),
        onSessionExpired: vi.fn(),
        userId: "user_1",
        cacheStorage,
      });

      expect(store.getState().groups).toEqual([
        { id: "group_1", name: "Tokyo Trip", currency: "TWD", coverImageUrl: undefined },
      ]);
      expect(store.getState().groupDetails.group_1.group).toEqual({
        id: "group_1",
        name: "Tokyo Trip",
        currency: "TWD",
        coverImageUrl: undefined,
      });
    });

    test("does not seed from a cached snapshot that belongs to a different user", () => {
      const cacheStorage = memoryStorage();
      saveCloudCache(
        {
          userId: "user_other",
          groups: [{ id: "group_9", name: "Someone Else's Trip", currency: "TWD", coverImageUrl: undefined }],
          groupDetails: {},
        },
        cacheStorage,
      );

      const store = createCloudGroupsStore({
        apiClient: makeFakeApiClient(),
        onSessionExpired: vi.fn(),
        userId: "user_1",
        cacheStorage,
      });

      expect(store.getState().groups).toEqual([]);
      expect(store.getState().groupDetails).toEqual({});
    });

    test("starts blank when the cached snapshot is corrupt JSON", () => {
      const cacheStorage = memoryStorage();
      cacheStorage.setItem("equo.clean.cloud_cache", "{not-json");

      const store = createCloudGroupsStore({
        apiClient: makeFakeApiClient(),
        onSessionExpired: vi.fn(),
        userId: "user_1",
        cacheStorage,
      });

      expect(store.getState().groups).toEqual([]);
      expect(store.getState().groupDetails).toEqual({});
    });

    test("persists groups and group details back to the cache after a state change", async () => {
      vi.useFakeTimers();
      try {
        const cacheStorage = memoryStorage();
        const apiClient = makeFakeApiClient();
        const store = createCloudGroupsStore({
          apiClient,
          onSessionExpired: vi.fn(),
          userId: "user_1",
          cacheStorage,
        });

        await store.refreshGroups();
        await store.refreshGroupDetail("group_1");
        await vi.advanceTimersByTimeAsync(300);

        const persisted = loadCloudCache("user_1", cacheStorage);
        expect(persisted?.groups).toEqual([
          // balanceMinor comes from the detail read (this user is member_1,
          // who has no entries yet) - see listBalanceFromDetail.
          { id: "group_1", name: "Tokyo Trip", currency: "TWD", coverImageUrl: undefined, balanceMinor: 0 },
        ]);
        expect(persisted?.groupDetails.group_1.group).toEqual({
          id: "group_1",
          name: "Tokyo Trip",
          currency: "TWD",
          coverImageUrl: undefined,
        });
      } finally {
        vi.useRealTimers();
      }
    });

    test("does not persist when no userId is provided", async () => {
      vi.useFakeTimers();
      try {
        const cacheStorage = memoryStorage();
        const apiClient = makeFakeApiClient();
        const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn(), cacheStorage });

        await store.refreshGroups();
        await vi.advanceTimersByTimeAsync(300);

        expect(cacheStorage.getItem("equo.clean.cloud_cache")).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });

    test("clearCloudCache removes a previously persisted snapshot", async () => {
      vi.useFakeTimers();
      try {
        const cacheStorage = memoryStorage();
        const apiClient = makeFakeApiClient();
        const store = createCloudGroupsStore({
          apiClient,
          onSessionExpired: vi.fn(),
          userId: "user_1",
          cacheStorage,
        });

        await store.refreshGroups();
        await vi.advanceTimersByTimeAsync(300);
        expect(cacheStorage.getItem("equo.clean.cloud_cache")).not.toBeNull();

        clearCloudCache(cacheStorage);

        expect(loadCloudCache("user_1", cacheStorage)).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("background revalidation", () => {
    function deferred<T>() {
      let resolve!: (value: T) => void;
      const promise = new Promise<T>((settle) => {
        resolve = settle;
      });
      return { promise, resolve };
    }

    test("the empty state waits for a first read to finish, so a cold start shows the skeleton", () => {
      const gate = deferred<{ groups: (typeof group1)[] }>();
      const apiClient = makeFakeApiClient({ listGroups: vi.fn(() => gate.promise) });
      const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });

      const inFlight = store.refreshGroups();
      expect(store.getState().groupsSyncAttempted).toBe(false);
      expect(store.getState().groupsLoaded).toBe(false);
      expect(store.getState().groupsSynced).toBe(false);

      gate.resolve({ groups: [group1] });
      return inFlight.then(() => {
        expect(store.getState().groupsSyncAttempted).toBe(true);
        expect(store.getState().groupsLoaded).toBe(true);
        expect(store.getState().groupsSynced).toBe(true);
      });
    });

    test("a background groups refresh never takes the answer back", async () => {
      const gate = deferred<{ groups: (typeof group1)[] }>();
      let call = 0;
      const apiClient = makeFakeApiClient({
        listGroups: vi.fn(() => {
          call += 1;
          return call === 1 ? Promise.resolve({ groups: [group1] }) : gate.promise;
        }),
      });
      const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });

      await store.refreshGroups();

      // This is the one that used to blank the whole group list back to
      // GroupHomeSkeleton — every 60s, and on every return to the app.
      const inFlight = store.refreshGroups();
      expect(store.getState().groupsSyncAttempted).toBe(true);
      expect(store.getState().groups).toHaveLength(1);

      gate.resolve({ groups: [group1] });
      await inFlight;
      expect(store.getState().groupsSyncAttempted).toBe(true);
    });

    test("a cache-seeded store treats even its very first refresh as background", async () => {
      vi.useFakeTimers();
      try {
        const cacheStorage = memoryStorage();
        const warm = createCloudGroupsStore({
          apiClient: makeFakeApiClient(),
          onSessionExpired: vi.fn(),
          userId: "user_1",
          cacheStorage,
        });
        await warm.refreshGroups();
        await vi.advanceTimersByTimeAsync(300);

        const gate = deferred<{ groups: (typeof group1)[] }>();
        const apiClient = makeFakeApiClient({ listGroups: vi.fn(() => gate.promise) });
        const reopened = createCloudGroupsStore({
          apiClient,
          onSessionExpired: vi.fn(),
          userId: "user_1",
          cacheStorage,
        });

        // Cached groups are on screen, so the revalidation behind them must not
        // cover them with a skeleton...
        expect(reopened.getState().groups).toHaveLength(1);
        expect(reopened.getState().groupsLoaded).toBe(true);
        // ...but nothing may route off a cache that predates this session.
        expect(reopened.getState().groupsSynced).toBe(false);

        const inFlight = reopened.refreshGroups();
        // The cache is a list worth SHOWING, not an answer worth routing off -
        // and not one the empty state may act on either, which is the whole of
        // 「一打開的畫面會閃過這一頁」.
        expect(reopened.getState().groupsSyncAttempted).toBe(false);

        gate.resolve({ groups: [group1] });
        await inFlight;
        expect(reopened.getState().groupsSynced).toBe(true);
      } finally {
        vi.useRealTimers();
      }
    });

    test("an unchanged groups poll publishes nothing at all", async () => {
      const apiClient = makeFakeApiClient();
      const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
      await store.refreshGroups();

      const before = store.getState().groups;
      let notified = 0;
      store.subscribe(() => {
        notified += 1;
      });

      await store.refreshGroups();

      expect(notified).toBe(0);
      expect(store.getState().groups).toBe(before);
    });

    test("...but a changed groups poll still lands", async () => {
      let call = 0;
      const apiClient = makeFakeApiClient({
        listGroups: vi.fn(async () => {
          call += 1;
          return { groups: [call === 1 ? group1 : { ...group1, name: "Osaka Trip" }] };
        }),
      });
      const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
      await store.refreshGroups();

      let notified = 0;
      store.subscribe(() => {
        notified += 1;
      });

      await store.refreshGroups();

      expect(notified).toBeGreaterThan(0);
      expect(store.getState().groups[0].name).toBe("Osaka Trip");
    });

    test("an unchanged detail poll keeps the very same objects and notifies nobody", async () => {
      const apiClient = makeFakeApiClient();
      const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
      const first = await store.refreshGroupDetail("group_1");

      let notified = 0;
      store.subscribe(() => {
        notified += 1;
      });

      const second = await store.refreshGroupDetail("group_1", { background: true });

      // Same reference, so React re-renders nothing and the cloud cache is not
      // re-serialised to localStorage.
      expect(second).toBe(first);
      expect(store.getState().groupDetails.group_1).toBe(first);
      expect(notified).toBe(0);
    });

    test("...but a detail poll that actually changed replaces the data", async () => {
      let call = 0;
      const apiClient = makeFakeApiClient({
        getGroupDetail: vi.fn(async () => {
          call += 1;
          if (call === 1) return makeGroupDetail({ members: [member1] });
          return makeGroupDetail({
            members: [member1],
            expenses: [
              {
                id: "expense_1",
                group_id: "group_1",
                title: "Dinner",
                kind: "expense",
                amount_minor: 1200,
                currency: "TWD",
                expense_date: "2026-08-17",
                version: 1,
                client_request_id: "req_1",
                expense_payments: [{ payer_member_id: "member_1", amount_minor: 1200, currency: "TWD" }],
                expense_shares: [{ member_id: "member_1", share_type: "fixed", amount_minor: 1200 }],
              },
            ],
            spend_total_minor: 1200,
          });
        }),
      });
      const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
      const first = await store.refreshGroupDetail("group_1");

      let notified = 0;
      store.subscribe(() => {
        notified += 1;
      });

      const second = await store.refreshGroupDetail("group_1", { background: true });

      expect(second).not.toBe(first);
      expect(second.expenses).toHaveLength(1);
      expect(second.expenses[0].title).toBe("Dinner");
      expect(store.getState().groupDetails.group_1).toBe(second);
      expect(notified).toBeGreaterThan(0);
    });

    test("background:true suppresses the per-group loading flag; the default still sets it", async () => {
      const gate = deferred<GroupDetail>();
      let call = 0;
      const apiClient = makeFakeApiClient({
        getGroupDetail: vi.fn(() => {
          call += 1;
          return call === 1 ? Promise.resolve(makeGroupDetail({ members: [member1] })) : gate.promise;
        }),
      });
      const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
      await store.refreshGroupDetail("group_1");

      const background = store.refreshGroupDetail("group_1", { background: true });
      expect(store.getState().loadingGroupIds.group_1).toBeUndefined();

      gate.resolve(makeGroupDetail({ members: [member1] }));
      await background;

      const gate2 = deferred<GroupDetail>();
      apiClient.getGroupDetail = vi.fn(() => gate2.promise);
      const foreground = store.refreshGroupDetail("group_1");
      expect(store.getState().loadingGroupIds.group_1).toBe(true);

      gate2.resolve(makeGroupDetail({ members: [member1] }));
      await foreground;
      expect(store.getState().loadingGroupIds.group_1).toBeUndefined();
    });
  });

  describe("searchExpenses kind translation", () => {
    test("sends the column's word, not the app's, for a 清償 filter", async () => {
      // expenses.kind stores 'transfer'; the UI calls it 結算/"settlement".
      // Passing the app's word straight through matched nothing server-side,
      // so the records panel's 結算 filter returned an empty list for groups
      // that plainly had settlements in them.
      const apiClient = makeFakeApiClient();
      const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });

      await store.searchExpenses("group_1", { kind: "settlement" });

      expect(apiClient.searchExpenses).toHaveBeenCalledWith("group_1", expect.objectContaining({ kind: "transfer" }));
    });

    test("leaves the kinds that already agree alone", async () => {
      const apiClient = makeFakeApiClient();
      const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });

      await store.searchExpenses("group_1", { kind: "expense" });

      expect(apiClient.searchExpenses).toHaveBeenCalledWith("group_1", expect.objectContaining({ kind: "expense" }));
    });

    test("an absent kind stays absent rather than becoming a filter", async () => {
      const apiClient = makeFakeApiClient();
      const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });

      await store.searchExpenses("group_1", { q: "dinner" });

      const [, sent] = (apiClient.searchExpenses as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(sent.kind).toBeUndefined();
    });
  });

});
