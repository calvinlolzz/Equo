/**
 * A synchronous single-flight guard for mutation buttons (create group, save,
 * archive/delete confirm, settle, join group, etc). Two rapid clicks on the
 * same control both fire their handlers in the same tick, before React can
 * re-render the button as disabled - a `useState`-only busy flag doesn't
 * close that race because `setState` never applies synchronously inside the
 * handler that called it. This guard uses a plain mutable field instead, so
 * `begin` both checks and claims the lock atomically within a single
 * synchronous call.
 *
 * Usage: pair one instance with a `useRef` in the component (see App.tsx's
 * `actionGuardRef`), call `begin(key)` at the very top of a handler (before
 * any `await` or state update) and bail out if it returns false, then call
 * `end()` in a `finally` block once the mutation settles.
 */
export function createActionGuard() {
  let current: string | null = null;

  return {
    /** Returns true and claims the lock if nothing is in flight, false otherwise. */
    begin(key: string): boolean {
      if (current) return false;
      current = key;
      return true;
    },
    end() {
      current = null;
    },
    get current() {
      return current;
    },
  };
}

export type ActionGuard = ReturnType<typeof createActionGuard>;
