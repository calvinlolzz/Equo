// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { describe, expect, test } from "vitest";
import { useActionGuard } from "./useActionGuard";

describe("useActionGuard", () => {
  test("claiming the guard exposes the pending key on both the state and the ref", () => {
    const { result } = renderHook(() => useActionGuard());

    expect(result.current.pendingAction).toBeNull();
    expect(result.current.actionGuardRef.current.current).toBeNull();

    let claimed = false;
    act(() => {
      claimed = result.current.beginAction("createGroup");
    });

    expect(claimed).toBe(true);
    expect(result.current.pendingAction).toBe("createGroup");
    // The ref is what the auto-sync loop reads to skip a refresh mid-mutation.
    expect(result.current.actionGuardRef.current.current).toBe("createGroup");
  });

  test("a second action in the SAME tick is refused (the synchronous double-submit guard)", () => {
    const { result } = renderHook(() => useActionGuard());

    // Both calls happen before any re-render commits pendingAction - this is the
    // real double-click race. A guard that (wrongly) gated on the async
    // pendingAction state instead of begin()'s return value would still see
    // pendingAction === null on the second call here and let it through, so
    // keeping both calls in one act() is what makes this test discriminating.
    let first = false;
    let second = true;
    act(() => {
      first = result.current.beginAction("createGroup");
      second = result.current.beginAction("deleteGroup");
    });

    expect(first).toBe(true);
    expect(second).toBe(false);
    expect(result.current.pendingAction).toBe("createGroup");
  });

  test("endAction releases the guard so the next action can claim it", () => {
    const { result } = renderHook(() => useActionGuard());

    act(() => {
      result.current.beginAction("createGroup");
    });
    act(() => {
      result.current.endAction();
    });

    expect(result.current.pendingAction).toBeNull();
    expect(result.current.actionGuardRef.current.current).toBeNull();

    let reclaimed = false;
    act(() => {
      reclaimed = result.current.beginAction("deleteGroup");
    });

    expect(reclaimed).toBe(true);
    expect(result.current.pendingAction).toBe("deleteGroup");
  });
});
