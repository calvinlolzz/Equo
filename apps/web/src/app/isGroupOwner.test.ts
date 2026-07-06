import { describe, expect, test } from "vitest";
import { isGroupOwner } from "./isGroupOwner";

describe("isGroupOwner", () => {
  test("returns true for a member with role owner", () => {
    expect(isGroupOwner({ role: "owner" })).toBe(true);
  });

  test("returns false for a member with role member", () => {
    expect(isGroupOwner({ role: "member" })).toBe(false);
  });

  test("returns false when the member has no role", () => {
    expect(isGroupOwner({ role: undefined })).toBe(false);
  });

  test("returns false when the member is null or undefined", () => {
    expect(isGroupOwner(null)).toBe(false);
    expect(isGroupOwner(undefined)).toBe(false);
  });
});
