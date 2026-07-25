import { useEffect, useRef } from "react";

/**
 * One openable overlay (bottom sheet, drawer, dialog, composer). `close` is
 * only ever called by the Back button — the hook never re-opens a layer.
 */
export type OverlayLayer = {
  open: boolean;
  close: () => void;
};

/** The key our guard entries carry in `history.state`. */
const DEPTH_KEY = "equoOverlay";

/**
 * How many overlays the CURRENT history entry stands for. Anything that isn't
 * one of our guard entries (a group route push, the OAuth replaceState, the
 * entry the app was loaded on) reads as 0, which is exactly right: backing onto
 * it should leave no overlay open.
 */
function readHistoryDepth(): number {
  const state = window.history.state as { [DEPTH_KEY]?: unknown } | null;
  const depth = state?.[DEPTH_KEY];
  return typeof depth === "number" && depth > 0 ? depth : 0;
}

function writeHistoryDepth(depth: number, mode: "push" | "replace"): void {
  const state = { ...window.history.state, [DEPTH_KEY]: depth };
  // Same URL, new entry: the overlay is not a route, it's a layer on top of
  // one. Keeping the URL untouched means useGroupRoute's own popstate listener
  // sees no pathname change and stays out of the way.
  const write = mode === "push" ? window.history.pushState : window.history.replaceState;
  write.call(window.history, state, "", window.location.href);
}

/**
 * Makes the device Back button (and the iOS edge-swipe, and the desktop Back
 * button) close the open overlay instead of leaving the screen.
 *
 * Without this every sheet in the app is pure React state that history knows
 * nothing about, so Back while the expense composer is open navigates to the
 * previous group — or exits the installed PWA — and throws away a half-typed
 * expense. That is the single loudest "this is a website" tell on Android.
 *
 * How it works: `history.state` is the bookkeeping, not a counter of our own.
 * Opening the Nth overlay pushes a guard entry stamped with depth N; closing
 * one by any other means (X, backdrop, Esc, swipe, a successful submit) walks
 * the stack back down so no dead entries are left for Back to chew through.
 * Reading the target depth off the entry we landed on is what makes this
 * survive a group navigation that happens while a drawer is open: that push
 * carries no stamp, so it reads as depth 0 and we correctly do nothing rather
 * than un-navigating the user.
 *
 * @param layers Every overlay, ordered bottom of the stack to top. Back closes
 *   the topmost open one.
 */
export function useOverlayHistory(layers: OverlayLayer[]): void {
  const openLayers = layers.filter((layer) => layer.open);
  const depth = openLayers.length;

  // Read by the popstate listener, which subscribes once and must not be torn
  // down and rebuilt every time an overlay opens.
  const depthRef = useRef(depth);
  depthRef.current = depth;
  const closeTopRef = useRef<() => void>(() => {});
  closeTopRef.current = depth > 0 ? openLayers[depth - 1].close : () => {};

  // A reload restores history.state, so the entry the app boots on can still
  // carry a guard from before the reload while every overlay is closed. Clear
  // it in place — unwinding it would navigate away from the page just loaded.
  useEffect(() => {
    if (readHistoryDepth() > 0) writeHistoryDepth(0, "replace");
  }, []);

  useEffect(() => {
    const onPopState = () => {
      // Landed on an entry that stands for fewer overlays than are open: the
      // user pressed Back. Close one layer per press; the effect below then
      // finds history and state already in agreement and does nothing.
      if (depthRef.current > readHistoryDepth()) closeTopRef.current();
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    const historyDepth = readHistoryDepth();
    if (depth > historyDepth) {
      for (let next = historyDepth + 1; next <= depth; next += 1) {
        writeHistoryDepth(next, "push");
      }
      return;
    }
    if (depth < historyDepth) {
      // Closed without the Back button. Drop the now-meaningless guard entries
      // so the next Back press leaves the screen instead of appearing dead.
      window.history.go(depth - historyDepth);
    }
  }, [depth]);
}
