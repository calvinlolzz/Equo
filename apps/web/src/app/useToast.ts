import { useEffect, useRef, useState } from "react";

export type ToastAction = { label: string; onAction: () => void };

export type Toast = {
  id: number;
  text: string;
  action?: ToastAction;
};

/**
 * The one toast the app shows at a time. A new toast replaces the current one
 * and restarts the dismiss timer, so a burst of failures doesn't queue up.
 *
 * Actionable toasts (an undo, say) linger longer - the user has to reach the
 * button before it auto-dismisses.
 */
const PLAIN_TOAST_MS = 2600;
const ACTIONABLE_TOAST_MS = 6000;

export function useToast() {
  const [toast, setToast] = useState<Toast | null>(null);
  const timeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  function showToast(message: string, action?: ToastAction) {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    const id = Date.now();
    setToast({ id, text: message, action });
    timeoutRef.current = window.setTimeout(
      () => {
        // Only clear the toast this timer was started for - a newer toast has
        // its own timer and must not be cut short by this one.
        setToast((current) => (current?.id === id ? null : current));
      },
      action ? ACTIONABLE_TOAST_MS : PLAIN_TOAST_MS,
    );
  }

  return { toast, showToast };
}
