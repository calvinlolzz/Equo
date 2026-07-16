import { useState } from "react";
import type { CloudGroupsStore } from "./cloudStore";
import type { DialogMode, Group } from "./appTypes";
import { describeCloudActionError } from "./describeCloudActionError";
import { downscaleImageFileToDataUrl } from "./expenseImage";
import type { ToastAction } from "./useToast";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

type UseGroupMutationsDeps = {
  activeGroup: Group | null;
  cloudStore: CloudGroupsStore | null;
  showToast: (message: string, action?: ToastAction) => void;
  recordCloudActivity: (groupId: string, activityText: string) => void;
  beginAction: (key: string) => boolean;
  endAction: () => void;
  setDialog: (dialog: DialogMode) => void;
  setBusy: (busy: boolean) => void;
  openGroup: (groupId: string, mode?: "push" | "replace") => void;
  closeGroup: (mode?: "push" | "replace") => void;
  loadArchivedGroups: () => void | Promise<void>;
};

/**
 * Creating, renaming/re-covering, archiving and deleting a group, plus the form
 * state the create/edit dialogs bind to (name and the two cover fields:
 * groupCoverDataUrl is a freshly-picked local image awaiting upload,
 * groupCoverUrl is the already-hosted cover being edited).
 *
 * Archive/delete/rename are owner-only server-side; describeCloudActionError
 * maps that 403 to a specific toast rather than the generic sync-failed wording.
 */
export function useGroupMutations({
  activeGroup,
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
}: UseGroupMutationsDeps) {
  const [groupName, setGroupName] = useState<string>("");
  const [groupCoverDataUrl, setGroupCoverDataUrl] = useState<string>("");
  const [groupCoverUrl, setGroupCoverUrl] = useState<string>("");

  async function createGroup() {
    if (!cloudStore) return;
    // Require a typed, non-empty name - the template no longer supplies a
    // fallback, so an empty field must not silently create a group named
    // after the template placeholder.
    const name = groupName.trim();
    if (!name) return;
    // Synchronous guard checked before anything else, including the
    // cloudStore null-check above having already run: two fast clicks both
    // enter this function, but only the first passes beginAction.
    if (!beginAction("createGroup")) return;
    const pickedCover = groupCoverDataUrl;

    try {
      const group = await cloudStore.createGroup({ name, currency: "TWD" });
      openGroup(group.id, "replace");
      setDialog(null);
      setGroupName("");
      setGroupCoverDataUrl("");
      setGroupCoverUrl("");
      showToast(`${text.createGroup}: ${name}`);

      if (pickedCover) {
        try {
          const uploadedUrl = await cloudStore.uploadGroupImage(group.id, "cover", pickedCover);
          await cloudStore.updateGroupCover(group.id, name, uploadedUrl);
        } catch {
          showToast(text.coverUploadFailedAfterCreate);
        }
      }
    } catch (error) {
      showToast(`${text.cloudSyncFailedPrefix}${(error as Error).message}`);
    } finally {
      endAction();
    }
  }

  function openCreateGroupDialog() {
    // Start from a clean slate so a name left over from a prior edit (or a
    // previous create) never leaks into the create form.
    setGroupName("");
    setGroupCoverDataUrl("");
    setGroupCoverUrl("");
    setDialog("createGroup");
  }

  function openEditGroup() {
    if (!activeGroup) return;
    setGroupName(activeGroup.name);
    setGroupCoverDataUrl("");
    setGroupCoverUrl(activeGroup.coverImageUrl ?? "");
    setDialog("editGroup");
  }

  async function handleGroupCoverPick(file: File | null) {
    if (!file) return;
    try {
      const dataUrl = await downscaleImageFileToDataUrl(file);
      setGroupCoverDataUrl(dataUrl);
    } catch {
      showToast(text.photoError);
    }
  }

  async function updateActiveGroup() {
    if (!activeGroup || !cloudStore) return;
    const name = groupName.trim();
    if (!name) return;
    if (!beginAction("editGroup")) return;

    setBusy(true);
    try {
      if (groupCoverDataUrl) {
        const uploadedUrl = await cloudStore.uploadGroupImage(activeGroup.id, "cover", groupCoverDataUrl);
        await cloudStore.updateGroupCover(activeGroup.id, name, uploadedUrl);
      } else {
        await cloudStore.renameGroup(activeGroup.id, name);
      }
      recordCloudActivity(activeGroup.id, `${text.editGroup}: ${name}`);
      setDialog(null);
      setGroupCoverDataUrl("");
      showToast(`${text.editGroup}: ${name}`);
    } catch (error) {
      showToast(describeCloudActionError(error));
    } finally {
      setBusy(false);
      endAction();
    }
  }

  function openArchivedGroups() {
    if (!cloudStore) return;
    setDialog("archivedList");
    void loadArchivedGroups();
  }

  async function archiveActiveGroup() {
    if (!activeGroup || !cloudStore) return;
    if (!beginAction("archiveGroup")) return;
    setBusy(true);

    try {
      await cloudStore.archiveGroup(activeGroup.id);
      closeGroup();
      setDialog(null);
      showToast(`${text.archiveGroup}: ${activeGroup.name}`);
    } catch (error) {
      showToast(describeCloudActionError(error));
    }
    setBusy(false);
    endAction();
  }

  async function deleteActiveGroup() {
    if (!activeGroup || !cloudStore) return;
    if (!beginAction("deleteGroup")) return;

    try {
      await cloudStore.deleteGroup(activeGroup.id);
      closeGroup();
      setDialog(null);
      showToast(`${text.deleteGroup}: ${activeGroup.name}`);
    } catch (error) {
      showToast(describeCloudActionError(error));
    } finally {
      endAction();
    }
  }

  return {
    groupName,
    setGroupName,
    groupCoverDataUrl,
    setGroupCoverDataUrl,
    groupCoverUrl,
    createGroup,
    openCreateGroupDialog,
    openEditGroup,
    handleGroupCoverPick,
    updateActiveGroup,
    openArchivedGroups,
    archiveActiveGroup,
    deleteActiveGroup,
  };
}
