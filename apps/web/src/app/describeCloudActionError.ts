import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

/**
 * Group rename/cover, archive, unarchive, and delete are owner-only on the
 * backend (see server/handlers/groups.ts's requireGroupOwner). The frontend
 * already hides the triggers for non-owners, but a stale UI state (e.g. a
 * cached member list, or ownership changing in another tab) can still let a
 * non-owner reach the action - map that 403 to a clear, specific toast
 * instead of the generic "sync failed: <message>" wording.
 */
export function describeCloudActionError(error: unknown): string {
  const code = (error as { code?: string } | null)?.code;
  if (code === "FORBIDDEN") {
    return text.ownerOnlyAction;
  }
  return `${text.cloudSyncFailedPrefix}${(error as Error).message}`;
}
