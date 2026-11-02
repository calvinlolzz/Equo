/** `/liff` and anything under it, any case, with or without a trailing slash. Mirrors isLineLinkPath. */
export function isLiffPath(pathname: string): boolean {
  const path = pathname.replace(/\/+$/, "").toLowerCase();
  return path === "/liff" || path.startsWith("/liff/");
}
