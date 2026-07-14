// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { useIsMobileLayout } from "./useIsMobileLayout";

/**
 * jsdom has no layout engine and no matchMedia, so stand one in. The listener
 * matters as much as the initial value: the hook exists so the hidden rails /
 * tab bar can be made inert, and a stale value leaves the wrong half of the UI
 * in the accessibility tree and the tab order.
 */
function stubMatchMedia(initialMatches: boolean) {
  const listeners = new Set<() => void>();
  const query = {
    matches: initialMatches,
    addEventListener: (_type: string, listener: () => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: () => void) => listeners.delete(listener),
  };

  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => query),
  );

  return {
    query,
    resizeTo(matches: boolean) {
      query.matches = matches;
      listeners.forEach((listener) => listener());
    },
    get listenerCount() {
      return listeners.size;
    },
  };
}

beforeEach(() => {
  vi.unstubAllGlobals();
});

describe("useIsMobileLayout", () => {
  test("starts at whatever the breakpoint already says", () => {
    stubMatchMedia(true);

    const { result } = renderHook(() => useIsMobileLayout());

    expect(result.current).toBe(true);
  });

  test("follows the viewport across the breakpoint", () => {
    const media = stubMatchMedia(false);
    const { result } = renderHook(() => useIsMobileLayout());

    expect(result.current).toBe(false);

    act(() => media.resizeTo(true));
    expect(result.current).toBe(true);

    act(() => media.resizeTo(false));
    expect(result.current).toBe(false);
  });

  test("stops listening on unmount", () => {
    const media = stubMatchMedia(false);
    const { unmount } = renderHook(() => useIsMobileLayout());

    expect(media.listenerCount).toBe(1);
    unmount();
    expect(media.listenerCount).toBe(0);
  });
});
