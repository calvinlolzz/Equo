import { useLayoutEffect } from "react";

/**
 * Locks background page scroll while `locked` is true (an overlay is open on the
 * mobile layout).
 *
 * Uses `overflow: hidden` on <html>/<body> rather than the position:fixed
 * technique. Pinning <body> with position:fixed triggers an async iOS viewport
 * reflow that made the safe-area-padded bottom sheet visibly jump ("上下跳動")
 * the instant it opened in standalone PWA — and because that reflow is the
 * browser's, no amount of React timing (useLayoutEffect included) prevents it.
 * `overflow: hidden` reliably blocks scrolling in the standalone webview and
 * in-app browsers with NO reflow and no scroll-offset juggling, so there is
 * nothing to jump; the open sheet's own `overscroll-behavior: none` covers the
 * rare bleed-through in mobile Safari.
 *
 * Runs as a layout effect (applied before paint) and is gated to the mobile
 * layout by the caller (on desktop, hiding root overflow would remove the
 * scrollbar and shift the centred modal). SSR/test-safe (guards `document`).
 */
export function useBodyScrollLock(locked: boolean): void {
  useLayoutEffect(() => {
    if (!locked || typeof document === "undefined") return;

    const root = document.documentElement;
    const { body } = document;
    const previousRootOverflow = root.style.overflow;
    const previousBodyOverflow = body.style.overflow;

    root.style.overflow = "hidden";
    body.style.overflow = "hidden";

    return () => {
      root.style.overflow = previousRootOverflow;
      body.style.overflow = previousBodyOverflow;
    };
  }, [locked]);
}
