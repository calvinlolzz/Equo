// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import {
  LINE_ENTRY_KEY_PATTERN,
  clearLineIntentParams,
  clearStashedLineIntent,
  readLineIntent,
  stashLineIntent,
  takeStashedLineIntent,
} from "./lineIntent";

const STASH_KEY = "equo.clean.pending_line_intent";

afterEach(() => {
  vi.restoreAllMocks();
});

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState(null, "", "/");
});

describe("LINE_ENTRY_KEY_PATTERN", () => {
  test("is 8-80 of letters, digits, colon, underscore and hyphen", () => {
    expect(LINE_ENTRY_KEY_PATTERN.test("a".repeat(8))).toBe(true);
    expect(LINE_ENTRY_KEY_PATTERN.test("a".repeat(80))).toBe(true);
    expect(LINE_ENTRY_KEY_PATTERN.test("msg:1234_ab-CD")).toBe(true);

    expect(LINE_ENTRY_KEY_PATTERN.test("a".repeat(7))).toBe(false);
    expect(LINE_ENTRY_KEY_PATTERN.test("a".repeat(81))).toBe(false);
    expect(LINE_ENTRY_KEY_PATTERN.test("has space 123")).toBe(false);
    expect(LINE_ENTRY_KEY_PATTERN.test("slash/12345678")).toBe(false);
    expect(LINE_ENTRY_KEY_PATTERN.test("dot.12345678")).toBe(false);
    // Anchored: a valid key with a newline tail is not a valid key.
    expect(LINE_ENTRY_KEY_PATTERN.test("abcdefgh\n")).toBe(false);
  });
});

describe("readLineIntent", () => {
  test("reads the two views", () => {
    expect(readLineIntent("?view=records")).toEqual({ kind: "records" });
    expect(readLineIntent("?view=analysis")).toEqual({ kind: "analysis" });
  });

  test("reads an entry key, decoding it", () => {
    expect(readLineIntent("?entry=msg%3A1234567890&openExternalBrowser=1")).toEqual({
      kind: "entry",
      entryKey: "msg:1234567890",
    });
  });

  test("entry wins over view", () => {
    expect(readLineIntent("?view=records&entry=abcdefgh12")).toEqual({ kind: "entry", entryKey: "abcdefgh12" });
  });

  test("ignores anything it does not implement - no URLs, no other views", () => {
    expect(readLineIntent("")).toBeNull();
    expect(readLineIntent("?view=members")).toBeNull();
    expect(readLineIntent("?view=")).toBeNull();
    expect(readLineIntent("?view=https://evil.example/")).toBeNull();
    expect(readLineIntent("?shortcut=add-expense&invite=abc")).toBeNull();
  });

  test("a malformed entry key is ignored, and a valid view beside it still counts", () => {
    expect(readLineIntent("?entry=short")).toBeNull();
    expect(readLineIntent(`?entry=${"a".repeat(81)}`)).toBeNull();
    expect(readLineIntent("?entry=has%20space%20123")).toBeNull();
    expect(readLineIntent("?entry=short&view=analysis")).toEqual({ kind: "analysis" });
  });
});

describe("clearLineIntentParams", () => {
  test("drops view and entry and keeps everything else", () => {
    window.history.replaceState(null, "", "/group/g1?view=records&entry=abcdefgh12&openExternalBrowser=1&invite=tok#frag");

    clearLineIntentParams();

    expect(window.location.pathname).toBe("/group/g1");
    expect(window.location.search).toBe("?openExternalBrowser=1&invite=tok");
    expect(window.location.hash).toBe("#frag");
  });

  test("leaves the address bar alone when there is nothing to clear", () => {
    window.history.replaceState({ marker: 1 }, "", "/group/g1?openExternalBrowser=1");
    const before = window.history.length;

    clearLineIntentParams();

    expect(window.location.search).toBe("?openExternalBrowser=1");
    expect(window.history.length).toBe(before);
  });

  test("replaces the entry rather than adding one, and keeps the history state (the overlay depth lives there)", () => {
    window.history.replaceState({ depth: 2 }, "", "/group/g1?view=analysis");
    const before = window.history.length;

    clearLineIntentParams();

    expect(window.location.search).toBe("");
    expect(window.history.state).toEqual({ depth: 2 });
    expect(window.history.length).toBe(before);
  });
});

describe("the stash across the login redirect", () => {
  test("round-trips an intent and hands it back once", () => {
    stashLineIntent({ kind: "entry", entryKey: "msg:1234567890" }, 1_000);

    expect(takeStashedLineIntent(2_000)).toEqual({ kind: "entry", entryKey: "msg:1234567890" });
    expect(takeStashedLineIntent(2_000)).toBeNull();
    expect(window.localStorage.getItem(STASH_KEY)).toBeNull();
  });

  test("round-trips both views", () => {
    stashLineIntent({ kind: "records" }, 1_000);
    expect(takeStashedLineIntent(1_000)).toEqual({ kind: "records" });
    stashLineIntent({ kind: "analysis" }, 1_000);
    expect(takeStashedLineIntent(1_000)).toEqual({ kind: "analysis" });
  });

  test("expires after 15 minutes - and is still consumed", () => {
    const fifteen = 15 * 60 * 1000;
    stashLineIntent({ kind: "records" }, 0);
    expect(takeStashedLineIntent(fifteen)).toEqual({ kind: "records" });

    stashLineIntent({ kind: "records" }, 0);
    expect(takeStashedLineIntent(fifteen + 1)).toBeNull();
    expect(window.localStorage.getItem(STASH_KEY)).toBeNull();
  });

  test("treats malformed storage as no intent", () => {
    for (const raw of [
      "not json",
      "null",
      "[]",
      "{}",
      JSON.stringify({ at: 1 }),
      JSON.stringify({ intent: { kind: "records" } }),
      JSON.stringify({ intent: { kind: "members" }, at: 1 }),
      JSON.stringify({ intent: { kind: "entry" }, at: 1 }),
      JSON.stringify({ intent: { kind: "entry", entryKey: "short" }, at: 1 }),
      JSON.stringify({ intent: { kind: "entry", entryKey: 12345678 }, at: 1 }),
      JSON.stringify({ intent: { kind: "records" }, at: "1" }),
    ]) {
      window.localStorage.setItem(STASH_KEY, raw);
      expect(takeStashedLineIntent(1_000), raw).toBeNull();
    }
  });

  test("clearStashedLineIntent drops a stash that will not be used", () => {
    stashLineIntent({ kind: "records" }, 1_000);
    clearStashedLineIntent();
    expect(takeStashedLineIntent(1_000)).toBeNull();
  });

  test("never throws when storage is unavailable", () => {
    const blocked = () => {
      throw new Error("blocked");
    };
    // On the prototype: jsdom's Storage treats an assigned property as a stored key.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(blocked);
    vi.spyOn(Storage.prototype, "removeItem").mockImplementation(blocked);

    expect(() => stashLineIntent({ kind: "records" })).not.toThrow();
    expect(takeStashedLineIntent()).toBeNull();
    expect(() => clearStashedLineIntent()).not.toThrow();
  });
});
