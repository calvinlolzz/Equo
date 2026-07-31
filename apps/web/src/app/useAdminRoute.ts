import { useCallback, useEffect, useState } from "react";
import {
  adminRouteToSearch,
  applyAdminRoutePatch,
  parseAdminRoute,
  type AdminRoute,
} from "./adminRoute";

/**
 * The console's route, kept in the address bar.
 *
 * pushState per navigation, so Back walks the console's own history instead of
 * leaving the page on the first press - the same reason the app itself has
 * useOverlayHistory. Everything that decides what a URL means lives in
 * adminRoute.ts; this hook is only the browser half.
 */
export function useAdminRoute(): [AdminRoute, (patch: Partial<AdminRoute>, options?: { replace?: boolean }) => void] {
  const [route, setRoute] = useState<AdminRoute>(() => parseAdminRoute(window.location.search));

  useEffect(() => {
    // Back/forward: the URL is the source of truth, so re-read rather than
    // trying to keep a parallel stack in sync with it.
    const onPopState = () => setRoute(parseAdminRoute(window.location.search));
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  const navigate = useCallback((patch: Partial<AdminRoute>, options: { replace?: boolean } = {}) => {
    setRoute((current) => {
      const next = applyAdminRoutePatch(current, patch);
      const url = `${window.location.pathname}${adminRouteToSearch(next)}`;

      // A no-op navigation (clicking the tab you are already on) must not push
      // a duplicate entry, or Back appears to do nothing.
      if (url === `${window.location.pathname}${window.location.search}`) {
        return current;
      }

      if (options.replace) {
        window.history.replaceState(null, "", url);
      } else {
        window.history.pushState(null, "", url);
      }

      return next;
    });
  }, []);

  return [route, navigate];
}
