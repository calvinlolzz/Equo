import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vitest";
import {
  LINE_ENTRY_KEY_PATTERN,
  LINE_POSTBACK_DATA_MAX,
  type LinePostback,
  encodeLinePostback,
  parseLinePostback,
} from "./linePostback.js";

const KEY = "01J0000000000000000000000A";

const ROUND_TRIPS: Array<[LinePostback, string]> = [
  [{ action: "delete_ask", entryKey: KEY }, `v=1&a=del&k=${KEY}`],
  [{ action: "delete_confirm", entryKey: KEY }, `v=1&a=delok&k=${KEY}`],
  [{ action: "delete_cancel" }, "v=1&a=delno"],
];

describe("encodeLinePostback / parseLinePostback", () => {
  test.each(ROUND_TRIPS)("%j is %s, and reads back", (postback, data) => {
    expect(encodeLinePostback(postback)).toBe(data);
    expect(parseLinePostback(data)).toEqual(postback);
  });

  test("an entry key from a message id (msg:123...) is percent-encoded and reads back", () => {
    const postback: LinePostback = { action: "delete_ask", entryKey: "msg:1234567890123" };
    const data = encodeLinePostback(postback);
    expect(data).toBe("v=1&a=del&k=msg%3A1234567890123");
    expect(parseLinePostback(data)).toEqual(postback);
  });

  // [MV]: accept an extra, repeated or reordered parameter and the grammar stops being closed.
  test.each([
    ["an extra parameter", `v=1&a=del&k=${KEY}&x=1`],
    ["an extra parameter before the key", `v=1&a=del&x=1&k=${KEY}`],
    ["a repeated key parameter", `v=1&a=del&k=${KEY}&k=${KEY}`],
    ["a repeated version", `v=1&v=1&a=del&k=${KEY}`],
    ["reordered parameters", `a=del&v=1&k=${KEY}`],
    ["a missing version", `a=del&k=${KEY}`],
    ["a version other than 1", `v=2&a=del&k=${KEY}`],
    ["an empty version", `v=&a=del&k=${KEY}`],
    ["an unknown action", `v=1&a=pay&k=${KEY}`],
    ["a missing action", `v=1&k=${KEY}`],
    ["an ask with no key", "v=1&a=del"],
    ["a confirm with no key", "v=1&a=delok"],
    ["a cancel that carries a key", `v=1&a=delno&k=${KEY}`],
    ["a cancel with an extra parameter", "v=1&a=delno&x=1"],
    ["a trailing ampersand", `v=1&a=del&k=${KEY}&`],
    ["a leading ampersand", `&v=1&a=del&k=${KEY}`],
    ["an empty key", "v=1&a=del&k="],
    ["a pair with no equals sign", `v=1&a=del&k`],
    ["upper-case parameter names", `V=1&A=del&K=${KEY}`],
    ["a key that is too short", "v=1&a=del&k=abcdefg"],
    ["a key that is too long", `v=1&a=del&k=${"a".repeat(81)}`],
    ["a key with a slash", "v=1&a=del&k=abcd%2Fefgh"],
    ["a key with a space", "v=1&a=del&k=abcd%20efgh"],
    ["a key with a malformed percent escape", "v=1&a=del&k=abcd%E0%A4%A"],
    ["a lower-case percent escape (not the canonical spelling)", "v=1&a=del&k=msg%3a1234567890123"],
    ["a key spelled with an escape it does not need", "v=1&a=del&k=%30123456789"],
    ["a plus for a space", "v=1&a=del&k=abcd+efgh"],
    ["surrounding whitespace", ` v=1&a=del&k=${KEY}`],
    ["an empty string", ""],
    ["data longer than 300 units", `v=1&a=del&k=${"a".repeat(300)}`],
  ])("refuses %s", (_name, data) => {
    expect(parseLinePostback(data)).toBeNull();
  });

  test.each([undefined, null, 7, true, {}, [], ["v=1&a=delno"], { data: "v=1&a=delno" }])("refuses a value that is not a string: %j", (value) => {
    expect(parseLinePostback(value)).toBeNull();
  });

  test("never throws, whatever it is given", () => {
    for (const value of ["%", "%%%", "k=%", "v=1&a=del&k=%E0%A4%A", "\uD83D", "&&&", "=", "=&=&=", "v=1&a=delno\u0000"]) {
      expect(() => parseLinePostback(value), value).not.toThrow();
    }
  });
});

describe("the 300-unit limit", () => {
  test("the longest data this module writes fits with room to spare", () => {
    // 80 characters of ":" - every one percent-encoded to three - is the worst case a key can be.
    const worst = encodeLinePostback({ action: "delete_confirm", entryKey: ":".repeat(80) });
    expect(worst.length).toBe("v=1&a=delok&k=".length + 240);
    expect(worst.length).toBeLessThanOrEqual(LINE_POSTBACK_DATA_MAX);
    expect(parseLinePostback(worst)).toEqual({ action: "delete_confirm", entryKey: ":".repeat(80) });
  });

  // [MV]: grow the data past what the key limit allows (e.g. drop the key pattern's upper bound) and this is red.
  test("no entry key can push the data past 300 units: 81 characters are refused outright", () => {
    expect(parseLinePostback(`v=1&a=delok&k=${"%3A".repeat(81)}`)).toBeNull();
    expect(() => encodeLinePostback({ action: "delete_confirm", entryKey: ":".repeat(81) })).toThrow();
  });

  test("an entry key that could never resolve is refused at build time, not shipped as a dead button", () => {
    expect(() => encodeLinePostback({ action: "delete_ask", entryKey: "short" })).toThrow();
    expect(() => encodeLinePostback({ action: "delete_ask", entryKey: "has a space inside" })).toThrow();
    expect(() => encodeLinePostback({ action: "delete_confirm", entryKey: "a".repeat(81) })).toThrow();
  });
});

describe("LINE_ENTRY_KEY_PATTERN", () => {
  test("accepts what lineEventKey produces: a webhook event id, or msg: and a message id", () => {
    expect(LINE_ENTRY_KEY_PATTERN.test("01J0000000000000000000000A")).toBe(true);
    expect(LINE_ENTRY_KEY_PATTERN.test("msg:5645678901234")).toBe(true);
  });

  test("is exactly the pattern the SQL checks, in both functions that check it", () => {
    const sql = readFileSync(join(__dirname, "..", "..", "..", "..", "..", "supabase", "migrations", "20261101090100_line_entry_actions.sql"), "utf8");
    // The SQL spells it '^[A-Za-z0-9:_-]{8,80}$'; the TS copy is the same characters between the slashes.
    const sqlPattern = `'${LINE_ENTRY_KEY_PATTERN.source}'`;
    const occurrences = sql.split(sqlPattern).length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});
