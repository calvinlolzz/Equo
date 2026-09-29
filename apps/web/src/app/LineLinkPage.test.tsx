// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { LineLinkPage } from "./LineLinkPage";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.lineLink;
const VALID_TOKEN = "abcd1234efgh5678";

function setUrl(search: string) {
  window.history.pushState(null, "", `/line/link${search}`);
}

/**
 * jsdom's Location.prototype.assign is non-configurable, so vi.spyOn cannot
 * wrap it directly. Replacing the whole `window.location` property (which IS
 * configurable) with a stub that keeps the real search/pathname/href and adds
 * a spyable `assign` is the standard workaround. The original descriptor is
 * restored in afterEach so later tests' pushState-driven URLs still show up.
 */
const originalLocationDescriptor = Object.getOwnPropertyDescriptor(window, "location")!;

function stubLocationAssign(): ReturnType<typeof vi.fn> {
  const assign = vi.fn();
  const original = window.location;
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...original, assign },
  });
  return assign;
}

function restoreLocation() {
  Object.defineProperty(window, "location", originalLocationDescriptor);
}

function aliceSession() {
  window.localStorage.setItem(
    "equo.clean.session",
    JSON.stringify({
      expiresAt: new Date(Date.now() + 86_400_000).toISOString(),
      user: { id: "user_alice", email: "alice@example.com", displayName: "Alice" },
    }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  setUrl(`?linkToken=${VALID_TOKEN}`);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  restoreLocation();
  window.localStorage.clear();
  window.sessionStorage.clear();
});

describe("LineLinkPage - signed out", () => {
  test("shows the sign-in button and stashes the token from the URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("should not fetch while signed out");
      }),
    );

    render(<LineLinkPage />);

    await waitFor(() => expect(screen.getByRole("button", { name: text.signIn })).toBeTruthy());
    expect(JSON.parse(window.sessionStorage.getItem("equo.clean.pending_line_link")!).linkToken).toBe(VALID_TOKEN);
  });
});

describe("LineLinkPage - confirm", () => {
  test("confirm POSTs to /me/line/link and navigates to LINE's accountLink dialog", async () => {
    aliceSession();
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url: String(url), init });
        if (String(url).includes("/me/line/link")) {
          return {
            ok: true,
            json: async () => ({
              redirect_url: `https://access.line.me/dialog/bot/accountLink?linkToken=${VALID_TOKEN}&nonce=abc`,
              currently_linked: false,
            }),
          } as Response;
        }
        if (String(url).includes("/me/line")) {
          return { ok: true, json: async () => ({ linked: false, linked_at: null }) } as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    const assignSpy = stubLocationAssign();

    render(<LineLinkPage />);

    const confirmButton = await screen.findByRole("button", { name: text.confirm });
    confirmButton.click();

    await waitFor(() => expect(assignSpy).toHaveBeenCalledTimes(1));
    const [navigatedTo] = assignSpy.mock.calls[0];
    expect(String(navigatedTo).startsWith("https://access.line.me/")).toBe(true);

    const linkCall = calls.find((c) => c.url.includes("/me/line/link"));
    expect(linkCall).toBeTruthy();
    expect(JSON.parse(String(linkCall!.init?.body)).link_token).toBe(VALID_TOKEN);
  });

  // [MV]: a redirect_url that doesn't start with https://access.line.me/
  // must never be navigated to. If the client-side re-check is removed, this
  // goes red.
  test("refuses to navigate to a redirect_url that isn't LINE's own dialog", async () => {
    aliceSession();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/me/line/link")) {
          return {
            ok: true,
            json: async () => ({ redirect_url: "https://evil.example.com/steal", currently_linked: false }),
          } as Response;
        }
        if (String(url).includes("/me/line")) {
          return { ok: true, json: async () => ({ linked: false, linked_at: null }) } as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );
    const assignSpy = stubLocationAssign();

    render(<LineLinkPage />);

    const confirmButton = await screen.findByRole("button", { name: text.confirm });
    confirmButton.click();

    await waitFor(() => expect(screen.getByText(text.failed)).toBeTruthy());
    expect(assignSpy).not.toHaveBeenCalled();
  });

  test("a 410 LINE_LINK_EXPIRED response shows the expired view", async () => {
    aliceSession();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/me/line/link")) {
          return {
            ok: false,
            status: 410,
            json: async () => ({ error: { code: "LINE_LINK_EXPIRED", message: "expired", request_id: "req" } }),
          } as Response;
        }
        if (String(url).includes("/me/line")) {
          return { ok: true, json: async () => ({ linked: false, linked_at: null }) } as Response;
        }
        throw new Error(`unexpected fetch ${url}`);
      }),
    );

    render(<LineLinkPage />);

    const confirmButton = await screen.findByRole("button", { name: text.confirm });
    confirmButton.click();

    await waitFor(() => expect(screen.getByText(text.expiredTitle)).toBeTruthy());
  });
});

describe("LineLinkPage - no token", () => {
  test("with no URL token and no stash, shows the expired view", async () => {
    setUrl("");
    render(<LineLinkPage />);
    await waitFor(() => expect(screen.getByText(text.expiredTitle)).toBeTruthy());
  });
});
