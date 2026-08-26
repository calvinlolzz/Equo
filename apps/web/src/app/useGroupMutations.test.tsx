// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { CloudGroupsStore } from "./cloudStore";
import type { Group } from "./appTypes";
import { useGroupMutations } from "./useGroupMutations";

const group: Group = { id: "group_1", name: "東京旅行", currency: "TWD" };

function setup(overrides: { cloudStore?: Partial<CloudGroupsStore>; activeGroup?: Group } = {}) {
  const showToast = vi.fn();
  const recordCloudActivity = vi.fn();
  const beginAction = vi.fn(() => true);
  const endAction = vi.fn();
  const setDialog = vi.fn();
  const setBusy = vi.fn();
  const openGroup = vi.fn();
  const closeGroup = vi.fn();
  const loadArchivedGroups = vi.fn();
  const cloudStore = {
    createGroup: vi.fn(async ({ name }: { name: string }) => ({ id: "group_new", name, currency: "TWD" })),
    uploadGroupImage: vi.fn(async () => "https://cdn/cover.png"),
    updateGroupCover: vi.fn(async () => {}),
    renameGroup: vi.fn(async () => {}),
    setMonthlyBudget: vi.fn(async () => {}),
    archiveGroup: vi.fn(async () => {}),
    deleteGroup: vi.fn(async () => {}),
    ...overrides.cloudStore,
  } as unknown as CloudGroupsStore;

  const hook = renderHook(() =>
    useGroupMutations({
      activeGroup: overrides.activeGroup ?? group,
      cloudStore,
      showToast,
      recordCloudActivity,
      beginAction,
      endAction,
      setDialog,
      setBusy,
      openGroup,
      closeGroup,
      loadArchivedGroups,
    }),
  );

  return { hook, cloudStore, showToast, recordCloudActivity, beginAction, setDialog, openGroup, closeGroup, loadArchivedGroups };
}

describe("useGroupMutations", () => {
  test("createGroup refuses an empty name, then creates once a name is typed", async () => {
    const { hook, cloudStore, openGroup, setDialog, beginAction } = setup();

    // Empty name (nothing typed): no create, and the guard must NOT be claimed
    // (the name check runs first) - otherwise a blank submit would leave the
    // lock held forever.
    await act(async () => {
      await hook.result.current.createGroup();
    });
    expect(cloudStore.createGroup).not.toHaveBeenCalled();
    expect(beginAction).not.toHaveBeenCalled();

    act(() => hook.result.current.setGroupName("  滑雪團  "));
    await act(async () => {
      await hook.result.current.createGroup();
    });

    expect(cloudStore.createGroup).toHaveBeenCalledWith({ name: "滑雪團", currency: "TWD" });
    expect(openGroup).toHaveBeenCalledWith("group_new", "replace");
    expect(setDialog).toHaveBeenCalledWith(null);
  });

  test("createGroup with a picked cover uploads and applies it after creating", async () => {
    const { hook, cloudStore } = setup();

    act(() => {
      hook.result.current.setGroupName("有封面的團");
      hook.result.current.setGroupCoverDataUrl("data:image/png;base64,AAA");
    });
    await act(async () => {
      await hook.result.current.createGroup();
    });

    expect(cloudStore.uploadGroupImage).toHaveBeenCalledWith("group_new", "cover", "data:image/png;base64,AAA");
    expect(cloudStore.updateGroupCover).toHaveBeenCalledWith("group_new", "有封面的團", "https://cdn/cover.png");
  });

  test("updateActiveGroup without a new cover just renames", async () => {
    const { hook, cloudStore, recordCloudActivity } = setup();

    act(() => hook.result.current.setGroupName("改名了"));
    await act(async () => {
      await hook.result.current.updateActiveGroup();
    });

    expect(cloudStore.renameGroup).toHaveBeenCalledWith("group_1", "改名了");
    expect(cloudStore.updateGroupCover).not.toHaveBeenCalled();
    expect(recordCloudActivity).toHaveBeenCalledWith("group_1", expect.stringContaining("改名了"));
  });

  test("updateActiveGroup with a new cover uploads and updates the cover (not a plain rename)", async () => {
    const { hook, cloudStore } = setup();

    act(() => {
      hook.result.current.setGroupName("換封面");
      hook.result.current.setGroupCoverDataUrl("data:image/png;base64,BBB");
    });
    await act(async () => {
      await hook.result.current.updateActiveGroup();
    });

    expect(cloudStore.uploadGroupImage).toHaveBeenCalledWith("group_1", "cover", "data:image/png;base64,BBB");
    expect(cloudStore.updateGroupCover).toHaveBeenCalledWith("group_1", "換封面", "https://cdn/cover.png");
    expect(cloudStore.renameGroup).not.toHaveBeenCalled();
  });

  test("archiveActiveGroup archives, closes the group and the dialog", async () => {
    const { hook, cloudStore, closeGroup, setDialog } = setup();

    await act(async () => {
      await hook.result.current.archiveActiveGroup();
    });

    expect(cloudStore.archiveGroup).toHaveBeenCalledWith("group_1");
    expect(closeGroup).toHaveBeenCalled();
    expect(setDialog).toHaveBeenCalledWith(null);
  });

  test("an owner-only (FORBIDDEN) failure surfaces the specific message, not the generic one", async () => {
    const { hook, showToast, closeGroup } = setup({
      cloudStore: {
        archiveGroup: vi.fn(async () => {
          throw Object.assign(new Error("forbidden"), { code: "FORBIDDEN" });
        }),
      },
    });

    await act(async () => {
      await hook.result.current.archiveActiveGroup();
    });

    expect(showToast).toHaveBeenCalledWith("只有群主可以進行此操作");
    expect(closeGroup).not.toHaveBeenCalled();
  });

  test("deleteActiveGroup deletes and closes the group", async () => {
    const { hook, cloudStore, closeGroup } = setup();

    await act(async () => {
      await hook.result.current.deleteActiveGroup();
    });

    expect(cloudStore.deleteGroup).toHaveBeenCalledWith("group_1");
    expect(closeGroup).toHaveBeenCalled();
  });

  test("openArchivedGroups opens the panel and loads the list", () => {
    const { hook, setDialog, loadArchivedGroups } = setup();

    act(() => hook.result.current.openArchivedGroups());

    expect(setDialog).toHaveBeenCalledWith("archivedList");
    expect(loadArchivedGroups).toHaveBeenCalled();
  });
});

describe("每月預算", () => {
  test("a typed amount is saved in minor units", async () => {
    const { hook, cloudStore } = setup();

    act(() => hook.result.current.setGroupName("東京旅行"));
    act(() => hook.result.current.setMonthlyBudget("20000"));
    await act(async () => {
      await hook.result.current.updateActiveGroup();
    });

    expect(cloudStore.setMonthlyBudget).toHaveBeenCalledWith("group_1", "東京旅行", 2_000_000);
  });

  test("an empty box clears the budget rather than setting it to zero", async () => {
    // Number("") is 0, so the naive parse would store a budget of nothing
    // instead of no budget - and "0% of NT$0" is not a feature.
    const withBudget = { ...group, monthlyBudgetMinor: 2_000_000 };
    const { hook, cloudStore } = setup({ activeGroup: withBudget });

    act(() => hook.result.current.setGroupName("東京旅行"));
    act(() => hook.result.current.setMonthlyBudget("  "));
    await act(async () => {
      await hook.result.current.updateActiveGroup();
    });

    expect(cloudStore.setMonthlyBudget).toHaveBeenCalledWith("group_1", "東京旅行", null);
  });

  test("an unchanged budget is not written back", async () => {
    const withBudget = { ...group, monthlyBudgetMinor: 2_000_000 };
    const { hook, cloudStore } = setup({ activeGroup: withBudget });

    act(() => hook.result.current.openEditGroup());
    await act(async () => {
      await hook.result.current.updateActiveGroup();
    });

    expect(cloudStore.setMonthlyBudget).not.toHaveBeenCalled();
  });

  test("opening the dialog shows the saved budget in major units", () => {
    const withBudget = { ...group, monthlyBudgetMinor: 2_000_000 };
    const { hook } = setup({ activeGroup: withBudget });

    act(() => hook.result.current.openEditGroup());

    expect(hook.result.current.monthlyBudget).toBe("20000");
  });

  test("a negative or non-numeric budget is refused, and nothing is written", async () => {
    const { hook, cloudStore, showToast } = setup();

    act(() => hook.result.current.setGroupName("東京旅行"));
    act(() => hook.result.current.setMonthlyBudget("-5"));
    await act(async () => {
      await hook.result.current.updateActiveGroup();
    });

    expect(cloudStore.setMonthlyBudget).not.toHaveBeenCalled();
    expect(cloudStore.renameGroup).not.toHaveBeenCalled();
    expect(showToast).toHaveBeenCalled();
  });
});
