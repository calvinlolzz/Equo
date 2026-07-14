// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { useToast } from "./useToast";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useToast", () => {
  test("shows nothing until something is said", () => {
    const { result } = renderHook(() => useToast());

    expect(result.current.toast).toBeNull();
  });

  test("shows a message and dismisses it on its own", () => {
    const { result } = renderHook(() => useToast());

    act(() => result.current.showToast("已刪除"));
    expect(result.current.toast?.text).toBe("已刪除");

    act(() => void vi.advanceTimersByTime(2599));
    expect(result.current.toast?.text).toBe("已刪除");

    act(() => void vi.advanceTimersByTime(1));
    expect(result.current.toast).toBeNull();
  });

  test("an actionable toast lingers longer - the user has to reach the button", () => {
    const { result } = renderHook(() => useToast());
    const onAction = vi.fn();

    act(() => result.current.showToast("已刪除", { label: "復原", onAction }));

    // A plain toast would already be gone by now.
    act(() => void vi.advanceTimersByTime(2600));
    expect(result.current.toast?.action?.label).toBe("復原");

    act(() => void vi.advanceTimersByTime(3400));
    expect(result.current.toast).toBeNull();
  });

  test("a new toast replaces the current one and restarts its timer", () => {
    const { result } = renderHook(() => useToast());

    act(() => result.current.showToast("第一則"));
    act(() => void vi.advanceTimersByTime(2000));

    act(() => result.current.showToast("第二則"));
    expect(result.current.toast?.text).toBe("第二則");

    // The first toast's timer must not cut the second one short: 600ms after the
    // first was shown is 2600ms into ITS life, but only 600ms into the second's.
    act(() => void vi.advanceTimersByTime(600));
    expect(result.current.toast?.text).toBe("第二則");

    act(() => void vi.advanceTimersByTime(2000));
    expect(result.current.toast).toBeNull();
  });

  test("clears its pending timer on unmount", () => {
    const clearTimeout = vi.spyOn(window, "clearTimeout");
    const { result, unmount } = renderHook(() => useToast());

    act(() => result.current.showToast("已刪除"));
    unmount();

    expect(clearTimeout).toHaveBeenCalled();
  });
});
