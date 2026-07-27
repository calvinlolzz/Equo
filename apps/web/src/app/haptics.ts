/**
 * Short vibration feedback for actions that change money.
 *
 * Scope, stated plainly: `navigator.vibrate` is an Android thing. iOS Safari
 * has never implemented it and there is no web API that reaches the iPhone's
 * Taptic Engine, so on iPhone every call here is a silent no-op. That is worth
 * doing anyway - Android is most of the web's phone traffic - but it is not a
 * cross-platform "native feel" fix, and nothing in the UI should depend on the
 * buzz having happened.
 *
 * Patterns are deliberately tiny. A confirmation should register as a tap on
 * the wrist, not a phone-call buzz; anything longer reads as an error even when
 * it isn't.
 */

/** What just happened, not how long to buzz - callers never pick durations. */
export type HapticKind = "success" | "warning";

const PATTERNS: Record<HapticKind, number | number[]> = {
  /** One short tick: an expense saved, a debt settled. */
  success: 12,
  /** Two ticks: destructive or undoable (a delete), so it feels different. */
  warning: [10, 60, 10],
};

type VibrateCapable = { vibrate?: (pattern: number | number[]) => boolean };

/**
 * Whether to stay silent. There is no "prefers-reduced-haptics" media query, so
 * reduced-motion is used as the closest standing signal that the user wants
 * less sensory feedback from interfaces - someone who turned it on to stop
 * things moving is not asking for their phone to buzz instead.
 */
function prefersQuiet(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

/**
 * Buzz, if the device can and the user hasn't asked for quiet. Never throws:
 * some browsers reject vibrate() outside a user gesture, and a failed haptic
 * must never take down the action that triggered it.
 */
export function haptic(kind: HapticKind, navigatorLike: VibrateCapable | undefined = globalThis.navigator): void {
  if (!navigatorLike?.vibrate) return;
  if (prefersQuiet()) return;

  try {
    navigatorLike.vibrate(PATTERNS[kind]);
  } catch {
    // Ignore - unsupported, blocked, or not user-initiated.
  }
}
