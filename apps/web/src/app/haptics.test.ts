// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { haptic } from "./haptics";

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: reduce && query.includes("reduced-motion"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("haptic", () => {
  test("buzzes with a distinct pattern per kind", () => {
    stubReducedMotion(false);
    const vibrate = vi.fn((_pattern: number | number[]) => true);

    haptic("success", { vibrate });
    haptic("warning", { vibrate });

    expect(vibrate).toHaveBeenCalledTimes(2);
    const [success, warning] = vibrate.mock.calls.map(([pattern]) => pattern);
    // A delete must not feel identical to a save.
    expect(success).not.toEqual(warning);
  });

  test("stays silent where the API does not exist (every iPhone)", () => {
    stubReducedMotion(false);

    // No throw, no crash - the action that triggered it carries on.
    expect(() => haptic("success", {})).not.toThrow();
    expect(() => haptic("success", undefined)).not.toThrow();
  });

  test("stays silent when the user asked for reduced motion", () => {
    stubReducedMotion(true);
    const vibrate = vi.fn((_pattern: number | number[]) => true);

    haptic("success", { vibrate });

    expect(vibrate).not.toHaveBeenCalled();
  });

  test("a browser that refuses vibrate() never breaks the caller", () => {
    stubReducedMotion(false);
    const vibrate = vi.fn(() => {
      throw new Error("blocked outside a user gesture");
    });

    expect(() => haptic("success", { vibrate })).not.toThrow();
  });
});
