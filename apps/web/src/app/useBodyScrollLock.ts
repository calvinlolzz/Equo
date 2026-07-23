import { useEffect } from "react";

/**
 * Locks background page scroll while `locked` is true — the app scrolls on the
 * window/<body> (`.pizo-home` is `overflow: visible` on mobile), so an open
 * bottom sheet, drawer or dialog would otherwise let the page behind it scroll
 * and rubber-band, one of the most obvious web-vs-native tells.
 *
 * Uses the position:fixed technique rather than `overflow: hidden` because iOS
 * Safari ignores `overflow: hidden` on <body> for touch scrolling. The current
 * scroll offset is pinned via `top` and restored on unlock, so opening/closing
 * an overlay never jumps the page. Inner `overflow: auto` scrollers (the sheet
 * body, drawer list, currency list) keep scrolling normally.
 *
 * Callers gate this to the mobile layout: on desktop, position:fixed on <body>
 * would collapse the scrollbar and shift the centred modal. No-op when
 * unlocked, and SSR/test-safe (guards `document`/`window`).
 */
export function useBodyScrollLock(locked: boolean): void {
  useEffect(() => {
    if (!locked || typeof document === "undefined" || typeof window === "undefined") return;

    const { body } = document;
    const scrollY = window.scrollY;
    // Width the classic (non-overlay) scrollbar was occupying. Removing it via
    // `overflow: hidden` would otherwise widen the page ~17px and jump it — so
    // reserve that gutter as padding while locked. 0 on overlay-scrollbar
    // platforms (most phones), which is exactly where no compensation is needed.
    const scrollbarGutter = window.innerWidth - document.documentElement.clientWidth;
    const previous = {
      position: body.style.position,
      top: body.style.top,
      left: body.style.left,
      right: body.style.right,
      width: body.style.width,
      overflow: body.style.overflow,
      paddingRight: body.style.paddingRight,
    };

    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.left = "0";
    body.style.right = "0";
    body.style.width = "100%";
    body.style.overflow = "hidden";
    if (scrollbarGutter > 0) body.style.paddingRight = `${scrollbarGutter}px`;

    return () => {
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.left = previous.left;
      body.style.right = previous.right;
      body.style.width = previous.width;
      body.style.overflow = previous.overflow;
      body.style.paddingRight = previous.paddingRight;
      // Restore the pre-lock scroll position. Only when it was non-zero: locking
      // from the top (the common case) needs no restore, and skipping it avoids
      // poking window.scrollTo under jsdom where it isn't implemented.
      if (scrollY > 0) {
        try {
          window.scrollTo(0, scrollY);
        } catch {
          // window.scrollTo is unimplemented under jsdom — ignore in tests.
        }
      }
    };
  }, [locked]);
}
