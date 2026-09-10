import { useEffect, useRef } from "react";
import { matchAppShortcut } from "./appShortcuts.keys";

/**
 * Binds the app's two keyboard shortcuts to the window.
 *
 * On the window rather than a container, like the console's ⌘K: it has to work
 * with focus anywhere on the page, including nowhere in particular, which is
 * where focus sits after a click on the background.
 *
 * `enabled` is the other half of the safety story that matchAppShortcut cannot
 * see: a sheet, a drawer or the composer being open means the keystroke is
 * meant for whatever is on top, and there is nothing to shortcut to from the
 * login screen or from a group that has not loaded.
 */
export function useAppShortcuts({
  enabled,
  onNewExpense,
  onFocusSearch,
}: {
  enabled: boolean;
  onNewExpense: () => void;
  onFocusSearch: () => void;
}): void {
  /**
   * The handlers, held in a ref so the listener is bound once per `enabled`
   * change rather than on every render.
   *
   * Both callers pass a fresh closure each time — one of them is an inline
   * arrow — and with those in the dependency array this would add and remove a
   * window listener on every single render of the app.
   */
  const handlers = useRef({ onNewExpense, onFocusSearch });
  handlers.current = { onNewExpense, onFocusSearch };

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const shortcut = matchAppShortcut(event);
      if (!shortcut) return;

      // Only once it is going to be acted on. Calling this any earlier would
      // swallow the `/` of somebody typing a date into a filter.
      event.preventDefault();

      if (shortcut === "newExpense") handlers.current.onNewExpense();
      else handlers.current.onFocusSearch();
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
