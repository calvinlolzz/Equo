import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { liffIdForLinks, lineLinks } from "./lineLinks.js";

const ORIGIN = "https://equo-mu.vercel.app";

describe("lineLinks", () => {
  const links = lineLinks({ appOrigin: ORIGIN, ledgerId: "6f1c2d3e-0000-4000-8000-000000000001" });
  const BASE = `${ORIGIN}/group/6f1c2d3e-0000-4000-8000-000000000001`;

  // [MV]: change a path or a parameter name and the web app's parser stops understanding the link.
  test("the exact URL shapes", () => {
    expect(links.ledger).toBe(`${BASE}?openExternalBrowser=1`);
    expect(links.records).toBe(`${BASE}?view=records&openExternalBrowser=1`);
    expect(links.analysis).toBe(`${BASE}?view=analysis&openExternalBrowser=1`);
    expect(links.entry("01J0000000000000000000000A")).toBe(`${BASE}?entry=01J0000000000000000000000A&openExternalBrowser=1`);
  });

  // [MV]: drop it, or put anything after it, and LINE opens the link in its in-app browser - where Google sign-in fails.
  test("openExternalBrowser=1 is the last parameter of every link", () => {
    for (const url of [links.ledger, links.records, links.analysis, links.entry("01J0000000000000000000000A"), links.entry("msg:12345678")]) {
      expect(url.endsWith("&openExternalBrowser=1") || url.endsWith("?openExternalBrowser=1"), url).toBe(true);
      expect(new URL(url).searchParams.get("openExternalBrowser")).toBe("1");
      expect(url.indexOf("openExternalBrowser")).toBe(url.lastIndexOf("openExternalBrowser"));
    }
  });

  // [MV]: stop encoding the key and "msg:123" becomes a different query than the one the web app decodes.
  test("an entry key made from a message id has its colon encoded, and decodes back", () => {
    const url = links.entry("msg:5645678901234");
    expect(url).toBe(`${BASE}?entry=msg%3A5645678901234&openExternalBrowser=1`);
    expect(new URL(url).searchParams.get("entry")).toBe("msg:5645678901234");
  });

  test("the ledger id is encoded too", () => {
    const odd = lineLinks({ appOrigin: ORIGIN, ledgerId: "a/b c?d" });
    expect(odd.records).toBe(`${ORIGIN}/group/a%2Fb%20c%3Fd?view=records&openExternalBrowser=1`);
    expect(new URL(odd.records).pathname).toBe("/group/a%2Fb%20c%3Fd");
  });

  test("the origin is used as given (a localhost origin works for a dev bot)", () => {
    expect(lineLinks({ appOrigin: "http://localhost:5173", ledgerId: "g1" }).ledger).toBe("http://localhost:5173/group/g1?openExternalBrowser=1");
  });

  test("the four links are all different", () => {
    expect(new Set([links.ledger, links.records, links.analysis, links.entry("01J0000000000000000000000A")]).size).toBe(4);
  });
});

describe("lineLinks in LIFF mode", () => {
  const LIFF_ID = "2011782032-WJwjePnJ";
  const links = lineLinks({ appOrigin: ORIGIN, ledgerId: "6f1c2d3e-0000-4000-8000-000000000001", liff: { liffId: LIFF_ID } });

  // [MV]: change a path or a parameter name and the web app's parser (readLiffIntent) stops understanding the link.
  test("records, analysis and entry are LIFF URLs with the same query", () => {
    expect(links.records).toBe(`https://liff.line.me/${LIFF_ID}?view=records`);
    expect(links.analysis).toBe(`https://liff.line.me/${LIFF_ID}?view=analysis`);
    expect(links.entry("01J0000000000000000000000A")).toBe(`https://liff.line.me/${LIFF_ID}?entry=01J0000000000000000000000A`);
  });

  // [MV]: leave openExternalBrowser on a LIFF link and LINE pulls the page back out into the phone's browser.
  test("none of them carries openExternalBrowser", () => {
    for (const url of [links.records, links.analysis, links.entry("msg:12345678")]) {
      expect(url).not.toContain("openExternalBrowser");
    }
  });

  test("a message-id key keeps its encoded colon", () => {
    expect(links.entry("msg:5645678901234")).toBe(`https://liff.line.me/${LIFF_ID}?entry=msg%3A5645678901234`);
  });

  test("the ledger link stays the browser link (it is the month card's open-the-full-ledger footer)", () => {
    expect(links.ledger).toBe("https://equo-mu.vercel.app/group/6f1c2d3e-0000-4000-8000-000000000001?openExternalBrowser=1");
  });

  test("the LIFF URLs do not depend on the ledger or the app origin", () => {
    const other = lineLinks({ appOrigin: "http://localhost:5173", ledgerId: "other", liff: { liffId: LIFF_ID } });
    expect(other.records).toBe(links.records);
    expect(other.entry("01J0000000000000000000000A")).toBe(links.entry("01J0000000000000000000000A"));
  });

  test.each([undefined, null])("liff = %s is the browser mode, byte for byte", (liff) => {
    const browser = lineLinks({ appOrigin: ORIGIN, ledgerId: "g1" });
    const same = lineLinks({ appOrigin: ORIGIN, ledgerId: "g1", liff });
    expect(same.records).toBe(browser.records);
    expect(same.analysis).toBe(browser.analysis);
    expect(same.entry("01J0000000000000000000000A")).toBe(browser.entry("01J0000000000000000000000A"));
    expect(same.records).toBe(`${ORIGIN}/group/g1?view=records&openExternalBrowser=1`);
  });

  test.each(["", "not-an-id", "2011782032", "2011782032-", "2011782032-a/b", "https://evil.example/x"])(
    "a malformed id (%j) falls back to browser links instead of building a broken LIFF URL",
    (liffId) => {
      const fallback = lineLinks({ appOrigin: ORIGIN, ledgerId: "g1", liff: { liffId } });
      expect(fallback.records).toBe(`${ORIGIN}/group/g1?view=records&openExternalBrowser=1`);
    },
  );
});

describe("liffIdForLinks - the two-step switch", () => {
  const LIFF_ID = "2011782032-WJwjePnJ";

  // [MV]: switch links on LINE_LIFF_ID alone and setting it for a hand-test on a phone moves every card at once.
  test("LINE_LIFF_ID alone leaves the links in the browser", () => {
    expect(liffIdForLinks({ LINE_LIFF_ID: LIFF_ID })).toBeUndefined();
    expect(liffIdForLinks({ LINE_LIFF_ID: LIFF_ID, LINE_LIFF_LINKS: undefined })).toBeUndefined();
  });

  test("LINE_LIFF_ID with LINE_LIFF_LINKS=1 moves them", () => {
    expect(liffIdForLinks({ LINE_LIFF_ID: LIFF_ID, LINE_LIFF_LINKS: "1" })).toBe(LIFF_ID);
  });

  test("LINE_LIFF_LINKS=1 without an id is nothing to link to", () => {
    expect(liffIdForLinks({ LINE_LIFF_LINKS: "1" })).toBeUndefined();
    expect(liffIdForLinks({})).toBeUndefined();
  });

  test.each(["0", "true", "yes", " 1", ""])("only the exact string 1 counts (%j)", (value) => {
    expect(liffIdForLinks({ LINE_LIFF_ID: LIFF_ID, LINE_LIFF_LINKS: value })).toBeUndefined();
  });
});

describe("the webhook function's wiring", () => {
  const handler = readFileSync(
    fileURLToPath(new URL("../../../../../vercel-api/lineWebhookHandler.ts", import.meta.url)),
    "utf8",
  );

  // [MV]: stop reading the two variables, or stop passing the result on, and the switch does nothing.
  test("reads both variables and hands the deps the result of liffIdForLinks", () => {
    expect(handler).toMatch(/LINE_LIFF_ID: process\.env\.LINE_LIFF_ID/);
    expect(handler).toMatch(/LINE_LIFF_LINKS: process\.env\.LINE_LIFF_LINKS/);
    expect(handler).toMatch(/liffId: liffIdForLinks\(env\)/);
  });

  // [MV]: stop passing the override and a malformed one turns LIFF off in the API but not in the bot.
  test("passes LINE_LOGIN_CHANNEL_ID so the bot and the API judge a malformed override the same way", () => {
    expect(handler).toMatch(/LINE_LOGIN_CHANNEL_ID: process\.env\.LINE_LOGIN_CHANNEL_ID/);
  });
});
