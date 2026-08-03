import { describe, expect, test } from "vitest";
import { buildQrModules, buildQrPath } from "./inviteQr";
import { readInviteToken } from "./inviteToken";

describe("buildQrModules", () => {
  test("produces a square grid with the three finder patterns in place", () => {
    const modules = buildQrModules("https://equo-mu.vercel.app/?invite=ONOG0SD6");

    expect(modules.length).toBeGreaterThanOrEqual(21);
    modules.forEach((row) => expect(row).toHaveLength(modules.length));

    // A finder pattern is a 7x7 dark ring with a dark 3x3 core; checking the
    // ring's corner and the gap beside it distinguishes a real encoding from an
    // all-dark or all-light grid, which is what a broken build would produce.
    const last = modules.length - 1;
    for (const [row, col] of [
      [0, 0],
      [0, last - 6],
      [last - 6, 0],
    ]) {
      expect(modules[row][col]).toBe(true);
      expect(modules[row + 1][col + 1]).toBe(false);
      expect(modules[row + 3][col + 3]).toBe(true);
    }
  });

  test("grows the grid rather than truncating when the payload gets longer", () => {
    const short = buildQrModules("https://equo.app/?invite=AAAAAA");
    const long = buildQrModules(`https://equo.app/?invite=${"A".repeat(300)}`);

    expect(long.length).toBeGreaterThan(short.length);
  });
});

describe("buildQrPath", () => {
  test("merges each horizontal run of dark modules into one rectangle", () => {
    const path = buildQrPath([
      [true, true, true, false],
      [false, true, false, true],
    ]);

    // Row 0 is one run of three from x=0; row 1 is two separate single cells.
    expect(path).toBe("M0 0h3v1h-3zM1 1h1v1h-1zM3 1h1v1h-1z");
  });

  test("closes a run that reaches the right edge", () => {
    expect(buildQrPath([[false, true, true]])).toBe("M1 0h2v1h-2z");
  });

  test("emits nothing for an all-light grid", () => {
    expect(buildQrPath([[false, false]])).toBe("");
  });
});

describe("readInviteToken", () => {
  test("pulls the token out of a full invite link", () => {
    expect(readInviteToken("https://equo-mu.vercel.app/?invite=ONOG0SD6")).toBe("ONOG0SD6");
  });

  test("accepts a bare code and normalises its case", () => {
    expect(readInviteToken("  onog0sd6  ")).toBe("ONOG0SD6");
  });

  test("rejects a QR that is some other site's link", () => {
    expect(readInviteToken("https://example.com/promo")).toBe("");
  });

  test("rejects a link whose invite param is not a plausible token", () => {
    expect(readInviteToken("https://equo-mu.vercel.app/?invite=../../etc/passwd")).toBe("");
  });

  test("rejects free text that is not a URL", () => {
    expect(readInviteToken("WIFI:S=cafe;T=WPA;P=hunter2;;")).toBe("");
    expect(readInviteToken("")).toBe("");
  });
});
