import { describe, expect, test } from "vitest";
import { resolveRootLanding } from "./resolveRootLanding";

describe("resolveRootLanding", () => {
  test("returns null when there are no groups", () => {
    expect(resolveRootLanding([])).toBeNull();
  });

  test("returns the first (newest) group id", () => {
    expect(resolveRootLanding([{ id: "g_new" }, { id: "g_old" }])).toBe("g_new");
  });

  // [MV]
  test("prefers the newest SHARED group over a personal ledger ahead of it in the list", () => {
    expect(
      resolveRootLanding([
        { id: "g_ledger", kind: "personal" },
        { id: "g_shared", kind: "shared" },
      ]),
    ).toBe("g_shared");
  });

  // [MV]
  test("a personal ledger only: lands on the ledger", () => {
    expect(resolveRootLanding([{ id: "g_ledger", kind: "personal" }])).toBe("g_ledger");
  });
});
