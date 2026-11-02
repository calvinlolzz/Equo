import { describe, expect, test } from "vitest";
import { isLiffPath } from "./liffPath";

describe("isLiffPath", () => {
  test.each(["/liff", "/liff/", "/LIFF", "/Liff/", "/liff/anything"])("%s is a LIFF page", (path) => {
    expect(isLiffPath(path)).toBe(true);
  });

  test.each(["/", "/group/abc", "/liffy", "/line/link", "/admin/liff", "/privacy", "/xliff"])("%s is not", (path) => {
    expect(isLiffPath(path)).toBe(false);
  });
});
