import { describe, expect, test } from "vitest";
import { IDLE_FREEZE_MS, shouldAnimate, type AnimationGate } from "./GlassBackground";

/** All four gates open: on screen, foregrounded, unobstructed, just touched. */
const running: AnimationGate = {
  visible: true,
  documentHidden: false,
  overlayPaused: false,
  msSinceInteraction: 0,
};

describe("shouldAnimate", () => {
  test("draws when nothing is in the way", () => {
    expect(shouldAnimate(running)).toBe(true);
  });

  test("each gate independently stops the loop", () => {
    expect(shouldAnimate({ ...running, visible: false })).toBe(false);
    expect(shouldAnimate({ ...running, documentHidden: true })).toBe(false);
    expect(shouldAnimate({ ...running, overlayPaused: true })).toBe(false);
    expect(shouldAnimate({ ...running, msSinceInteraction: IDLE_FREEZE_MS + 1 })).toBe(false);
  });

  test("keeps drawing right up to the idle deadline, and stops past it", () => {
    expect(shouldAnimate({ ...running, msSinceInteraction: IDLE_FREEZE_MS - 1 })).toBe(true);
    expect(shouldAnimate({ ...running, msSinceInteraction: IDLE_FREEZE_MS })).toBe(true);
    expect(shouldAnimate({ ...running, msSinceInteraction: IDLE_FREEZE_MS + 1 })).toBe(false);
  });

  test("a fresh interaction is not enough on its own — the other gates still veto", () => {
    expect(shouldAnimate({ ...running, msSinceInteraction: 0, overlayPaused: true })).toBe(false);
    expect(shouldAnimate({ ...running, msSinceInteraction: 0, documentHidden: true })).toBe(false);
    expect(shouldAnimate({ ...running, msSinceInteraction: 0, visible: false })).toBe(false);
  });

  test("a long-idle screen stays frozen no matter how long it has been", () => {
    expect(shouldAnimate({ ...running, msSinceInteraction: 60 * 60 * 1000 })).toBe(false);
  });

  test("the idle window is short enough to matter on a phone", () => {
    // Not a style assertion: the whole point is that a session left open stops
    // costing GPU within seconds, not minutes. A regression that pushed this to
    // a minute would silently undo the fix.
    expect(IDLE_FREEZE_MS).toBeLessThanOrEqual(10_000);
  });
});
