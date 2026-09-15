import { useCallback, useEffect, useRef, type Ref } from "react";

const FOCUSABLE_SELECTOR =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * Combine several refs (callback or object) into one. Memoise the result
 * (useMemo over the input refs) before spreading onto an element, or a fresh
 * function every render would detach/reattach the node each time.
 */
export function mergeRefs<T>(...refs: Array<Ref<T> | undefined>) {
  return (node: T | null) => {
    for (const ref of refs) {
      if (typeof ref === "function") ref(node);
      else if (ref && typeof ref === "object") (ref as { current: T | null }).current = node;
    }
  };
}

/** Longest sheet entrance in the stylesheets; the timer below is its backstop. */
const ENTRANCE_MS = 260;

/**
 * Flag a dialog as "travelling" for the length of its entrance.
 *
 * `.is-entering` used to be the hook a CSS rule read to drop `.glass-panel`'s
 * backdrop blur while the sheet was moving — the aurora redesign removed that
 * blur outright (see --card-solid in app-base.css), so the rule is gone and
 * this class is currently a no-op on the CSS side. Left in place rather than
 * pulled: `.closing` (added the same way, for the mirror case) still has a
 * live consumer (`.flow-dialog.closing` / `.panel-dialog.closing`), the two
 * share this plumbing, and a blur-conditional rule keyed on `.is-entering` is
 * exactly the kind of thing a future stage might reintroduce.
 */
function markEntering(node: HTMLElement, stop: { current: (() => void) | null }): void {
  stop.current?.();
  node.classList.add("is-entering");

  const settle = () => {
    stop.current = null;
    node.removeEventListener("animationend", onEnd);
    window.clearTimeout(timer);
    node.classList.remove("is-entering");
  };
  // Only this element's own entrance counts: animationend bubbles, and the
  // panel body inside runs its own fade (see .enter-content), which would
  // otherwise end the entrance early.
  const onEnd = (event: AnimationEvent) => {
    if (event.target === node) settle();
  };

  node.addEventListener("animationend", onEnd);
  // No entrance animation at all on a wide screen, and animationend never fires
  // for a reduced-motion user either.
  const timer = window.setTimeout(settle, ENTRANCE_MS + 60);
  stop.current = settle;
}

/**
 * The modal keyboard/focus contract for a dialog or drawer: when it opens focus
 * moves inside the panel; Escape closes it; Tab is trapped within; and on close
 * focus returns to whatever was focused before it opened. Spread the returned
 * ref onto the dialog element (merge with any gesture ref via mergeRefs).
 *
 * `onClose` should run the app's normal close path so the swipe-out animation
 * still plays. The key handler only acts while focus is inside THIS dialog, so
 * stacked dialogs each own their Escape without fighting each other, and an
 * autoFocus field inside the dialog is never overridden.
 */
export function useDialogChrome(onClose: () => void) {
  const nodeRef = useRef<HTMLElement | null>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const stopEntrance = useRef<(() => void) | null>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  const setDialogRef = useCallback((node: HTMLElement | null) => {
    if (node) {
      nodeRef.current = node;
      markEntering(node, stopEntrance);
      const active = document.activeElement;
      // Remember the trigger (only if focus is currently outside), then pull
      // focus in — unless an autoFocus field already claimed it.
      if (active instanceof HTMLElement && !node.contains(active)) {
        returnFocusRef.current = active;
      }
      if (!node.contains(document.activeElement)) {
        const first = node.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
        // preventScroll: focusing inside a mid-animation bottom sheet must not
        // scroll the viewport/sheet (which could jump a tall sheet out of view).
        (first ?? node).focus?.({ preventScroll: true });
      }
    } else {
      nodeRef.current = null;
      stopEntrance.current?.();
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      if (target && document.contains(target)) target.focus?.();
    }
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      // Never act mid-IME-composition: in a zh-Hant app, Escape dismisses the
      // input-method candidate window and must NOT close the dialog. (Chrome
      // reports key "Process" during composition; Firefox/Safari set isComposing.)
      if (event.isComposing || event.key === "Process") return;

      const node = nodeRef.current;
      if (!node || !node.isConnected) return;
      const active = document.activeElement as HTMLElement | null;
      // The dialog owns the keys while focus is inside it — and also when focus
      // has fallen back to <body>/<html>, which happens routinely when a click
      // lands on non-interactive dialog whitespace. Without that, Escape/Tab
      // would silently stop working after any such click.
      const focusOnBody = !active || active === document.body || active === document.documentElement;
      if (!node.contains(active) && !focusOnBody) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusables = Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetWidth > 0 || el.offsetHeight > 0 || el === active,
      );
      if (focusables.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      // Focus fell outside the dialog (onto body): pull it back to the near edge.
      if (!node.contains(active)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return;
      }
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return setDialogRef;
}
