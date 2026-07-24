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
  // Network/server failures carry an untranslated technical message ("Failed to
  // fetch", an HTML gateway page, ...). Map the codes the api client tags to
  // friendly localized copy instead of leaking the raw string into the toast.
  if (code === "NETWORK_ERROR") {
    return text.networkError;
  }
  if (code === "SERVER_ERROR") {
    return text.serverError;
  }
  // The rate limiter's 429. Distinct from serverError on purpose: nothing is
  // broken and retrying in a moment will work, so the copy says to wait rather
  // than implying an outage.
  if (code === "RATE_LIMITED") {
    return text.rateLimited;
  }
  return `${text.cloudSyncFailedPrefix}${(error as Error).message}`;
}
