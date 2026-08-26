import { useCallback, useEffect, useState } from "react";
import { UI_TEXT } from "./uiText";

export type SiteNotice = {
  banner: { message: string; level: "info" | "warning"; ends_at: string | null; active: boolean };
  maintenance: { enabled: boolean; message: string };
};

const EMPTY: SiteNotice = {
  banner: { message: "", level: "info", ends_at: null, active: false },
  maintenance: { enabled: false, message: "" },
};

const DISMISSED_KEY = "equo.clean.noticeDismissed";

/**
 * How often to re-check while the app is open.
 *
 * Slow on purpose. The two moments that matter are covered by events rather
 * than by this timer - opening the app, and coming back to it - so the poll is
 * only there to catch a window that starts while somebody is sitting on the
 * screen. Two minutes is often enough for that and rare enough to be invisible
 * on a phone's battery.
 */
const POLL_MS = 120_000;

/**
 * A dismissed banner is remembered by its TEXT, not by a flag.
 *
 * A flag would mean the next announcement is hidden too, because the user
 * dismissed the previous one - the classic bug where the important message is
 * the one nobody sees. Keying on the message means a new message is a new
 * banner, and re-posting the same one stays dismissed.
 */
function dismissedMessage(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY);
  } catch {
    return null;
  }
}

function rememberDismissal(message: string): void {
  try {
    localStorage.setItem(DISMISSED_KEY, message);
  } catch {
    // Site data blocked. The banner reappears next load, which is a small
    // annoyance and much better than failing to render.
  }
}

export type SiteNoticeState = {
  /** The announcement to show, or null when there is nothing to say. */
  banner: { message: string; level: "info" | "warning" } | null;
  /** The maintenance notice, or null. Never dismissible - see below. */
  maintenance: { message: string } | null;
  /** True while an admin is looking at the app as somebody else. */
  viewingAs: boolean;
  dismissBanner: () => void;
};

export function useSiteNotice(
  fetchNotice: (() => Promise<{ notice: SiteNotice; view_as?: { active: boolean } | null }>) | null,
  pollMs = POLL_MS,
): SiteNoticeState {
  const [notice, setNotice] = useState<SiteNotice>(EMPTY);
  const [viewingAs, setViewingAs] = useState(false);
  const [dismissed, setDismissed] = useState<string | null>(() => dismissedMessage());

  useEffect(() => {
    if (!fetchNotice) return;

    let cancelled = false;

    const load = () => {
      fetchNotice()
        .then((result) => {
          if (cancelled) return;
          setNotice(result.notice ?? EMPTY);
          // Polled rather than read once: the token lapses after fifteen
          // minutes, and the banner has to stop claiming a view that has
          // already ended.
          setViewingAs(result.view_as?.active === true);
        })
        .catch(() => {
          // Silent. This is an extra on top of the app, and an app that shows
          // an error because it could not fetch an announcement nobody posted
          // is worse than one that shows nothing.
        });
    };

    load();

    const timer = window.setInterval(load, pollMs);
    // Coming back to a phone that has been in a pocket is the likeliest moment
    // for the notice to have changed since it was last read.
    const onVisible = () => {
      if (document.visibilityState === "visible") load();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchNotice, pollMs]);

  const dismissBanner = useCallback(() => {
    const message = notice.banner.message;
    if (!message) return;
    rememberDismissal(message);
    setDismissed(message);
  }, [notice.banner.message]);

  const bannerVisible = notice.banner.active && notice.banner.message !== dismissed;

  return {
    banner: bannerVisible ? { message: notice.banner.message, level: notice.banner.level } : null,
    /**
     * Maintenance is not dismissible, and that is the point: it explains why
     * the button the user just pressed did nothing. A dismissed explanation
     * leaves them with an app that silently refuses to save.
     */
    maintenance: notice.maintenance.enabled
      ? { message: notice.maintenance.message || UI_TEXT.notice.maintenanceFallback }
      : null,
    viewingAs,
    dismissBanner,
  };
}
