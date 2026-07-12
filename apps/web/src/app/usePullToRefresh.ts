import { useEffect, useRef, useState } from "react";

export type PullToRefreshStatus = "idle" | "pulling" | "armed" | "refreshing";

const PULL_THRESHOLD = 90;
const MOBILE_QUERY = "(max-width: 620px)";

function matches(query: string) {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

/**
 * Pull-to-refresh on the page scroll (mobile layout only). Attach nothing:
 * the hook listens on window while `enabled`, so the gesture works anywhere
 * on the home screen but never inside dialogs/drawers (the caller flips
 * `enabled` off while any overlay is open, and native pull-to-reload is
 * suppressed via overscroll-behavior in App.css).
 *
 * A pull only begins when the page is scrolled to the very top and moves
 * mostly vertically downward; crossing PULL_THRESHOLD arms it ("放開以重新整理"),
 * releasing while armed runs onRefresh and reports "refreshing" until it
 * settles. onRefresh failures just reset to idle - the caller surfaces its
 * own error toast.
 */
export function usePullToRefresh(enabled: boolean, onRefresh: () => Promise<void>) {
  const [status, setStatus] = useState<PullToRefreshStatus>("idle");
  const startY = useRef<number | null>(null);
  const startX = useRef(0);
  const vertical = useRef<boolean | null>(null);
  const armed = useRef(false);
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;

    function onTouchStart(event: TouchEvent) {
      if (!matches(MOBILE_QUERY)) return;
      if (window.scrollY > 0) return;
      startY.current = event.touches[0].clientY;
      startX.current = event.touches[0].clientX;
      vertical.current = null;
      armed.current = false;
    }

    function onTouchMove(event: TouchEvent) {
      if (startY.current === null) return;
      const deltaY = event.touches[0].clientY - startY.current;
      const deltaX = event.touches[0].clientX - startX.current;

      if (vertical.current === null) {
        if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
        vertical.current = Math.abs(deltaY) > Math.abs(deltaX);
      }
      if (!vertical.current || deltaY <= 0) return;

      const nowArmed = deltaY > PULL_THRESHOLD;
      if (nowArmed !== armed.current) {
        armed.current = nowArmed;
        setStatus(nowArmed ? "armed" : "pulling");
      } else if (!nowArmed && deltaY > 24) {
        // Show the hint only once a deliberate pull is underway; React bails
        // out on the repeated identical value, so this stays cheap.
        setStatus("pulling");
      }
    }

    function onTouchEnd() {
      if (startY.current === null) return;
      startY.current = null;
      vertical.current = null;

      if (!armed.current) {
        setStatus("idle");
        return;
      }
      armed.current = false;
      setStatus("refreshing");
      refreshRef.current()
        .catch(() => {})
        .finally(() => setStatus("idle"));
    }

    function onTouchCancel() {
      startY.current = null;
      vertical.current = null;
      armed.current = false;
      setStatus("idle");
    }

    window.addEventListener("touchstart", onTouchStart, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchend", onTouchEnd);
    window.addEventListener("touchcancel", onTouchCancel);
    return () => {
      window.removeEventListener("touchstart", onTouchStart);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchend", onTouchEnd);
      window.removeEventListener("touchcancel", onTouchCancel);
      startY.current = null;
      vertical.current = null;
      armed.current = false;
    };
  }, [enabled]);

  return status;
}
