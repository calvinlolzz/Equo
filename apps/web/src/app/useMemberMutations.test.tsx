// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, test, vi } from "vitest";
import type { CloudGroupsStore } from "./cloudStore";
import type { Group, Member } from "./appTypes";
import { useMemberMutations } from "./useMemberMutations";
import { UI_TEXT } from "./uiText";

const group: Group = { id: "group_1", name: "東京旅行", currency: "TWD" };
const alice: Member = { id: "member_alice", name: "Alice", role: "owner" };
const bob: Member = { id: "member_bob", name: "Bob", role: "member" };

function setup(overrides: { cloudStore?: Partial<CloudGroupsStore> } = {}) {
  const showToast = vi.fn();
  const recordCloudActivity = vi.fn();
  const beginAction = vi.fn(() => true);
  const endAction = vi.fn();
  const setDialog = vi.fn();
  const cloudStore = {
    addVirtualMember: vi.fn(async () => {}),
    renameMember: vi.fn(async () => {}),
    removeMember: vi.fn(async () => {}),
    ...overrides.cloudStore,
  } as unknown as CloudGroupsStore;

  const hook = renderHook(() =>
    useMemberMutations({ activeGroup: group, cloudStore, showToast, recordCloudActivity, beginAction, endAction, setDialog }),
  );

  return { hook, cloudStore, showToast, recordCloudActivity, setDialog };
}

describe("useMemberMutations", () => {
  test("addVirtualMember refuses a blank name, then adds and clears the field", async () => {
    const { hook, cloudStore, setDialog } = setup();

    await act(async () => {
      await hook.result.current.addVirtualMember();
    });
    expect(cloudStore.addVirtualMember).not.toHaveBeenCalled();

    act(() => hook.result.current.setVirtualMemberName("  阿明  "));
    await act(async () => {
      await hook.result.current.addVirtualMember();
    });

    expect(cloudStore.addVirtualMember).toHaveBeenCalledWith("group_1", "阿明");
    expect(hook.result.current.virtualMemberName).toBe("");
    expect(setDialog).toHaveBeenCalledWith(null);
  });

  test("starting a rename seeds the editor and cancels a pending remove-confirm", () => {
    const { hook } = setup();

    // Arm the remove confirm on bob first...
    act(() => {
      hook.result.current.removeMember(bob);
    });
    expect(hook.result.current.confirmingRemoveMemberId).toBe("member_bob");

    // ...then starting a rename on alice must clear it (they're mutually exclusive).
    act(() => hook.result.current.startRenameMember(alice));
    expect(hook.result.current.renamingMemberId).toBe("member_alice");
    expect(hook.result.current.renameMemberValue).toBe("Alice");
    expect(hook.result.current.confirmingRemoveMemberId).toBe("");
  });

  test("submitting an unchanged name is a no-op (no API call)", async () => {
    const { hook, cloudStore } = setup();

    act(() => hook.result.current.startRenameMember(alice)); // seeds value = "Alice"
    await act(async () => {
      await hook.result.current.submitRenameMember(alice);
    });

    expect(cloudStore.renameMember).not.toHaveBeenCalled();
    expect(hook.result.current.renamingMemberId).toBe("");
  });

  test("submitting a changed name renames and records it", async () => {
    const { hook, cloudStore, recordCloudActivity } = setup();

    act(() => hook.result.current.startRenameMember(alice));
    act(() => hook.result.current.setRenameMemberValue("愛麗絲"));
    await act(async () => {
      await hook.result.current.submitRenameMember(alice);
    });

    expect(cloudStore.renameMember).toHaveBeenCalledWith("group_1", "member_alice", "愛麗絲");
    expect(recordCloudActivity).toHaveBeenCalledWith("group_1", expect.stringContaining("愛麗絲"));
    expect(hook.result.current.renamingMemberId).toBe("");
  });

  test("removing a member is a two-tap confirm: the first tap only arms it", async () => {
    const { hook, cloudStore } = setup();

    await act(async () => {
      await hook.result.current.removeMember(bob);
    });
    // First tap: armed, no API call yet.
    expect(hook.result.current.confirmingRemoveMemberId).toBe("member_bob");
    expect(cloudStore.removeMember).not.toHaveBeenCalled();

    await act(async () => {
      await hook.result.current.removeMember(bob);
    });
    // Second tap on the same member: it actually removes.
    expect(cloudStore.removeMember).toHaveBeenCalledWith("group_1", "member_bob");
  });

  test("a member-with-balance removal surfaces the specific message", async () => {
    const { hook, showToast } = setup({
      cloudStore: {
        removeMember: vi.fn(async () => {
          throw Object.assign(new Error("has balance"), { code: "MEMBER_HAS_BALANCE" });
        }),
      },
    });

    // First tap arms, second tap triggers the (failing) removal.
    await act(async () => {
      await hook.result.current.removeMember(bob);
    });
    await act(async () => {
      await hook.result.current.removeMember(bob);
    });

    expect(showToast).toHaveBeenCalledWith(UI_TEXT.app.memberHasBalance);
  });
});
