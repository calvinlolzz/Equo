import { describe, expect, test } from "vitest";
import { resolveRootLanding } from "./resolveRootLanding";

describe("resolveRootLanding", () => {
  test("returns null when there are no groups", () => {
    expect(resolveRootLanding([])).toBeNull();
  });

  test("returns the first (newest) group id", () => {
    expect(resolveRootLanding([{ id: "g_new" }, { id: "g_old" }])).toBe("g_new");
  });
});
