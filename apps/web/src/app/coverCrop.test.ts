import { describe, expect, test } from "vitest";
import {
  CENTRED_VIEW,
  COVER_ASPECT,
  MAX_SCALE,
  clampOffset,
  clampScale,
  computeCoverCrop,
  displayOverflow,
  offsetDelta,
} from "./coverCrop";

/** A phone photo: 3024×4032, i.e. distinctly taller than the 16:9 cover. */
const PORTRAIT = { width: 3024, height: 4032 };
/** A landscape shot, wider than the cover. */
const LANDSCAPE = { width: 4000, height: 1500 };

describe("computeCoverCrop", () => {
  test("a portrait photo keeps its full width and loses height", () => {
    const crop = computeCoverCrop(PORTRAIT, CENTRED_VIEW)!;

    expect(crop.sw).toBe(PORTRAIT.width);
    expect(crop.sh).toBeCloseTo(PORTRAIT.width / COVER_ASPECT, 5);
    // Centred: equal amounts of the photo are dropped top and bottom.
    expect(crop.sy).toBeCloseTo((PORTRAIT.height - crop.sh) / 2, 5);
    expect(crop.sx).toBe(0);
  });

  test("a wide photo keeps its full height and loses width", () => {
    const crop = computeCoverCrop(LANDSCAPE, CENTRED_VIEW)!;

    expect(crop.sh).toBe(LANDSCAPE.height);
    expect(crop.sw).toBeCloseTo(LANDSCAPE.height * COVER_ASPECT, 5);
    expect(crop.sy).toBe(0);
  });

  test("the crop is always the cover's shape, whatever went in", () => {
    for (const image of [PORTRAIT, LANDSCAPE, { width: 1000, height: 1000 }]) {
      for (const scale of [1, 1.7, MAX_SCALE]) {
        const crop = computeCoverCrop(image, { scale, offsetX: 0, offsetY: 0 })!;
        expect(crop.sw / crop.sh).toBeCloseTo(COVER_ASPECT, 5);
      }
    }
  });

  test("the offset slides the window, and never off the image", () => {
    const top = computeCoverCrop(PORTRAIT, { scale: 1, offsetX: 0, offsetY: -1 })!;
    const bottom = computeCoverCrop(PORTRAIT, { scale: 1, offsetX: 0, offsetY: 1 })!;

    expect(top.sy).toBe(0);
    expect(bottom.sy + bottom.sh).toBeCloseTo(PORTRAIT.height, 5);

    // Out-of-range offsets are clamped rather than allowed to run off the edge,
    // which would hand drawImage a rectangle outside the bitmap.
    const overshot = computeCoverCrop(PORTRAIT, { scale: 1, offsetX: 0, offsetY: 12 })!;
    expect(overshot.sy).toBeCloseTo(bottom.sy, 5);
  });

  test("zooming in takes a smaller slice", () => {
    const wide = computeCoverCrop(PORTRAIT, CENTRED_VIEW)!;
    const close = computeCoverCrop(PORTRAIT, { scale: 2, offsetX: 0, offsetY: 0 })!;

    expect(close.sw).toBeCloseTo(wide.sw / 2, 5);
    expect(close.sh).toBeCloseTo(wide.sh / 2, 5);
  });

  test("an image with no area is refused rather than divided by", () => {
    expect(computeCoverCrop({ width: 0, height: 0 }, CENTRED_VIEW)).toBeNull();
  });
});

describe("displayOverflow", () => {
  const frame = { frameWidth: 320, frameHeight: 180 };

  test("a portrait photo is draggable vertically at zoom 1", () => {
    // The case the whole feature exists for. An earlier version derived the
    // pannable range from the zoom alone, which made this exactly 0 — the photo
    // was stuck showing its middle band and the drag did nothing.
    const overflow = displayOverflow({ ...frame, imageAspect: PORTRAIT.width / PORTRAIT.height, scale: 1 });

    expect(overflow.y).toBeGreaterThan(0);
    expect(overflow.x).toBe(0);
  });

  test("a wide photo is draggable horizontally at zoom 1", () => {
    const overflow = displayOverflow({ ...frame, imageAspect: LANDSCAPE.width / LANDSCAPE.height, scale: 1 });

    expect(overflow.x).toBeGreaterThan(0);
    expect(overflow.y).toBe(0);
  });

  test("a photo already the cover's shape has nothing to pan until it is zoomed", () => {
    const flush = displayOverflow({ ...frame, imageAspect: COVER_ASPECT, scale: 1 });
    const zoomed = displayOverflow({ ...frame, imageAspect: COVER_ASPECT, scale: 2 });

    expect(flush).toEqual({ x: 0, y: 0 });
    expect(zoomed.x).toBeCloseTo(320, 5);
    expect(zoomed.y).toBeCloseTo(180, 5);
  });

  test("a frame that has not been measured yet reports no room, not NaN", () => {
    expect(displayOverflow({ frameWidth: 0, frameHeight: 0, imageAspect: 1.5, scale: 1 })).toEqual({ x: 0, y: 0 });
  });
});

describe("offsetDelta", () => {
  test("dragging across the whole overflow moves the full range", () => {
    // -1 → 1 is two offset units, so a drag equal to the overflow is 2.
    expect(offsetDelta(-100, 100)).toBeCloseTo(2, 5);
    expect(offsetDelta(100, 100)).toBeCloseTo(-2, 5);
  });

  test("dragging the picture right reveals what was off its left", () => {
    expect(offsetDelta(20, 200)).toBeLessThan(0);
  });

  test("no overflow means no movement", () => {
    expect(offsetDelta(50, 0)).toBe(0);
  });
});

describe("clamps", () => {
  test("scale stays inside the usable range", () => {
    expect(clampScale(0.2)).toBe(1);
    expect(clampScale(99)).toBe(MAX_SCALE);
    expect(clampScale(Number.NaN)).toBe(1);
  });

  test("offset stays inside the frame", () => {
    expect(clampOffset(-4)).toBe(-1);
    expect(clampOffset(4)).toBe(1);
    expect(clampOffset(Number.NaN)).toBe(0);
  });
});
