// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import { clearPendingRoute, readPendingRoute, stashPendingRoute } from "./pendingRoute";

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("pending route across the login wall", () => {
  test("remembers the group being opened, and hands it back once", () => {
    window.history.replaceState(null, "", "/group/group_abc");

    stashPendingRoute();

    // Reading does NOT consume: the routing effect peeks before the group list
    // has arrived, and a consuming read there would lose the link.
    expect(readPendingRoute()).toBe("group_abc");
    expect(readPendingRoute()).toBe("group_abc");

    clearPendingRoute();
    expect(readPendingRoute()).toBe("");
  });

  test("stashes nothing when the visitor was not on a group route", () => {
    window.history.replaceState(null, "", "/");

    stashPendingRoute();

    expect(readPendingRoute()).toBe("");
  });

  test("round-trips an id that needed escaping in the path", () => {
    window.history.replaceState(null, "", `/group/${encodeURIComponent("a/b")}`);

    stashPendingRoute();

    expect(readPendingRoute()).toBe("a/b");
  });

  test("returns empty rather than throwing when storage is unavailable", () => {
    // Private mode / blocked storage: the deep link is a nicety and must never
    // be able to break the login itself.
    const original = window.localStorage.getItem;
    window.localStorage.getItem = () => {
      throw new Error("blocked");
    };

    expect(readPendingRoute()).toBe("");

    window.localStorage.getItem = original;
  });
});
