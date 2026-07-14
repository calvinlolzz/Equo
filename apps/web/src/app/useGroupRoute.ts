import { useCallback, useEffect, useState } from "react";

export type RouteMode = "push" | "replace";

/** The open group, read out of `/group/:groupId`. Empty string means the home screen. */
export function readRouteGroupId(): string {
  const match = window.location.pathname.match(/^\/group\/([^/]+)$/);
  return match ? decodeURIComponent(match[1]) : "";
}

function writeGroupRoute(groupId: string | null, mode: RouteMode): void {
  const nextPath = groupId ? `/group/${encodeURIComponent(groupId)}` : "/";
  if (window.location.pathname === nextPath) return;

  if (mode === "replace") {
    window.history.replaceState(null, document.title, nextPath);
  } else {
    window.history.pushState(null, document.title, nextPath);
  }
}

/**
 * The open group and the URL, kept as one thing.
 *
 * They were two: every call site set the state and pushed the history entry
 * separately, and nothing listened for `popstate` - so opening a group pushed an
 * entry onto the history stack that the Back button could return to, and
 * returning to it changed the URL while the UI carried on showing the group the
 * user had just backed out of. Owning both here means a navigation cannot update
 * one and forget the other, and the browser's own buttons work.
 */
export function useGroupRoute() {
  const [activeGroupId, setActiveGroupId] = useState(readRouteGroupId);

  useEffect(() => {
    const syncFromLocation = () => setActiveGroupId(readRouteGroupId());
    window.addEventListener("popstate", syncFromLocation);
    return () => window.removeEventListener("popstate", syncFromLocation);
  }, []);

  const openGroup = useCallback((groupId: string, mode: RouteMode = "push") => {
    setActiveGroupId(groupId);
    writeGroupRoute(groupId, mode);
  }, []);

  const closeGroup = useCallback((mode: RouteMode = "push") => {
    setActiveGroupId("");
    writeGroupRoute(null, mode);
  }, []);

  return { activeGroupId, openGroup, closeGroup };
}
