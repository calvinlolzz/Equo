// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
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

function stubUserAgent(userAgent: string) {
  Object.defineProperty(window.navigator, "userAgent", { configurable: true, value: userAgent });
}

afterEach(() => {
  delete (window.navigator as { userAgent?: string }).userAgent;
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

describe("LineLinkPage - inside LINE's in-app browser", () => {
  const LINE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Line/13.0.0";

  // [MV]
  test("signed out: offers a real open-in-browser link that carries the token, and keeps it in the address bar", async () => {
    stubUserAgent(LINE_UA);
    vi.stubGlobal("fetch", vi.fn());

    render(<LineLinkPage />);

    const link = (await screen.findByRole("link", { name: text.openInBrowser })) as HTMLAnchorElement;
    const href = new URL(link.href);
    expect(href.pathname).toBe("/line/link");
    expect(href.searchParams.get("linkToken")).toBe(VALID_TOKEN);
    expect(href.searchParams.get("openExternalBrowser")).toBe("1");
    expect(link.target).toBe("_blank");
    expect(link.rel).toContain("noopener");
    // Not stripped here: LINE's own "open in browser" reopens the CURRENT url.
    expect(window.location.search).toContain(`linkToken=${VALID_TOKEN}`);
    // ...and there is no Google button that could only dead-end.
    expect(screen.queryByRole("button", { name: text.signIn })).toBeNull();
  });

  test("an ordinary browser still strips the token from the address bar", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<LineLinkPage />);
    await screen.findByRole("button", { name: text.signIn });
    expect(window.location.search).not.toContain("linkToken");
    expect(screen.queryByRole("link", { name: text.openInBrowser })).toBeNull();
  });
});

describe("LineLinkPage - intro", () => {
  test("shows the intro above the sign-in and the confirm content", async () => {
    vi.stubGlobal("fetch", vi.fn());
    render(<LineLinkPage />);
    await screen.findByRole("button", { name: text.signIn });
    expect(screen.getByText(text.intro)).toBeTruthy();

    cleanup();
    aliceSession();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({ linked: false, linked_at: null }) }) as Response),
    );
    setUrl(`?linkToken=${VALID_TOKEN}`);
    render(<LineLinkPage />);
    await screen.findByRole("button", { name: text.confirm });
    expect(screen.getByText(text.intro)).toBeTruthy();
  });
});

describe("LineLinkPage - restored from the back/forward cache", () => {
  async function stuckOnRedirecting() {
    aliceSession();
    vi.stubGlobal(
      "fetch",
      vi.fn((url: string) => {
        if (String(url).includes("/me/line/link")) return new Promise(() => {}); // never settles
        return Promise.resolve({ ok: true, json: async () => ({ linked: false, linked_at: null }) } as Response);
      }),
    );
    render(<LineLinkPage />);
    (await screen.findByRole("button", { name: text.confirm })).click();
    await screen.findByRole("button", { name: text.redirecting });
  }

  function pageshow(persisted: boolean) {
    act(() => {
      window.dispatchEvent(Object.assign(new Event("pageshow"), { persisted }));
    });
  }

  // [MV]
  test("goes back to the confirm step when the token is still stashed", async () => {
    await stuckOnRedirecting();
    pageshow(true);
    expect(await screen.findByRole("button", { name: text.confirm })).toBeTruthy();
  });

  test("goes to the expired view when the stash is gone", async () => {
    await stuckOnRedirecting();
    window.sessionStorage.clear();
    pageshow(true);
    expect(await screen.findByText(text.expiredTitle)).toBeTruthy();
  });

  test("a pageshow that is not from the cache changes nothing", async () => {
    await stuckOnRedirecting();
    pageshow(false);
    expect(screen.getByRole("button", { name: text.redirecting })).toBeTruthy();
  });
});
