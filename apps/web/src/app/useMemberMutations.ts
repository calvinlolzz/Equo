import { useState } from "react";
import type { CloudGroupsStore } from "./cloudStore";
import type { DialogMode, Group, Member } from "./appTypes";
import type { ToastAction } from "./useToast";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

type UseMemberMutationsDeps = {
  activeGroup: Group | null;
  cloudStore: CloudGroupsStore | null;
  showToast: (message: string, action?: ToastAction) => void;
  recordCloudActivity: (groupId: string, activityText: string) => void;
  beginAction: (key: string) => boolean;
  endAction: () => void;
  setDialog: (dialog: DialogMode) => void;
};

/**
 * The member roster mutations - add a virtual (payer-only) member, rename, and
 * remove - plus the small pieces of inline-edit state the member list binds to:
 * which row is mid-rename (renamingMemberId + its draft value) and which row is
 * one tap into a two-tap remove confirm (confirmingRemoveMemberId). Rename and
 * remove are mutually exclusive per row, so starting one clears the other.
 */
export function useMemberMutations({
  activeGroup,
  cloudStore,
  showToast,
  recordCloudActivity,
  beginAction,
  endAction,
  setDialog,
}: UseMemberMutationsDeps) {
  const [virtualMemberName, setVirtualMemberName] = useState("");
  const [renamingMemberId, setRenamingMemberId] = useState("");
  const [renameMemberValue, setRenameMemberValue] = useState("");
  const [confirmingRemoveMemberId, setConfirmingRemoveMemberId] = useState("");

  function resetMemberManagement() {
    setRenamingMemberId("");
    setRenameMemberValue("");
    setConfirmingRemoveMemberId("");
  }

  async function addVirtualMember() {
    if (!activeGroup || !cloudStore || !virtualMemberName.trim()) return;
    if (!beginAction("addVirtualMember")) return;
    const name = virtualMemberName.trim();

    try {
      await cloudStore.addVirtualMember(activeGroup.id, name);
      recordCloudActivity(activeGroup.id, `${text.addVirtualMember}: ${name}`);
      setVirtualMemberName("");
      setDialog(null);
      showToast(`${text.addVirtualMember}: ${name}`);
    } catch (error) {
      showToast(`${text.cloudSyncFailedPrefix}${(error as Error).message}`);
    } finally {
      endAction();
    }
  }

  function startRenameMember(member: Member) {
    setConfirmingRemoveMemberId("");
    setRenamingMemberId(member.id);
    setRenameMemberValue(member.name);
  }

  function cancelRenameMember() {
    setRenamingMemberId("");
    setRenameMemberValue("");
  }

  async function submitRenameMember(member: Member) {
    if (!activeGroup || !cloudStore) return;
    const name = renameMemberValue.trim();
    if (!name) return;
    if (name === member.name) {
      cancelRenameMember();
      return;
    }
    if (!beginAction(`renameMember:${member.id}`)) return;

    try {
      await cloudStore.renameMember(activeGroup.id, member.id, name);
      recordCloudActivity(activeGroup.id, `${text.renameMember}: ${member.name} → ${name}`);
      cancelRenameMember();
      showToast(text.memberRenamed);
    } catch (error) {
      showToast(`${text.cloudSyncFailedPrefix}${(error as Error).message}`);
    } finally {
      endAction();
    }
  }

  async function removeMember(member: Member) {
    if (!activeGroup || !cloudStore) return;
    if (confirmingRemoveMemberId !== member.id) {
      setRenamingMemberId("");
      setRenameMemberValue("");
      setConfirmingRemoveMemberId(member.id);
      return;
    }
    if (!beginAction(`removeMember:${member.id}`)) return;

    try {
      await cloudStore.removeMember(activeGroup.id, member.id);
      recordCloudActivity(activeGroup.id, `${text.removeMember}: ${member.name}`);
      setConfirmingRemoveMemberId("");
      showToast(text.memberRemoved);
    } catch (error) {
      const code = (error as { code?: string }).code;
      setConfirmingRemoveMemberId("");
      showToast(
        code === "MEMBER_HAS_BALANCE"
          ? text.memberHasBalance
          : `${text.cloudSyncFailedPrefix}${(error as Error).message}`,
      );
    } finally {
      endAction();
    }
  }

  return {
    virtualMemberName,
    setVirtualMemberName,
    renamingMemberId,
    renameMemberValue,
    setRenameMemberValue,
    confirmingRemoveMemberId,
    resetMemberManagement,
    addVirtualMember,
    startRenameMember,
    cancelRenameMember,
    submitRenameMember,
    removeMember,
  };
}
