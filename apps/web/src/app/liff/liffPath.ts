/** `/liff` and anything under it, any case, with or without a trailing slash. Mirrors isLineLinkPath. */
export function isLiffPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "").toLowerCase();
  return path === "/liff" || path.startsWith("/liff/");
}

/**
 * Set (in sessionStorage, so per tab) once a LIFF boot has reached `ready`.
 * Lives here, not in liffBoot.ts, so main.tsx can read it without pulling the
 * boot machinery into the entry chunk.
 */
export const LIFF_BOOTED_KEY = "equo.liff.booted";

/**
 * A reload of the page LIFF rewrote its address to (/group/<ledger>), in a tab
 * that already booted LIFF. The ordinary app would render its Google login
 * there, which cannot work inside LINE (disallowed_useragent) - so the answer
 * is to go back through /liff, which signs in again from LINE's own ID token and
 * re-derives the ledger. Tab-scoped, so a normal browser tab never matches.
 * Fails to "no" when storage cannot be read.
 */
export function shouldReturnToLiff(pathname: string, storage: Pick<Storage, "getItem"> | null): boolean {
  if (!/^\/group\//.test(pathname) || !storage) return false;

  try {
    return storage.getItem(LIFF_BOOTED_KEY) === "1";
  } catch {
    return false;
  }
}
