import { useEffect, useState } from "react";

const MOBILE_QUERY = "(max-width: 960px)";

/**
 * Tracks the responsive breakpoint in JS, alongside the CSS that already
 * handles it. That duplication is deliberate: the desktop rails and the mobile
 * tab bar need to be made `inert`/`aria-hidden` when they're hidden, and a
 * `display: none` in CSS alone still leaves their buttons in the accessibility
 * tree and in the tab order.
 */
export function useIsMobileLayout(): boolean {
  const [isMobileLayout, setIsMobileLayout] = useState(
    () => typeof window !== "undefined" && window.matchMedia(MOBILE_QUERY).matches,
  );

  useEffect(() => {
    const query = window.matchMedia(MOBILE_QUERY);
    const update = () => setIsMobileLayout(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  return isMobileLayout;
}
