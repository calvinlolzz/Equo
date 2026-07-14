// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";
import { readRouteGroupId, useGroupRoute } from "./useGroupRoute";

beforeEach(() => {
  window.history.replaceState(null, "", "/");
});

/**
 * jsdom traverses history asynchronously - history.back() queues the navigation
 * and the URL has not moved yet when it returns. Wait for the popstate it
 * ultimately fires rather than for a timer, so this can't go flaky.
 */
async function pressBack() {
  const traversed = new Promise<void>((resolve) => {
    window.addEventListener("popstate", () => resolve(), { once: true });
  });
  window.history.back();
  await traversed;
}

describe("readRouteGroupId", () => {
  test("reads the group out of the path", () => {
    window.history.replaceState(null, "", "/group/group_1");

    expect(readRouteGroupId()).toBe("group_1");
  });

  test("decodes an escaped id", () => {
    window.history.replaceState(null, "", "/group/a%2Fb");

    expect(readRouteGroupId()).toBe("a/b");
  });

  test("is empty on the home screen and on any other path", () => {
    window.history.replaceState(null, "", "/");
    expect(readRouteGroupId()).toBe("");

    window.history.replaceState(null, "", "/group/group_1/extra");
    expect(readRouteGroupId()).toBe("");
  });
});

describe("useGroupRoute", () => {
  test("starts from the URL", () => {
    window.history.replaceState(null, "", "/group/group_1");

    const { result } = renderHook(() => useGroupRoute());

    expect(result.current.activeGroupId).toBe("group_1");
  });

  test("opening a group moves the state and the URL together", () => {
    const { result } = renderHook(() => useGroupRoute());

    act(() => result.current.openGroup("group_1"));

    expect(result.current.activeGroupId).toBe("group_1");
    expect(window.location.pathname).toBe("/group/group_1");
  });

  test("closing returns to the home screen", () => {
    window.history.replaceState(null, "", "/group/group_1");
    const { result } = renderHook(() => useGroupRoute());

    act(() => result.current.closeGroup());

    expect(result.current.activeGroupId).toBe("");
    expect(window.location.pathname).toBe("/");
  });

  test("an id that needs escaping round-trips", () => {
    const { result } = renderHook(() => useGroupRoute());

    act(() => result.current.openGroup("a/b"));

    expect(window.location.pathname).toBe("/group/a%2Fb");
    expect(result.current.activeGroupId).toBe("a/b");
  });

  test("BACK returns to the home screen instead of leaving the group on screen", async () => {
    // The bug this hook exists to close: opening a group pushed a history entry,
    // nothing listened for popstate, so Back changed the URL and the UI carried
    // on showing the group the user had just backed out of.
    const { result } = renderHook(() => useGroupRoute());

    act(() => result.current.openGroup("group_1"));
    expect(result.current.activeGroupId).toBe("group_1");

    await act(async () => {
      await pressBack();
    });

    expect(window.location.pathname).toBe("/");
    expect(result.current.activeGroupId).toBe("");
  });

  test("BACK across two groups walks back through them", async () => {
    const { result } = renderHook(() => useGroupRoute());

    act(() => result.current.openGroup("group_1"));
    act(() => result.current.openGroup("group_2"));

    await act(async () => {
      await pressBack();
    });
    expect(result.current.activeGroupId).toBe("group_1");

    await act(async () => {
      await pressBack();
    });
    expect(result.current.activeGroupId).toBe("");
  });

  test("a replace navigation leaves nothing for Back to return to", () => {
    // Root-landing forwards the user to their most recent group. That must not
    // become a history entry, or Back would bounce them straight back into it.
    const { result } = renderHook(() => useGroupRoute());
    const lengthBefore = window.history.length;

    act(() => result.current.openGroup("group_1", "replace"));

    expect(window.location.pathname).toBe("/group/group_1");
    expect(window.history.length).toBe(lengthBefore);
  });

  test("re-opening the group already in the URL adds no history entry", () => {
    window.history.replaceState(null, "", "/group/group_1");
    const { result } = renderHook(() => useGroupRoute());
    const lengthBefore = window.history.length;

    act(() => result.current.openGroup("group_1"));

    expect(window.history.length).toBe(lengthBefore);
  });

  test("stops listening on unmount", async () => {
    const { result, unmount } = renderHook(() => useGroupRoute());

    act(() => result.current.openGroup("group_1"));
    const activeGroupIdAtUnmount = result.current.activeGroupId;
    unmount();

    await pressBack();

    // The hook's listener is gone: nothing tried to set state on the unmounted
    // component, and the last value it published is untouched.
    expect(result.current.activeGroupId).toBe(activeGroupIdAtUnmount);
  });
});
