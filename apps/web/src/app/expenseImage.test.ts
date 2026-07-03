import { describe, expect, test } from "vitest";
import { getDownscaledImageSize } from "./expenseImage";

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
});
