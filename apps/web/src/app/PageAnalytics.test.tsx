// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import { readAppFile } from "./cssDeclarations";

vi.mock("@vercel/analytics/react", () => ({
  Analytics: () => <div data-testid="analytics" />,
}));

import { PageAnalytics, analyticsAllowedOn } from "./PageAnalytics";

afterEach(cleanup);

describe("page-view analytics", () => {
  test.each(["/", "/group/abc", "/privacy", "/terms"])("runs on %s", (pathname) => {
    const { queryByTestId } = render(<PageAnalytics pathname={pathname} />);
    expect(queryByTestId("analytics")).not.toBeNull();
    expect(analyticsAllowedOn(pathname)).toBe(true);
  });

  // /liff URLs carry entry keys and, mid sign-in, LINE's own tokens; /line/link
  // carries the linkToken. A beacon can fire before either is cleaned up.
  test.each(["/liff", "/liff/", "/LIFF", "/liff/x", "/line/link", "/line/link/"])("does not run on %s", (pathname) => {
    const { queryByTestId } = render(<PageAnalytics pathname={pathname} />);
    expect(queryByTestId("analytics")).toBeNull();
    expect(analyticsAllowedOn(pathname)).toBe(false);
  });

  test("main.tsx reaches analytics only through PageAnalytics, so the exclusions cannot be bypassed", () => {
    // Comments explain the exclusions and name the component; only code counts.
    const main = readAppFile("..", "main.tsx")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(main).not.toMatch(/@vercel\/analytics/);
    expect(main).not.toMatch(/<Analytics\b/);
    expect(main).toMatch(/<PageAnalytics pathname=\{window\.location\.pathname\} \/>/);
  });
});
