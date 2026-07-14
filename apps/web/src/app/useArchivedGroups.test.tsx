// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { ArchivedGroupData, CloudGroupsStore } from "./cloudStore";
import { useArchivedGroups } from "./useArchivedGroups";

const ownedGroup: ArchivedGroupData = {
  id: "group_1",
  name: "東京旅行",
  currency: "TWD",
  ownerMemberId: "member_me",
  callerMemberId: "member_me",
};

const someoneElsesGroup: ArchivedGroupData = {
  ...ownedGroup,
  id: "group_2",
  name: "室友開銷",
  ownerMemberId: "member_owner",
  callerMemberId: "member_me",
};

function setup(overrides: Partial<CloudGroupsStore> = {}) {
  const showToast = vi.fn();
  const describeError = vi.fn((error: unknown) => (error as Error).message);
  const cloudStore = {
    listArchivedGroups: vi.fn(async () => [ownedGroup, someoneElsesGroup]),
    unarchiveGroup: vi.fn(async () => ownedGroup),
    ...overrides,
  } as unknown as CloudGroupsStore;

  const hook = renderHook(() => useArchivedGroups({ cloudStore, showToast, describeError }));

  return { hook, cloudStore, showToast, describeError };
}

describe("useArchivedGroups", () => {
  test("loads the archived list on demand", async () => {
    const { hook, cloudStore } = setup();

    expect(hook.result.current.archivedGroups).toEqual([]);
    expect(cloudStore.listArchivedGroups).not.toHaveBeenCalled();

    await act(async () => {
      await hook.result.current.loadArchivedGroups();
    });

    expect(hook.result.current.archivedGroups).toHaveLength(2);
    expect(hook.result.current.loading).toBe(false);
  });

  test("surfaces a load failure and stops loading", async () => {
    const { hook, showToast } = setup({
      listArchivedGroups: vi.fn(async () => {
        throw new Error("network down");
      }),
    } as Partial<CloudGroupsStore>);

    await act(async () => {
      await hook.result.current.loadArchivedGroups();
    });

    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("network down"));
    expect(hook.result.current.loading).toBe(false);
  });

  test("restoring a group removes it from the list", async () => {
    const { hook, cloudStore, showToast } = setup();

    await act(async () => {
      await hook.result.current.loadArchivedGroups();
    });
    await act(async () => {
      await hook.result.current.unarchiveGroup(ownedGroup);
    });

    expect(cloudStore.unarchiveGroup).toHaveBeenCalledWith("group_1");
    expect(hook.result.current.archivedGroups.map((group) => group.id)).toEqual(["group_2"]);
    expect(showToast).toHaveBeenCalledWith(expect.stringContaining("東京旅行"));
  });

  test("refuses to restore a group the caller does not own, without calling the API", async () => {
    // The restore button is only rendered for groups the caller owns. This is
    // the handler guarding itself in case that ever drifts.
    const { hook, cloudStore, showToast } = setup();

    await act(async () => {
      await hook.result.current.unarchiveGroup(someoneElsesGroup);
    });

    expect(cloudStore.unarchiveGroup).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalledWith("只有群主可以進行此操作");
  });

  test("a restore failure leaves the group in the list", async () => {
    const { hook, showToast } = setup({
      unarchiveGroup: vi.fn(async () => {
        throw new Error("restore failed");
      }),
    } as Partial<CloudGroupsStore>);

    await act(async () => {
      await hook.result.current.loadArchivedGroups();
    });
    await act(async () => {
      await hook.result.current.unarchiveGroup(ownedGroup);
    });

    expect(hook.result.current.archivedGroups.map((group) => group.id)).toEqual(["group_1", "group_2"]);
    expect(showToast).toHaveBeenCalledWith("restore failed");
    await waitFor(() => expect(hook.result.current.unarchivingGroupId).toBe(""));
  });

  test("does nothing at all without a cloud store (logged out)", async () => {
    const showToast = vi.fn();
    const hook = renderHook(() =>
      useArchivedGroups({ cloudStore: null, showToast, describeError: (error) => String(error) }),
    );

    await act(async () => {
      await hook.result.current.loadArchivedGroups();
      await hook.result.current.unarchiveGroup(ownedGroup);
    });

    expect(hook.result.current.archivedGroups).toEqual([]);
    expect(showToast).not.toHaveBeenCalled();
  });
});
