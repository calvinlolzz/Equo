import { describe, expect, test } from "vitest";
import { lineLinks } from "./lineLinks.js";

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
