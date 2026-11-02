// @vitest-environment jsdom
import { describe, expect, test, vi } from "vitest";
import { blockedOrigin, describeViolation, installCspViolationReporter } from "./cspReporter";

function violation(blockedURI: string, effectiveDirective = "connect-src") {
  const event = new Event("securitypolicyviolation");
  Object.assign(event, { blockedURI, effectiveDirective });
  return event;
}

describe("blockedOrigin", () => {
  test("keeps the origin and drops path, query and fragment", () => {
    expect(blockedOrigin("https://api.line.me/oauth2/v2.1/token?code=SECRET#access_token=SECRET")).toBe(
      "https://api.line.me",
    );
  });

  test.each([
    ["inline", "inline"],
    ["eval", "eval"],
    ["data:text/html,<script>SECRET</script>", "data:"],
    ["blob:https://equo-mu.vercel.app/abc", "blob:"],
    ["", "unknown"],
    ["Some Garbage With Spaces And Tokens", "unknown"],
  ])("%s becomes %s", (input, expected) => {
    expect(blockedOrigin(input)).toBe(expected);
  });
});

describe("describeViolation", () => {
  test("names the origin and the directive and nothing else", () => {
    const message = describeViolation({
      blockedURI: "https://example.com/path?token=SECRET",
      effectiveDirective: "script-src-elem",
    });
    expect(message).toBe("[liff csp] blocked https://example.com (script-src-elem)");
    expect(message).not.toContain("SECRET");
  });

  test("stays quiet about the origins the SDK asks for on every open and we keep blocked", () => {
    expect(
      describeViolation({ blockedURI: "https://static.line-scdn.net/liff/edge/2/x.js", effectiveDirective: "script-src-elem" }),
    ).toBeNull();
    expect(
      describeViolation({ blockedURI: "https://liffsdk.line-scdn.net/xlt/manifest.json", effectiveDirective: "connect-src" }),
    ).toBeNull();
  });

  test("an origin that merely contains an expected one is still reported", () => {
    expect(
      describeViolation({ blockedURI: "https://static.line-scdn.net.evil.example/x.js", effectiveDirective: "script-src" }),
    ).not.toBeNull();
  });

  test("an odd directive string is not echoed", () => {
    expect(describeViolation({ blockedURI: "https://a.example", effectiveDirective: "x y z SECRET!" })).toBe(
      "[liff csp] blocked https://a.example (unknown)",
    );
  });
});

describe("installCspViolationReporter", () => {
  test("reports a violation once, as source liff, with the page path only", () => {
    const target = new EventTarget();
    const send = vi.fn();
    installCspViolationReporter({ target, send, page: () => "/group/abc" });

    target.dispatchEvent(violation("https://cdn.example/lib.js?k=SECRET", "script-src-elem"));
    target.dispatchEvent(violation("https://cdn.example/other.js", "script-src-elem"));

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith({
      source: "liff",
      message: "[liff csp] blocked https://cdn.example (script-src-elem)",
      page: "/group/abc",
    });
  });

  test("ignores the expected origins", () => {
    const target = new EventTarget();
    const send = vi.fn();
    installCspViolationReporter({ target, send });
    target.dispatchEvent(violation("https://static.line-scdn.net/a.js", "script-src-elem"));
    expect(send).not.toHaveBeenCalled();
  });

  test("the returned function stops listening", () => {
    const target = new EventTarget();
    const send = vi.fn();
    const stop = installCspViolationReporter({ target, send });
    stop();
    target.dispatchEvent(violation("https://cdn.example/lib.js"));
    expect(send).not.toHaveBeenCalled();
  });

  test("caps what one page load can send", () => {
    const target = new EventTarget();
    const send = vi.fn();
    installCspViolationReporter({ target, send });
    for (let i = 0; i < 20; i += 1) target.dispatchEvent(violation(`https://host${i}.example/x`));
    expect(send.mock.calls.length).toBeLessThanOrEqual(5);
  });
});
