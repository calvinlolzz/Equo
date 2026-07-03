import { describe, expect, test } from "vitest";
import { selectInitialStartMode } from "./startFlow";

describe("selectInitialStartMode", () => {
  test("starts with create for new users and continue for returning users", () => {
    expect(selectInitialStartMode({ groupCount: 0 })).toBe("create");
    expect(selectInitialStartMode({ groupCount: 2 })).toBe("continue");
  });
});
