/**
 * One-time purge of the pre-rename localStorage keys.
 *
 * The project shipped earlier under the name "FloatPay" and wrote a set of
 * `floatpay-*` keys (floatpay-groups, floatpay-expenses, floatpay-users,
 * floatpay-settlements, floatpay-payments, ...). That prototype stored its
 * data purely on-device; the current app ("Equo") is cloud-first behind a
 * login wall and namespaces everything under `equo.*`. No code reads or
 * writes the old prefix anymore, so the leftover keys are pure dead weight -
 * and keeping two prefixes side by side invites the "I changed it but it
 * didn't take" class of bug the review report flagged (issue ⑤).
 *
 * We purge rather than migrate on purpose: the old data predates the cloud
 * data model and the accounts it belonged to, so importing it into the new
 * system would be meaningless at best and corrupting at worst.
 *
 * Idempotent and defensive: safe to call on every boot, a no-op once the
 * keys are gone, and it swallows any storage access error (private mode,
 * disabled storage) so it can never block the app from starting.
 */
const LEGACY_KEY_PREFIXES = ["floatpay-", "floatpay."];

export function purgeLegacyStorage(storage: Pick<Storage, "length" | "key" | "removeItem"> | null | undefined): void {
  if (!storage) return;

  try {
    const staleKeys: string[] = [];

    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key && LEGACY_KEY_PREFIXES.some((prefix) => key.startsWith(prefix))) {
        staleKeys.push(key);
      }
    }

    // Collect first, then delete: removing during the index walk above would
    // renumber the remaining keys and skip some.
    for (const key of staleKeys) {
      storage.removeItem(key);
    }
  } catch {
    // Storage unavailable (private mode / blocked) - nothing to clean up.
  }
}

export function purgeLegacyBrowserStorage(): void {
  if (typeof window === "undefined") return;

  try {
    // Reading window.localStorage itself throws (SecurityError) when storage
    // is blocked - e.g. Chrome's "block all cookies" or a locked-down webview.
    // This runs at boot before crash telemetry is installed, so a throw here
    // would blank the app with no report; guard the property access too.
    purgeLegacyStorage(window.localStorage);
  } catch {
    // Storage unavailable - nothing to clean up, and boot must not be blocked.
  }
}
