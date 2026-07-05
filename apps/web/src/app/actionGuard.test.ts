import { describe, expect, test } from "vitest";
import { createActionGuard } from "./actionGuard";

describe("createActionGuard", () => {
  test("begin claims the lock and returns true when nothing is in flight", () => {
    const guard = createActionGuard();

    expect(guard.begin("createGroup")).toBe(true);
    expect(guard.current).toBe("createGroup");
  });

  test("a second begin call for the same key is rejected while the first is still in flight (the double-click bug)", () => {
    const guard = createActionGuard();

    expect(guard.begin("createGroup")).toBe(true);
    expect(guard.begin("createGroup")).toBe(false);
    expect(guard.current).toBe("createGroup");
  });

  test("a begin call for a different key is also rejected while another action is in flight", () => {
    const guard = createActionGuard();

    expect(guard.begin("createGroup")).toBe(true);
    expect(guard.begin("archiveGroup")).toBe(false);
  });

  test("end releases the lock so a subsequent begin succeeds", () => {
    const guard = createActionGuard();
    guard.begin("createGroup");

    guard.end();

    expect(guard.current).toBeNull();
    expect(guard.begin("createGroup")).toBe(true);
  });

  test("simulates two synchronous clicks in the same tick: only the first passes", () => {
    const guard = createActionGuard();
    const calls: boolean[] = [];

    function handleClick() {
      calls.push(guard.begin("createGroup"));
    }

    // Two clicks dispatched back-to-back before any async work / re-render
    // could have run - this is exactly the scenario a useState-only guard
    // fails to catch.
    handleClick();
    handleClick();

    expect(calls).toEqual([true, false]);
  });
});
