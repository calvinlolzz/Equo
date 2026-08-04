/**
 * Consent for sending a photographed receipt to the recognition model.
 *
 * The photo leaves this app for a third party, and on the free tier that
 * third party's own terms reserve the right to keep it, have people read it,
 * and train on it. A receipt is not an anonymous image: it carries where
 * somebody was, when, and what they bought. Sending that silently because a
 * shutter button was tapped is not a defensible default, whatever the privacy
 * policy says - so the first scan asks, in the place where the photo is about
 * to be taken.
 *
 * Stored per device rather than per account, deliberately: consent is being
 * given for what this camera captures, and a laptop the user has never scanned
 * on should ask again. It is also why revoking is a plain localStorage delete
 * with no server call - nothing to fail, nothing to be offline for.
 */
const SCAN_CONSENT_KEY = "equo.scanConsent.v1";

/** The stored marker's value. Only its presence is read; the date is for support. */
type ScanConsentRecord = { grantedAt: string };

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // Safari in private mode, and any browser with site data blocked.
    return null;
  }
}

/**
 * Unreadable storage means "not granted". Failing closed is the only safe
 * direction: the cost of asking twice is a tap, the cost of assuming consent
 * is somebody's receipt sitting on a stranger's server.
 */
export function hasScanConsent(storage: StorageLike | null = defaultStorage()): boolean {
  if (!storage) return false;
  try {
    return Boolean(storage.getItem(SCAN_CONSENT_KEY));
  } catch {
    return false;
  }
}

export function grantScanConsent(storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    const record: ScanConsentRecord = { grantedAt: new Date().toISOString() };
    storage.setItem(SCAN_CONSENT_KEY, JSON.stringify(record));
  } catch {
    // A browser that refuses the write simply asks again next time.
  }
}

export function revokeScanConsent(storage: StorageLike | null = defaultStorage()): void {
  if (!storage) return;
  try {
    storage.removeItem(SCAN_CONSENT_KEY);
  } catch {
    // Nothing to do - the next read failing closed has the same effect.
  }
}
