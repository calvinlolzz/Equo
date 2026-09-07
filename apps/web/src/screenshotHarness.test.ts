import { describe, expect, test } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dateKey } from "./app/appDates";
import { daysAgo } from "./screenshotDates";

const WEB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * The harness that produces the store and landing screenshots.
 *
 * It had no test at all, while its own header claimed one existed and would
 * fail if the harness ever reached the production build. Both halves of that
 * claim are now true.
 */
describe("the screenshot harness's dates", () => {
  test("are the same day keys the home screen looks up", () => {
    // The bug this pins: daysAgo used toISOString(), which is UTC. East of
    // Greenwich that is yesterday for most of the day, so every fixture expense
    // landed on a key dateKey() never asks for - and every screenshot the
    // harness has ever produced showed 個人消費 $0 with an empty date strip.
    for (const offset of [0, 1, 2, 3, 4, 7]) {
      const at = new Date();
      at.setDate(at.getDate() - offset);
      expect(daysAgo(offset)).toBe(dateKey(at.toISOString()));
    }
  });

  test("are plain YYYY-MM-DD, zero-padded", () => {
    expect(daysAgo(0)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  test("count backwards, one day at a time", () => {
    const day = (offset: number) => Number(daysAgo(offset).slice(-2));
    // Consecutive offsets differ by one calendar day (mod month length).
    expect(daysAgo(0)).not.toBe(daysAgo(1));
    expect(new Set([day(0), day(1), day(2), day(3)]).size).toBe(4);
  });
});

describe("the harness never reaches the production build", () => {
  const indexHtml = readFileSync(join(WEB_ROOT, "index.html"), "utf8");

  test("index.html - the build's only entry - does not pull it in", () => {
    expect(indexHtml).not.toContain("screenshot");
  });

  test("and nothing has added a second rollup input behind our back", () => {
    // Vite's default entry is index.html alone. A vite config could add
    // screenshot.html to the build, which would ship a fabricated group and a
    // fake session to real users.
    let config = "";
    for (const name of ["vite.config.ts", "vite.config.js", "vite.config.mts"]) {
      try {
        config = readFileSync(join(WEB_ROOT, name), "utf8");
        break;
      } catch {
        // Not there, which is the state this asserts.
      }
    }
    expect(config).not.toContain("screenshot");
  });
});
