// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import {
  LINE_LINK_TOKEN_PATTERN,
  clearPendingLineLink,
  isLineInAppBrowser,
  isLineLinkPath,
  lineOaUrl,
  readLinkTokenFromSearch,
  readPendingLineLink,
  resumePendingLineLink,
  stashPendingLineLink,
} from "./lineLink";

afterEach(() => {
  clearPendingLineLink();
  vi.unstubAllEnvs();
});

describe("isLineLinkPath", () => {
  test("matches /line/link exactly, tolerating a trailing slash and case", () => {
    expect(isLineLinkPath("/line/link")).toBe(true);
    expect(isLineLinkPath("/line/link/")).toBe(true);
    expect(isLineLinkPath("/LINE/LINK")).toBe(true);
    expect(isLineLinkPath("/line/linked")).toBe(false);
    expect(isLineLinkPath("/")).toBe(false);
  });
});

describe("LINE_LINK_TOKEN_PATTERN / readLinkTokenFromSearch", () => {
  test("accepts a well-formed token", () => {
    expect(LINE_LINK_TOKEN_PATTERN.test("abcd1234EFGH5678._~-")).toBe(true);
  });

  test("rejects one that is too short, too long, or has bad characters", () => {
    expect(LINE_LINK_TOKEN_PATTERN.test("short")).toBe(false);
    expect(LINE_LINK_TOKEN_PATTERN.test("a".repeat(257))).toBe(false);
    expect(LINE_LINK_TOKEN_PATTERN.test("has space in it 123")).toBe(false);
  });

  test("reads a valid token from the query string", () => {
    expect(readLinkTokenFromSearch("?linkToken=abcd1234efgh5678")).toBe("abcd1234efgh5678");
  });

  test("returns empty for a missing or malformed token in the query string", () => {
    expect(readLinkTokenFromSearch("")).toBe("");
    expect(readLinkTokenFromSearch("?linkToken=short")).toBe("");
    expect(readLinkTokenFromSearch("?other=abcd1234efgh5678")).toBe("");
  });
});

describe("stashPendingLineLink / readPendingLineLink", () => {
  test("round-trips a freshly stashed token", () => {
    stashPendingLineLink("abcd1234efgh5678", 1_000_000);
    expect(readPendingLineLink(1_000_000)).toBe("abcd1234efgh5678");
  });

  test("is still readable exactly at the 10-minute boundary", () => {
    const savedAt = 1_000_000;
    stashPendingLineLink("abcd1234efgh5678", savedAt);
    expect(readPendingLineLink(savedAt + 10 * 60 * 1000)).toBe("abcd1234efgh5678");
  });

  // [MV]: one millisecond past the boundary must expire. Change the TTL
  // comparison from `>` to `>=` (or drop it) and this goes red.
  test("expires one millisecond past the 10-minute boundary", () => {
    const savedAt = 1_000_000;
    stashPendingLineLink("abcd1234efgh5678", savedAt);
    expect(readPendingLineLink(savedAt + 10 * 60 * 1000 + 1)).toBe("");
  });

  test("returns empty after clearPendingLineLink", () => {
    stashPendingLineLink("abcd1234efgh5678", 1_000_000);
    clearPendingLineLink();
    expect(readPendingLineLink(1_000_000)).toBe("");
  });

  test("returns empty for a malformed stashed token", () => {
    window.sessionStorage.setItem("equo.clean.pending_line_link", JSON.stringify({ linkToken: "bad token", savedAt: 1000 }));
    expect(readPendingLineLink(1000)).toBe("");
  });
});

describe("resumePendingLineLink", () => {
  test("replaces to /line/link and returns true when a fresh stash exists", () => {
    stashPendingLineLink("abcd1234efgh5678", 1_000_000);
    const replace = vi.fn();

    const result = resumePendingLineLink(1_000_000, { replace });

    expect(result).toBe(true);
    expect(replace).toHaveBeenCalledWith("/line/link");
  });

  test("does nothing and returns false when there is no stash", () => {
    const replace = vi.fn();
    const result = resumePendingLineLink(1_000_000, { replace });

    expect(result).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });

  test("does nothing and returns false when the stash has expired", () => {
    stashPendingLineLink("abcd1234efgh5678", 1_000_000);
    const replace = vi.fn();

    const result = resumePendingLineLink(1_000_000 + 10 * 60 * 1000 + 1, { replace });

    expect(result).toBe(false);
    expect(replace).not.toHaveBeenCalled();
  });
});

describe("lineOaUrl", () => {
  test("accepts a lin.ee URL", () => {
    vi.stubEnv("VITE_LINE_OA_URL", "https://lin.ee/abc123");
    expect(lineOaUrl()).toBe("https://lin.ee/abc123");
  });

  test("accepts a line.me URL", () => {
    vi.stubEnv("VITE_LINE_OA_URL", "https://line.me/R/ti/p/@abc123");
    expect(lineOaUrl()).toBe("https://line.me/R/ti/p/@abc123");
  });

  test("rejects an http: URL", () => {
    vi.stubEnv("VITE_LINE_OA_URL", "http://lin.ee/abc123");
    expect(lineOaUrl()).toBe("");
  });

  test("rejects a non-LINE host", () => {
    vi.stubEnv("VITE_LINE_OA_URL", "https://evil.example.com/lin.ee");
    expect(lineOaUrl()).toBe("");
  });

  test("returns empty when unset", () => {
    vi.stubEnv("VITE_LINE_OA_URL", "");
    expect(lineOaUrl()).toBe("");
  });
});

describe("isLineInAppBrowser", () => {
  test("detects LINE's in-app browser user agent", () => {
    expect(
      isLineInAppBrowser(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Line/13.20.0",
      ),
    ).toBe(true);
  });

  test("does not flag an ordinary browser", () => {
    expect(isLineInAppBrowser("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120")).toBe(
      false,
    );
  });
});
