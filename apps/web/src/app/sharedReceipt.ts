/**
 * Receiving a receipt from the OS share sheet (Web Share Target).
 *
 * The manifest registers Equo as a target for images, so "分享" on a photo in
 * the gallery — or straight out of the camera roll — lists Equo alongside the
 * chat apps. Picking it lands in the composer with that photo already attached,
 * which is the shortest path from "I have a photo of the bill" to a recorded
 * expense that doesn't involve opening the app and hunting for a button.
 *
 * The awkward part is the handover. A share target that accepts files must be
 * declared `method: "POST"`, and a POST cannot be a URL the app simply reads on
 * boot. So the service worker intercepts that POST, parks the file in a cache,
 * and redirects to a plain GET the app *can* read (see sw.js). This module is
 * the app's half of that contract: the two constants below are duplicated in
 * sw.js by necessity — it is a classic worker script and cannot import — so
 * changing either one means changing both.
 */

/** Cache holding at most one handed-over file. Mirrored in sw.js. */
export const SHARE_CACHE_NAME = "equo-share-v1";

/** The single key inside that cache. Mirrored in sw.js. */
export const SHARE_CACHE_KEY = "/__shared-receipt";

/** The marker the worker redirects to once the file is parked. */
const SHARE_PARAM = "share";
const SHARE_VALUE = "receipt";

/** Whether this load is the tail end of a share, rather than an ordinary open. */
export function hasSharedReceipt(search: string): boolean {
  return new URLSearchParams(search).get(SHARE_PARAM) === SHARE_VALUE;
}

/**
 * Strips `?share=` once the handover has been consumed, so a reload doesn't
 * look like a second share. Mirrors clearShortcutParam: other parameters —
 * notably `?invite=` — are left alone.
 */
export function clearShareParam(): void {
  const url = new URL(window.location.href);
  if (!url.searchParams.has(SHARE_PARAM)) return;
  url.searchParams.delete(SHARE_PARAM);
  window.history.replaceState(window.history.state, document.title, `${url.pathname}${url.search}${url.hash}`);
}

type CacheStorageLike = Pick<CacheStorage, "open">;

function defaultCaches(): CacheStorageLike | null {
  return typeof caches === "undefined" ? null : caches;
}

/**
 * Collect the shared file, and take it out of the cache as we go.
 *
 * "Take", not "read": the parked file is one-shot. Leaving it behind would mean
 * the next cold start re-opens the composer on a receipt the user dealt with
 * days ago, and it would leave somebody's receipt sitting in cache storage
 * indefinitely for no further purpose. The delete therefore runs even when the
 * entry turns out to be unusable.
 *
 * Returns null for every failure mode — no worker ran, nothing was parked, the
 * cache is unreadable — because the caller's fallback in all of them is the
 * same: carry on as a normal app launch.
 */
export async function takeSharedReceiptFile(
  cacheStorage: CacheStorageLike | null = defaultCaches(),
): Promise<File | null> {
  if (!cacheStorage) return null;

  try {
    const cache = await cacheStorage.open(SHARE_CACHE_NAME);
    const response = await cache.match(SHARE_CACHE_KEY);
    await cache.delete(SHARE_CACHE_KEY);
    if (!response) return null;

    const blob = await response.blob();
    if (blob.size === 0) return null;

    const type = blob.type || response.headers.get("content-type") || "image/jpeg";
    return new File([blob], "shared-receipt", { type });
  } catch {
    return null;
  }
}
