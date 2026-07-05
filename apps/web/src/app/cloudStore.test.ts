import { describe, expect, test, vi } from "vitest";
import type { ApiClientLike } from "./cloudStore";
import { createCloudGroupsStore } from "./cloudStore";
import type { ExpenseDraft } from "./ExpenseComposerSheet";

const group1 = { id: "group_1", name: "Tokyo Trip", currency: "TWD", owner_member_id: "member_1" };
const member1 = {
  id: "member_1",
  group_id: "group_1",
  user_id: "user_1",
  display_name: "Alice",
  role: "owner" as const,
  status: "active" as const,
};

function makeFakeApiClient(overrides: Partial<ApiClientLike> = {}): ApiClientLike {
  return {
    createGroup: vi.fn(async () => ({ group: group1, owner_member: member1 })),
    listGroups: vi.fn(async () => ({ groups: [group1] })),
    listArchivedGroups: vi.fn(async () => ({ groups: [] })),
    getGroupDetail: vi.fn(async () => ({ group: group1, members: [member1], expenses: [], balances: [] })),
    updateGroup: vi.fn(async () => ({ group: group1 })),
    createVirtualMember: vi.fn(async () => ({
      member: { id: "member_2", group_id: "group_1", user_id: null, display_name: "Bob", role: "member" as const, status: "active" as const },
    })),
    archiveGroup: vi.fn(async () => ({ group: group1 })),
    unarchiveGroup: vi.fn(async () => ({ group: group1 })),
    deleteGroup: vi.fn(async () => ({ group: group1 })),
    createInvite: vi.fn(async () => ({ invite: { token: "INVITE123", max_uses: 10 } })),
    acceptInvite: vi.fn(async () => ({ group: group1, member: member1, claimed: false })),
    createExpense: vi.fn(async () => ({ expense: { id: "expense_1", title: "Dinner", amount_minor: 1000, currency: "TWD" } })),
    deleteExpense: vi.fn(async () => ({ expense: { id: "expense_1" } })),
    uploadGroupImage: vi.fn(async () => ({ image: { url: "https://cdn.equo.local/image.jpg" } })),
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
    expect(store.getState().loadingGroups).toBe(false);
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
          },
        ],
      })),
    });
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });

    const archived = await store.listArchivedGroups();

    expect(archived).toEqual([
      { id: "group_2", name: "Old Trip", currency: "TWD", coverImageUrl: "https://cdn.equo.local/cover.jpg" },
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
      getGroupDetail: vi.fn(async () => ({
        group: group1,
        members: [member1],
        expenses: [
          {
            id: "expense_0",
            group_id: "group_1",
            title: "Older",
            kind: "expense",
            amount_minor: 500,
            currency: "TWD",
            version: 1,
            client_request_id: "req_0",
          },
        ],
        balances: [],
      })),
    });
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
    await store.refreshGroupDetail("group_1");

    await store.addExpense("group_1", baseDraft, "TWD");

    const expenses = store.getState().groupDetails.group_1.expenses;
    expect(expenses.map((expense) => expense.id)).toEqual(["expense_1", "expense_0"]);
  });

  test("editExpense soft-deletes the old expense, creates the replacement, and replaces it in place locally", async () => {
    const apiClient = makeFakeApiClient({
      getGroupDetail: vi.fn(async () => ({
        group: group1,
        members: [member1],
        expenses: [
          {
            id: "expense_1",
            group_id: "group_1",
            title: "Lunch (old)",
            kind: "expense",
            amount_minor: 800,
            currency: "TWD",
            version: 1,
            client_request_id: "req_orig",
          },
        ],
        balances: [],
      })),
    });
    const calls: string[] = [];
    (apiClient.deleteExpense as any).mockImplementation(async () => {
      calls.push("delete");
      return { expense: { id: "expense_1" } };
    });
    (apiClient.createExpense as any).mockImplementation(async () => {
      calls.push("create");
      return { expense: { id: "expense_2", title: "Lunch", amount_minor: 1000, currency: "TWD" } };
    });
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
    await store.refreshGroupDetail("group_1");

    await store.editExpense("group_1", "expense_1", baseDraft, "TWD");

    expect(calls).toEqual(["delete", "create"]);
    expect(apiClient.deleteExpense).toHaveBeenCalledWith("group_1", "expense_1", {
      client_request_id: expect.any(String),
    });
    expect(apiClient.getGroupDetail).toHaveBeenCalledTimes(1);
    const expenses = store.getState().groupDetails.group_1.expenses;
    expect(expenses).toHaveLength(1);
    expect(expenses[0].id).toBe("expense_2");
    expect(expenses[0].title).toBe("Lunch");
  });

  test("deleteExpense removes the expense from the cached detail, no refetch", async () => {
    const apiClient = makeFakeApiClient({
      getGroupDetail: vi.fn(async () => ({
        group: group1,
        members: [member1],
        expenses: [
          {
            id: "expense_1",
            group_id: "group_1",
            title: "Lunch",
            kind: "expense",
            amount_minor: 1000,
            currency: "TWD",
            version: 1,
            client_request_id: "req_1",
          },
        ],
        balances: [],
      })),
    });
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
    await store.refreshGroupDetail("group_1");

    await store.deleteExpense("group_1", "expense_1");

    expect(apiClient.deleteExpense).toHaveBeenCalledWith("group_1", "expense_1", {
      client_request_id: expect.any(String),
    });
    expect(apiClient.getGroupDetail).toHaveBeenCalledTimes(1);
    expect(store.getState().groupDetails.group_1.expenses).toEqual([]);
  });

  test("settleTransfer creates a transfer-kind expense and prepends the settlement locally, no refetch", async () => {
    const apiClient = makeFakeApiClient({
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
    const expenses = store.getState().groupDetails.group_1.expenses;
    expect(expenses).toHaveLength(1);
    expect(expenses[0]).toMatchObject({
      id: "expense_settle_1",
      kind: "settlement",
      payerId: "member_1",
      shareMemberIds: ["member_2"],
      amountMinor: 500,
    });
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
});
