import { describe, expect, test } from "vitest";
import { syncAppBadge, type BadgeNavigator } from "./appBadge";

/** Records what the Badging API was asked to do, in order. */
function recorder(overrides: Partial<BadgeNavigator> = {}) {
  const calls: Array<{ method: "set" | "clear"; count?: number }> = [];
  const nav: BadgeNavigator = {
    setAppBadge: async (count) => {
      calls.push({ method: "set", count });
    },
    clearAppBadge: async () => {
      calls.push({ method: "clear" });
    },
    ...overrides,
  };
  return { calls, nav };
}

describe("syncAppBadge", () => {
  test("a positive count is badged as-is", () => {
    const { calls, nav } = recorder();

    syncAppBadge(3, nav);

    expect(calls).toEqual([{ method: "set", count: 3 }]);
  });

  test("zero clears the badge instead of showing a 0", () => {
    const { calls, nav } = recorder();

    syncAppBadge(0, nav);

    expect(calls).toEqual([{ method: "clear" }]);
  });

  test("a negative or non-finite count clears rather than badging nonsense", () => {
    const { calls, nav } = recorder();

    syncAppBadge(-2, nav);
    syncAppBadge(Number.NaN, nav);

    expect(calls).toEqual([{ method: "clear" }, { method: "clear" }]);
  });

  test("a fractional count is floored, never handed to the platform raw", () => {
    const { calls, nav } = recorder();

    syncAppBadge(2.7, nav);

    expect(calls).toEqual([{ method: "set", count: 2 }]);
  });

  test("a browser without the API is a no-op, not a crash", () => {
    expect(() => syncAppBadge(4, {})).not.toThrow();
    expect(() => syncAppBadge(0, {})).not.toThrow();
    expect(() => syncAppBadge(4, null)).not.toThrow();
  });

  test("iOS rejecting for want of notification permission is swallowed", async () => {
    const { nav } = recorder({
      setAppBadge: () => Promise.reject(new Error("NotAllowedError")),
    });

    expect(() => syncAppBadge(5, nav)).not.toThrow();
    // Give the rejection a turn to surface as an unhandled rejection if the
    // catch were missing.
    await Promise.resolve();
  });

  test("an implementation that throws synchronously is swallowed too", () => {
    const { nav } = recorder({
      setAppBadge: () => {
        throw new Error("locked down WebView");
      },
    });

    expect(() => syncAppBadge(5, nav)).not.toThrow();
  });
});
