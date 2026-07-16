import { useRef, useState, type MutableRefObject } from "react";
import { createActionGuard, type ActionGuard } from "./actionGuard";

/**
 * The double-submit guard every mutation control goes through.
 *
 * Two layers, on purpose:
 * - actionGuardRef holds the synchronous guard (see actionGuard.ts). begin()/
 *   end() mutate a plain field, not React state, so two clicks in the same tick
 *   can't both pass - the second sees the field already set and bails.
 * - pendingAction (state) exists only to re-render the button into its busy
 *   label; it is deliberately NOT the gate, because a state update is async and
 *   would let both clicks through before the first re-render lands.
 *
 * The ref is returned too because the auto-sync loop reads it directly (skipping
 * a background refresh while a mutation is in flight) rather than via state.
 */
export function useActionGuard(): {
  pendingAction: string | null;
  actionGuardRef: MutableRefObject<ActionGuard>;
  beginAction: (key: string) => boolean;
  endAction: () => void;
} {
  const actionGuardRef = useRef(createActionGuard());
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  /**
   * Returns false (does nothing else) if an action is already in flight, so
   * callers can bail out before doing any work.
   */
  function beginAction(key: string): boolean {
    if (!actionGuardRef.current.begin(key)) return false;
    setPendingAction(key);
    return true;
  }

  function endAction() {
    actionGuardRef.current.end();
    setPendingAction(null);
  }

  return { pendingAction, actionGuardRef, beginAction, endAction };
}
