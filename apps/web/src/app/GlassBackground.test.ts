import { describe, expect, test } from "vitest";
import {
  IDLE_FREEZE_MS,
  IDLE_FREEZE_MS_POINTER,
  frameIntervalFor,
  isSoftwareRenderer,
  shouldAnimate,
  type AnimationGate,
} from "./GlassBackground";

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

  test("a mouse gets a much shorter budget than a finger", () => {
    // The reported symptom this exists for: on a desktop the cursor moves more
    // or less continuously while somebody reads, so the touch budget never
    // expires and the field never settles. Anything at or under the pointer
    // budget still draws; past it, it stops — even though a finger would still
    // have seconds left.
    const pointer = { ...running, idleFreezeMs: IDLE_FREEZE_MS_POINTER };

    expect(shouldAnimate({ ...pointer, msSinceInteraction: IDLE_FREEZE_MS_POINTER })).toBe(true);
    expect(shouldAnimate({ ...pointer, msSinceInteraction: IDLE_FREEZE_MS_POINTER + 1 })).toBe(false);
    // The same moment on touch is still well inside the window.
    expect(shouldAnimate({ ...running, msSinceInteraction: IDLE_FREEZE_MS_POINTER + 1 })).toBe(true);
    expect(IDLE_FREEZE_MS_POINTER).toBeLessThan(IDLE_FREEZE_MS);
  });

  test("omitting the budget falls back to the touch one", () => {
    expect(shouldAnimate({ ...running, msSinceInteraction: IDLE_FREEZE_MS })).toBe(true);
    expect(shouldAnimate({ ...running, msSinceInteraction: IDLE_FREEZE_MS + 1 })).toBe(false);
  });

  test("the idle window is short enough to matter on a phone", () => {
    // Not a style assertion: the whole point is that a session left open stops
    // costing GPU within seconds, not minutes. A regression that pushed this to
    // a minute would silently undo the fix.
    expect(IDLE_FREEZE_MS).toBeLessThanOrEqual(10_000);
  });
});

describe("isSoftwareRenderer", () => {
  test("recognises the renderers that mean there is no GPU", () => {
    // Real UNMASKED_RENDERER_WEBGL strings: Chrome's fallback, Mesa's, and the
    // one Windows reports with hardware acceleration switched off.
    expect(isSoftwareRenderer("Google SwiftShader")).toBe(true);
    expect(isSoftwareRenderer("ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))")).toBe(true);
    expect(isSoftwareRenderer("llvmpipe (LLVM 15.0.7, 256 bits)")).toBe(true);
    expect(isSoftwareRenderer("Microsoft Basic Render Driver")).toBe(true);
    expect(isSoftwareRenderer("Mesa OffScreen")).toBe(true);
  });

  test("leaves real GPUs alone", () => {
    // A false positive here costs every one of these machines the backdrop.
    expect(isSoftwareRenderer("Apple M2")).toBe(false);
    expect(isSoftwareRenderer("ANGLE (NVIDIA, NVIDIA GeForce RTX 4070 Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe(false);
    expect(isSoftwareRenderer("ANGLE (Intel, Intel(R) Iris(R) Xe Graphics Direct3D11 vs_5_0 ps_5_0, D3D11)")).toBe(false);
    expect(isSoftwareRenderer("Mali-G78")).toBe(false);
    expect(isSoftwareRenderer("")).toBe(false);
  });
});

describe("frameIntervalFor", () => {
  test("a cap becomes the gap between frames", () => {
    expect(frameIntervalFor(30)).toBeCloseTo(33.33, 1);
    expect(frameIntervalFor(24)).toBeCloseTo(41.67, 1);
  });

  test("zero means uncapped, which is the opposite of what it reads like", () => {
    // The desktop passes 0 on purpose. Anyone reading it as "zero frames a
    // second" and 'fixing' it would silently put the cap back.
    expect(frameIntervalFor(0)).toBe(0);
  });

  test("60 and above is uncapped too — vsync is already the limit", () => {
    expect(frameIntervalFor(60)).toBe(0);
    expect(frameIntervalFor(120)).toBe(0);
  });
});
