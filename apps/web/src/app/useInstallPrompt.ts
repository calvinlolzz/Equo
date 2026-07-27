import { useCallback, useEffect, useState } from "react";

export const INSTALL_DISMISSED_KEY = "equo.clean.install_dismissed";

/**
 * The event Chromium fires when a site meets the install criteria. Not in
 * lib.dom, because it is not a standard — which is the whole reason the iOS
 * branch below exists.
 */
type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

/**
 * - `unavailable` — already installed, dismissed, or a browser with no path.
 * - `installable` — Chromium handed us a prompt we can fire on a tap.
 * - `manual` — iOS Safari: installable by hand, but there is NO API, so the
 *   only thing we can offer is instructions.
 */
export type InstallState = "unavailable" | "installable" | "manual";

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  // iOS uses a non-standard navigator flag; everyone else has the media query.
  const iosStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return iosStandalone || window.matchMedia("(display-mode: standalone)").matches;
}

function isIosSafari(): boolean {
  if (typeof window === "undefined") return false;
  const ua = window.navigator.userAgent;
  const isIos = /iphone|ipad|ipod/i.test(ua) ||
    // iPadOS 13+ reports as a Mac; the touch points give it away.
    (/macintosh/i.test(ua) && window.navigator.maxTouchPoints > 1);
  if (!isIos) return false;
  // Chrome/Firefox on iOS are Safari underneath but cannot add to the home
  // screen from their own share sheet, so the instructions would be wrong.
  return !/crios|fxios|edgios/i.test(ua);
}

function wasDismissed(): boolean {
  try {
    return window.localStorage.getItem(INSTALL_DISMISSED_KEY) === "1";
  } catch {
    // Private mode / storage disabled: treat as not dismissed rather than
    // throwing. Worst case the hint shows again.
    return false;
  }
}

/**
 * Offers "add to home screen", once, without nagging.
 *
 * Two entirely different mechanisms hide behind one state: Chromium lets us
 * capture `beforeinstallprompt` and fire it on a tap, while iOS Safari has no
 * install API whatsoever and can only be told what to tap. Anything else
 * (Firefox, an in-app webview, an already-installed window) reports
 * `unavailable` and shows nothing.
 *
 * A dismissal is remembered forever — being asked twice to install an app is
 * how a prompt turns into an annoyance.
 */
export function useInstallPrompt() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [installed, setInstalled] = useState(true);

  useEffect(() => {
    setDismissed(wasDismissed());
    setInstalled(isStandalone());

    const onBeforeInstallPrompt = (event: Event) => {
      // Stop Chromium's own mini-infobar; we present this at our own moment.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    };
    const onInstalled = () => {
      setInstalled(true);
      setDeferred(null);
    };

    window.addEventListener("beforeinstallprompt", onBeforeInstallPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstallPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      window.localStorage.setItem(INSTALL_DISMISSED_KEY, "1");
    } catch {
      // Storage unavailable — the hint stays gone for this session at least.
    }
  }, []);

  /** Fire Chromium's install dialog. Either outcome retires the hint. */
  const promptInstall = useCallback(async () => {
    if (!deferred) return;
    try {
      await deferred.prompt();
      await deferred.userChoice;
    } catch {
      // The prompt can only be used once, and can reject if already consumed.
    }
    setDeferred(null);
    dismiss();
  }, [deferred, dismiss]);

  const state: InstallState = installed || dismissed
    ? "unavailable"
    : deferred
      ? "installable"
      : isIosSafari()
        ? "manual"
        : "unavailable";

  return { state, promptInstall, dismiss };
}
