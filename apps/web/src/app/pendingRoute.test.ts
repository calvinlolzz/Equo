// @vitest-environment jsdom
import { beforeEach, describe, expect, test } from "vitest";
import { stashPendingRoute, takePendingRoute } from "./pendingRoute";

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("pendingRoute", () => {
  test("carries a group deep link across the login round-trip", () => {
    stashPendingRoute("/group/group_1");

    expect(takePendingRoute()).toBe("/group/group_1");
  });

  test("is consumed once, so a later login doesn't reopen a stale group", () => {
    stashPendingRoute("/group/group_1");
    takePendingRoute();

    expect(takePendingRoute()).toBe("");
  });

  test("defaults to the current path", () => {
    window.history.replaceState(null, "", "/group/group_9");

    stashPendingRoute();

    expect(takePendingRoute()).toBe("/group/group_9");
  });

  test("stores nothing for the home screen — there is nothing to restore", () => {
    stashPendingRoute("/");

    expect(takePendingRoute()).toBe("");
  });

  test.each([
    ["an absolute URL", "https://evil.example/group/x"],
    ["a protocol-relative URL", "//evil.example"],
    ["a path traversal", "/group/../../admin"],
    ["a nested path", "/group/a/b"],
    ["a path carrying a query", "/group/a?next=/admin"],
    ["a path carrying a fragment", "/group/a#/admin"],
    ["an unrelated route", "/admin"],
  ])("refuses %s", (_label, path) => {
    stashPendingRoute(path);

    // Nothing untrusted ever becomes a navigation target, even if the stored
    // value were tampered with.
    expect(takePendingRoute()).toBe("");
  });

  test("refuses a tampered stored value on the way out too", () => {
    window.localStorage.setItem("equo.clean.pending_route", "https://evil.example");

    expect(takePendingRoute()).toBe("");
  });
});
