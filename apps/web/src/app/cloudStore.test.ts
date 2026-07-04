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
    expect(data.members).toEqual([{ id: "member_1", name: "Alice", role: "owner", virtual: false }]);
    expect(store.getState().groupDetails.group_1).toBe(data);
    expect(store.getState().loadingGroupIds.group_1).toBeUndefined();
  });

  test("createGroup calls the api then refreshes the group list", async () => {
    const apiClient = makeFakeApiClient();
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });

    const group = await store.createGroup({ name: "Tokyo Trip", currency: "TWD" });

    expect(group).toEqual({ id: "group_1", name: "Tokyo Trip", currency: "TWD", coverImageUrl: undefined });
    expect(apiClient.createGroup).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Tokyo Trip", currency: "TWD", client_request_id: expect.any(String) }),
    );
    expect(apiClient.listGroups).toHaveBeenCalledTimes(1);
    expect(store.getState().groups).toEqual([{ id: "group_1", name: "Tokyo Trip", currency: "TWD", coverImageUrl: undefined }]);
  });

  test("renameGroup updates the group then refreshes list and detail", async () => {
    const apiClient = makeFakeApiClient();
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });

    await store.renameGroup("group_1", "Osaka Trip");

    expect(apiClient.updateGroup).toHaveBeenCalledWith("group_1", {
      client_request_id: expect.any(String),
      name: "Osaka Trip",
    });
    expect(apiClient.listGroups).toHaveBeenCalledTimes(1);
    expect(apiClient.getGroupDetail).toHaveBeenCalledTimes(1);
  });

  test("addVirtualMember creates the member then refreshes detail", async () => {
    const apiClient = makeFakeApiClient();
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });

    await store.addVirtualMember("group_1", "Bob");

    expect(apiClient.createVirtualMember).toHaveBeenCalledWith("group_1", {
      client_request_id: expect.any(String),
      display_name: "Bob",
    });
    expect(apiClient.getGroupDetail).toHaveBeenCalledTimes(1);
  });

  test("archiveGroup and deleteGroup refresh the group list", async () => {
    const apiClient = makeFakeApiClient();
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });

    await store.archiveGroup("group_1");
    await store.deleteGroup("group_1");

    expect(apiClient.archiveGroup).toHaveBeenCalledWith("group_1", { client_request_id: expect.any(String) });
    expect(apiClient.deleteGroup).toHaveBeenCalledWith("group_1", { client_request_id: expect.any(String) });
    expect(apiClient.listGroups).toHaveBeenCalledTimes(2);
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

  test("unarchiveGroup calls the api then refreshes the group list", async () => {
    const apiClient = makeFakeApiClient();
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });

    const group = await store.unarchiveGroup("group_1");

    expect(group).toEqual({ id: "group_1", name: "Tokyo Trip", currency: "TWD", coverImageUrl: undefined });
    expect(apiClient.unarchiveGroup).toHaveBeenCalledWith("group_1", { client_request_id: expect.any(String) });
    expect(apiClient.listGroups).toHaveBeenCalledTimes(1);
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

  test("updateGroupCover updates the group then refreshes list and detail", async () => {
    const apiClient = makeFakeApiClient();
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });

    await store.updateGroupCover("group_1", "Tokyo Trip", "https://cdn.equo.local/cover.jpg");

    expect(apiClient.updateGroup).toHaveBeenCalledWith("group_1", {
      client_request_id: expect.any(String),
      name: "Tokyo Trip",
      cover_image_url: "https://cdn.equo.local/cover.jpg",
    });
    expect(apiClient.listGroups).toHaveBeenCalledTimes(1);
    expect(apiClient.getGroupDetail).toHaveBeenCalledTimes(1);
  });

  test("addExpense maps the draft then refreshes group detail", async () => {
    const apiClient = makeFakeApiClient();
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });

    await store.addExpense("group_1", baseDraft, "TWD");

    expect(apiClient.createExpense).toHaveBeenCalledWith(
      "group_1",
      expect.objectContaining({ kind: "expense", amount_minor: 1000, currency: "TWD" }),
    );
    expect(apiClient.getGroupDetail).toHaveBeenCalledTimes(1);
  });

  test("editExpense soft-deletes the old expense then creates the replacement", async () => {
    const apiClient = makeFakeApiClient();
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });
    const calls: string[] = [];
    (apiClient.deleteExpense as any).mockImplementation(async () => {
      calls.push("delete");
      return { expense: { id: "expense_1" } };
    });
    (apiClient.createExpense as any).mockImplementation(async () => {
      calls.push("create");
      return { expense: { id: "expense_2", title: "Lunch", amount_minor: 1000, currency: "TWD" } };
    });

    await store.editExpense("group_1", "expense_1", baseDraft, "TWD");

    expect(calls).toEqual(["delete", "create"]);
    expect(apiClient.deleteExpense).toHaveBeenCalledWith("group_1", "expense_1", {
      client_request_id: expect.any(String),
    });
  });

  test("deleteExpense calls the delete endpoint then refreshes detail", async () => {
    const apiClient = makeFakeApiClient();
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });

    await store.deleteExpense("group_1", "expense_1");

    expect(apiClient.deleteExpense).toHaveBeenCalledWith("group_1", "expense_1", {
      client_request_id: expect.any(String),
    });
    expect(apiClient.getGroupDetail).toHaveBeenCalledTimes(1);
  });

  test("settleTransfer creates a transfer-kind expense then refreshes detail", async () => {
    const apiClient = makeFakeApiClient();
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });

    await store.settleTransfer("group_1", "member_1", "member_2", 500, "TWD");

    expect(apiClient.createExpense).toHaveBeenCalledWith(
      "group_1",
      expect.objectContaining({ kind: "transfer", transfer_to_member_id: "member_2", amount_minor: 500 }),
    );
    expect(apiClient.getGroupDetail).toHaveBeenCalledTimes(1);
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

  test("acceptInvite joins the group then refreshes the group list", async () => {
    const apiClient = makeFakeApiClient();
    const store = createCloudGroupsStore({ apiClient, onSessionExpired: vi.fn() });

    const group = await store.acceptInvite("INVITE123", "Guest");

    expect(group).toEqual({ id: "group_1", name: "Tokyo Trip", currency: "TWD", coverImageUrl: undefined });
    expect(apiClient.acceptInvite).toHaveBeenCalledWith("INVITE123", {
      client_request_id: expect.any(String),
      display_name: "Guest",
    });
    expect(apiClient.listGroups).toHaveBeenCalledTimes(1);
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
