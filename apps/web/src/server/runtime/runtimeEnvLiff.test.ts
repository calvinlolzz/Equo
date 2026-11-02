import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { missingRuntimeEnv, parseLiffId, parseLiffLinks, readLineEnv, readLineLiffConfig, readRuntimeEnv } from "./runtimeEnv.js";

const LIFF_ID = "2008123456-AbCdEfGh";

let warn: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warn = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("LINE_LIFF_ID", () => {
  test("a well-formed LIFF id is kept", () => {
    expect(readRuntimeEnv({ LINE_LIFF_ID: LIFF_ID }).LINE_LIFF_ID).toBe(LIFF_ID);
  });

  test("a BOM or whitespace from `vercel env add` is stripped", () => {
    expect(readRuntimeEnv({ LINE_LIFF_ID: `\uFEFF ${LIFF_ID}\n` }).LINE_LIFF_ID).toBe(LIFF_ID);
  });

  test.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["no suffix", "2008123456"],
    ["no channel part", "-AbCdEfGh"],
    ["a non-numeric channel part", "abcdefghij-AbCdEfGh"],
    ["a short suffix", "2008123456-Ab"],
    ["a slash in it", "2008123456-AbCd/EfGh"],
    ["a quote in it", '"2008123456-AbCdEfGh"'],
    ["a second dash", "2008123456-AbCd-EfGh"],
    ["a URL", "https://liff.line.me/2008123456-AbCdEfGh"],
    ["trailing junk", `${LIFF_ID}x y`],
  ])("%s is dropped, so LIFF is off rather than misconfigured", (_label, value) => {
    // [MV] loosening the pattern lets a typo through as an audience and a URL path.
    expect(readRuntimeEnv({ LINE_LIFF_ID: value }).LINE_LIFF_ID).toBeUndefined();
  });

  test("unset is simply off", () => {
    expect(readRuntimeEnv({}).LINE_LIFF_ID).toBeUndefined();
  });

  test("is optional: its absence never shows up as missing runtime env", () => {
    const env = readRuntimeEnv({
      SUPABASE_URL: "https://x.supabase.co",
      SUPABASE_ANON_KEY: "a",
      SUPABASE_SERVICE_ROLE_KEY: "b",
      GOOGLE_OAUTH_CLIENT_ID: "c",
      SESSION_SECRET: "d",
    });

    expect(missingRuntimeEnv(env)).toEqual([]);
  });

  test("a malformed value logs the variable NAME once, never the value", () => {
    // Distinct value per call but the same name: warned once per process per name.
    parseLiffId("garbage-value-that-must-not-leak");
    parseLiffId("garbage-value-that-must-not-leak-2");

    const lines = warn.mock.calls.map((call: unknown[]) => call.join(" "));
    for (const line of lines) {
      expect(line).not.toContain("garbage-value");
      expect(line).toContain("LINE_LIFF_ID");
    }
    expect(lines.length).toBeLessThanOrEqual(1);
  });
});

describe("LINE_LOGIN_CHANNEL_ID", () => {
  test("a numeric id is kept", () => {
    expect(readRuntimeEnv({ LINE_LIFF_ID: LIFF_ID, LINE_LOGIN_CHANNEL_ID: "2009999999" }).LINE_LOGIN_CHANNEL_ID).toBe("2009999999");
  });

  test.each([
    ["letters", "channel"],
    ["a secret-looking hex string", "0123456789abcdef0123456789abcdef"],
    ["a decimal", "1234567.5"],
    ["too short", "123"],
    ["with a trailing space inside", "1234567 890"],
  ])("%s turns LIFF OFF instead of falling back to the LIFF id's prefix", (_label, value) => {
    const env = readRuntimeEnv({ LINE_LIFF_ID: LIFF_ID, LINE_LOGIN_CHANNEL_ID: value });

    expect(env.LINE_LIFF_ID).toBeUndefined();
    expect(env.LINE_LOGIN_CHANNEL_ID).toBeUndefined();
    expect(readLineLiffConfig(env)).toBeUndefined();
  });

  test("the bot's env reaches the same verdict", () => {
    expect(readLineEnv({ LINE_LIFF_ID: LIFF_ID, LINE_LOGIN_CHANNEL_ID: "nope" }).LINE_LIFF_ID).toBeUndefined();
    expect(readLineEnv({ LINE_LIFF_ID: LIFF_ID, LINE_LOGIN_CHANNEL_ID: "2009999999" }).LINE_LIFF_ID).toBe(LIFF_ID);
  });

  // The webhook (readLineEnv) and the API (readRuntimeEnv) are handed the same variables and must agree on "LIFF on".
  test.each([
    ["well-formed override", "2009999999"],
    ["malformed override", "nope"],
    ["no override", undefined],
  ])("the bot and the API agree on LIFF with a %s", (_label, channel) => {
    const source = { LINE_LIFF_ID: LIFF_ID, LINE_LOGIN_CHANNEL_ID: channel };

    expect(readLineEnv(source).LINE_LIFF_ID).toBe(readRuntimeEnv(source).LINE_LIFF_ID);
  });
});

describe("readLineLiffConfig", () => {
  test("is undefined without a LIFF id", () => {
    expect(readLineLiffConfig({})).toBeUndefined();
    expect(readLineLiffConfig(readRuntimeEnv({ LINE_LOGIN_CHANNEL_ID: "2009999999" }))).toBeUndefined();
  });

  test("the audience defaults to the LIFF id's numeric prefix", () => {
    expect(readLineLiffConfig(readRuntimeEnv({ LINE_LIFF_ID: LIFF_ID }))).toEqual({ liffId: LIFF_ID, channelId: "2008123456" });
  });

  test("an explicit channel id wins over the prefix", () => {
    expect(readLineLiffConfig(readRuntimeEnv({ LINE_LIFF_ID: LIFF_ID, LINE_LOGIN_CHANNEL_ID: "2009999999" }))).toEqual({
      liffId: LIFF_ID,
      channelId: "2009999999",
    });
  });
});

describe("LINE_LIFF_LINKS", () => {
  test("only the exact string 1 turns it on", () => {
    expect(parseLiffLinks("1")).toBe("1");
    expect(parseLiffLinks(" 1\n")).toBe("1");
    expect(readRuntimeEnv({ LINE_LIFF_LINKS: "1" }).LINE_LIFF_LINKS).toBe("1");
    expect(readLineEnv({ LINE_LIFF_LINKS: "1" }).LINE_LIFF_LINKS).toBe("1");
  });

  test.each(["0", "true", "yes", "on", "11", "01", "TRUE", ""])("%j is off", (value) => {
    expect(parseLiffLinks(value)).toBeUndefined();
    expect(readRuntimeEnv({ LINE_LIFF_LINKS: value }).LINE_LIFF_LINKS).toBeUndefined();
  });

  test("unset is off", () => {
    expect(parseLiffLinks(undefined)).toBeUndefined();
  });
});
