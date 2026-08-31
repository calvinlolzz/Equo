import { describe, expect, it } from "vitest";
import { resolvePublicPage } from "./publicRoute";

describe("resolvePublicPage", () => {
  it("maps the two legal paths", () => {
    expect(resolvePublicPage("/privacy")).toBe("privacy");
    expect(resolvePublicPage("/terms")).toBe("terms");
  });

  it("accepts the spellings people actually type", () => {
    expect(resolvePublicPage("/privacy/")).toBe("privacy");
    expect(resolvePublicPage("/Privacy")).toBe("privacy");
    expect(resolvePublicPage("/TERMS//")).toBe("terms");
  });

  it("leaves every other path to the app", () => {
    expect(resolvePublicPage("/")).toBeNull();
    expect(resolvePublicPage("/group/abc")).toBeNull();
    expect(resolvePublicPage("/admin")).toBeNull();
    // Near-misses must not swallow app routes: a prefix match here would send
    // /privacy-policy-request or /terms/of/service to a page that cannot serve
    // them, and the app shell would never see the URL.
    expect(resolvePublicPage("/privacy-policy")).toBeNull();
    expect(resolvePublicPage("/terms/of/service")).toBeNull();
  });
});
