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
  // Writes are paused for maintenance. The copy says the entry is kept rather
  // than that something failed, because that is what happens: the write goes
  // into the offline queue and drains when the window ends (see
  // isRetryableError). Telling somebody their expense did not save, when it
  // will, would make them record it twice.
  // Not retryable, unlike MAINTENANCE: the answer is "leave the view", not
  // "try later", and the write is correctly dropped rather than queued.
  if (code === "VIEW_AS_READONLY") {
    return UI_TEXT.notice.viewAsBlocked;
  }
  if (code === "MAINTENANCE") {
    return UI_TEXT.notice.maintenanceWriteBlocked;
  }
  // Last admin-console owner tried to delete their account (409 from
  // DELETE /me) — a specific, actionable message, not the generic failure.
  if (code === "ACCOUNT_DELETE_BLOCKED") {
    return text.accountDeleteBlocked;
  }
  // A personal ledger rejected an invite/member/archive/delete attempt (409
  // from the server's guard - see handlers/groups.ts). The UI already hides
  // these triggers for a ledger; this only covers a stale render reaching
  // one anyway.
  if (code === "PERSONAL_LEDGER") {
    return UI_TEXT.personalLedger.actionUnavailable;
  }
  return `${text.cloudSyncFailedPrefix}${(error as Error).message}`;
}
