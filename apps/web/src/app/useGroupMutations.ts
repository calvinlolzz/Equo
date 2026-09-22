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
  /**
   * True when `activeGroup` is the caller's own personal ledger. Its name is
   * fixed server-side (handleUpdateGroup silently ignores whatever name is
   * sent), so updateActiveGroup skips the rename/cover branch entirely and
   * touches only the budget - see the plan's §4c.
   */
  activeIsPersonal?: boolean;
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
  /**
   * Hand a freshly picked cover to the crop sheet instead of using it as-is.
   * Optional: without it the photo is used as picked (the pre-cropper
   * behaviour), which is what keeps this hook usable on its own.
   */
  onCropRequested?: (dataUrl: string) => void;
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
  activeIsPersonal = false,
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
  onCropRequested,
}: UseGroupMutationsDeps) {
  const [groupName, setGroupName] = useState<string>("");
  /**
   * The 每月預算 box, held as the typed string rather than a number: "" has to
   * stay distinguishable from 0, because Number("") is 0 and that would read as
   * a budget of nothing instead of no budget.
   */
  const [monthlyBudget, setMonthlyBudget] = useState<string>("");
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
      showToast(describeCloudActionError(error));
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
    setMonthlyBudget(
      activeGroup.monthlyBudgetMinor ? String(activeGroup.monthlyBudgetMinor / 100) : "",
    );
    setGroupCoverDataUrl("");
    setGroupCoverUrl(activeGroup.coverImageUrl ?? "");
    setDialog("editGroup");
  }

  /**
   * A picked cover, downscaled and handed to the cropper rather than used as
   * it is. The cover renders at a fixed 16:9, so SOMETHING is going to crop
   * this photo — this is only about who decides what survives.
   *
   * onCropRequested is optional so the hook still works (and tests still pass)
   * where no cropper is mounted; without one the photo is used as picked, which
   * is exactly the old behaviour.
   */
  async function handleGroupCoverPick(file: File | null) {
    if (!file) return;
    try {
      const dataUrl = await downscaleImageFileToDataUrl(file);
      if (onCropRequested) onCropRequested(dataUrl);
      else setGroupCoverDataUrl(dataUrl);
    } catch {
      showToast(text.photoError);
    }
  }

  async function updateActiveGroup() {
    if (!activeGroup || !cloudStore) return;
    const name = groupName.trim();
    if (!name) return;

    // Empty box = clear the budget. Kept as a string in state so "" stays
    // distinguishable from 0 - Number("") is 0, which would be a budget of
    // nothing rather than no budget.
    const typed = monthlyBudget.trim();
    const budgetMinor = typed === "" ? null : Math.round(Number(typed) * 100);

    if (typed !== "" && (!Number.isFinite(budgetMinor) || (budgetMinor ?? 0) <= 0)) {
      showToast(UI_TEXT.budget.invalid);
      return;
    }

    if (!beginAction("editGroup")) return;

    setBusy(true);
    try {
      // A personal ledger's name is fixed server-side (handleUpdateGroup
      // silently ignores whatever name a request sends) - nothing to rename
      // or re-cover, only the budget below.
      if (!activeIsPersonal) {
        if (groupCoverDataUrl) {
          const uploadedUrl = await cloudStore.uploadGroupImage(activeGroup.id, "cover", groupCoverDataUrl);
          await cloudStore.updateGroupCover(activeGroup.id, name, uploadedUrl);
        } else {
          await cloudStore.renameGroup(activeGroup.id, name);
        }
      }

      // Separate call rather than folding it into the rename: the cover path
      // above already has its own endpoint, and this keeps a budget change
      // working the same way whichever branch ran.
      if ((activeGroup.monthlyBudgetMinor ?? null) !== budgetMinor) {
        await cloudStore.setMonthlyBudget(activeGroup.id, name, budgetMinor);
      }
      recordCloudActivity(activeGroup.id, `${text.editGroup}: ${name}`);
      setDialog(null);
      setGroupCoverDataUrl("");
      showToast(activeIsPersonal ? UI_TEXT.personalLedger.settingsSaved : `${text.editGroup}: ${name}`);
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
    monthlyBudget,
    setMonthlyBudget,
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
