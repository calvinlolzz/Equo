// @vitest-environment jsdom
import { describe, expect, test } from "vitest";
import { downscaleDataUrl, getDownscaledImageSize, RECEIPT_MAX_EDGE_PX } from "./expenseImage";

describe("getDownscaledImageSize", () => {
  test("leaves images at or under the max edge untouched", () => {
    expect(getDownscaledImageSize({ width: 400, height: 300 })).toEqual({ width: 400, height: 300 });
    expect(getDownscaledImageSize({ width: 720, height: 480 })).toEqual({ width: 720, height: 480 });
  });

  test("downscales the longest edge to the max while preserving aspect ratio", () => {
    expect(getDownscaledImageSize({ width: 1440, height: 960 })).toEqual({ width: 720, height: 480 });
    expect(getDownscaledImageSize({ width: 960, height: 1440 })).toEqual({ width: 480, height: 720 });
  });

  test("supports a custom max edge", () => {
    expect(getDownscaledImageSize({ width: 200, height: 100, maxEdge: 100 })).toEqual({ width: 100, height: 50 });
  });

  test("the capture size and the stored size are deliberately different numbers", () => {
    // The receipt is captured big enough for OCR and stored at the ordinary
    // photo size. If these ever converge, either recognition is reading a
    // too-small image or the records list is downloading 300 KB thumbnails.
    expect(RECEIPT_MAX_EDGE_PX).toBeGreaterThan(getDownscaledImageSize({ width: 10_000, height: 10_000 }).width);
  });
});

describe("downscaleDataUrl", () => {
  // These lean on jsdom never decoding an image: onload/onerror simply never
  // fire, which is exactly the "decoder that never calls back" case the
  // deadline exists for, and is otherwise hard to stage.

  test("an empty capture comes straight back, without waiting on a decode", async () => {
    const started = Date.now();

    await expect(downscaleDataUrl("")).resolves.toBe("");

    expect(Date.now() - started).toBeLessThan(200);
  });

  test("a decode that never calls back resolves to the original rather than hanging", async () => {
    const original = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";

    // The whole contract: the composer opens on this value, so it has to arrive.
    await expect(downscaleDataUrl(original)).resolves.toBe(original);
  }, 10_000);
});
