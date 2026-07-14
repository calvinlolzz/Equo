import { useState } from "react";
import type { ArchivedGroupData, CloudGroupsStore } from "./cloudStore";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

type UseArchivedGroupsOptions = {
  cloudStore: CloudGroupsStore | null;
  showToast: (message: string) => void;
  describeError: (error: unknown) => string;
};

/**
 * The archived-groups list: loaded on demand when the dialog opens (it is not
 * part of the group list the app keeps in memory), and restorable one group at
 * a time.
 */
export function useArchivedGroups({ cloudStore, showToast, describeError }: UseArchivedGroupsOptions) {
  const [archivedGroups, setArchivedGroups] = useState<ArchivedGroupData[]>([]);
  const [loading, setLoading] = useState(false);
  const [unarchivingGroupId, setUnarchivingGroupId] = useState("");

  async function loadArchivedGroups() {
    if (!cloudStore) return;
    setLoading(true);
    try {
      setArchivedGroups(await cloudStore.listArchivedGroups());
    } catch (error) {
      showToast(`${text.cloudSyncFailedPrefix}${(error as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  async function unarchiveGroup(group: ArchivedGroupData) {
    if (!cloudStore || unarchivingGroupId) return;

    // Defence in depth: the restore button is only rendered for groups the
    // caller owns, but guard the handler directly too in case that ever drifts.
    if (group.callerMemberId !== group.ownerMemberId) {
      showToast(text.ownerOnlyAction);
      return;
    }

    setUnarchivingGroupId(group.id);
    try {
      await cloudStore.unarchiveGroup(group.id);
      setArchivedGroups((current) => current.filter((item) => item.id !== group.id));
      showToast(`${text.restoredGroupPrefix}${group.name}`);
    } catch (error) {
      showToast(describeError(error));
    } finally {
      setUnarchivingGroupId("");
    }
  }

  return { archivedGroups, loading, unarchivingGroupId, loadArchivedGroups, unarchiveGroup };
}
