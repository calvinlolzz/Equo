import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { LIFF_BOOTED_KEY, isLiffPath, shouldReturnToLiff } from "./liffPath";

describe("isLiffPath", () => {
  test.each(["/liff", "/liff/", "/LIFF", "/Liff/", "/liff/anything"])("%s is a LIFF page", (path) => {
    expect(isLiffPath(path)).toBe(true);
  });

  test.each(["/", "/group/abc", "/liffy", "/line/link", "/admin/liff", "/privacy", "/xliff"])("%s is not", (path) => {
    expect(isLiffPath(path)).toBe(false);
  });
});

describe("shouldReturnToLiff", () => {
  const booted = { getItem: (key: string) => (key === LIFF_BOOTED_KEY ? "1" : null) };
  const fresh = { getItem: () => null };

  // [MV]: flip it and a reload inside LINE lands on a Google login that cannot work there.
  test("a reload of the ledger address in a tab that booted LIFF goes back to /liff", () => {
    expect(shouldReturnToLiff("/group/0b8f2c1e-5a41-4f0a-9d2e-3c6b7a8d9e10", booted)).toBe(true);
    expect(shouldReturnToLiff("/group/anything/else", booted)).toBe(true);
  });

  test("a tab that never booted LIFF is left alone (every ordinary browser tab)", () => {
    expect(shouldReturnToLiff("/group/0b8f2c1e", fresh)).toBe(false);
    expect(shouldReturnToLiff("/group/0b8f2c1e", { getItem: () => "0" })).toBe(false);
  });

  test.each(["/", "/groups/abc", "/group", "/liff", "/privacy", "/admin/group/x", "/x/group/y"])("%s is not the ledger address", (path) => {
    expect(shouldReturnToLiff(path, booted)).toBe(false);
  });

  test("unreadable or missing storage means no, never a redirect loop", () => {
    expect(shouldReturnToLiff("/group/abc", null)).toBe(false);
    expect(
      shouldReturnToLiff("/group/abc", {
        getItem: () => {
          throw new Error("denied");
        },
      }),
    ).toBe(false);
  });
});

describe("main.tsx wiring", () => {
  const main = readFileSync(fileURLToPath(new URL("../../main.tsx", import.meta.url)), "utf8");

  // [MV]: drop the call and the helper is dead code; import liffBoot and the SDK shell lands in the entry chunk.
  test("sends the page back through /liff before rendering, and imports liffPath only", () => {
    expect(main).toMatch(/shouldReturnToLiff\(window\.location\.pathname, window\.sessionStorage\)/);
    expect(main).toMatch(/window\.location\.replace\("\/liff"\)/);
    expect(main).toMatch(/if \(!returningToLiff\) createRoot/);
    expect(main).not.toMatch(/liffBoot|liffSdk/);
    expect(main).not.toMatch(/from "\.\/app\/liff\/LiffApp"/);
  });
});
