import { describe, expect, test, vi } from "vitest";
import {
  LIFF_BOOTED_KEY,
  LIFF_RELOGIN_KEY,
  bootLiff,
  liffFallbackUrl,
  liffRedirectUri,
  readLiffIntent,
  reauthenticateLiff,
  type LiffBootDeps,
} from "./liffBoot";
import type { LiffSdk } from "./liffSdk";

const ORIGIN = "https://equo-mu.vercel.app";
const LEDGER = "0d9f4c7e-3b1a-4c55-9e0a-1f2a3b4c5d6e";
const ID_TOKEN = "aaa.bbb.ccc";
const BEARER = "equoL1.payload.sig";

function sessionResponse(overrides: Record<string, unknown> = {}) {
  return {
    session: {
      token: BEARER,
      expires_at: "2026-11-02T10:00:00.000Z",
      user: {
        id: "user_1",
        google_sub: "g1",
        email: "a@example.com",
        display_name: "Alice",
        avatar_url: null,
      },
      ledger_id: LEDGER,
      locale: "zh-Hant" as const,
      ...overrides,
    },
  };
}

function apiError(code: string): Error & { code: string } {
  return Object.assign(new Error(code), { code });
}

class FakeStorage {
  readonly map = new Map<string, string>();
  throwOnSet = false;
  getItem = (key: string) => this.map.get(key) ?? null;
  setItem = (key: string, value: string) => {
    if (this.throwOnSet) throw new Error("denied");
    this.map.set(key, value);
  };
  removeItem = (key: string) => {
    this.map.delete(key);
  };
}

type Harness = ReturnType<typeof harness>;

function harness(
  options: {
    search?: string;
    liffId?: string | null;
    loggedIn?: boolean;
    idToken?: string | null;
    exchange?: () => Promise<ReturnType<typeof sessionResponse>>;
    config?: () => Promise<{ liff_id: string | null }>;
    init?: () => Promise<void>;
    navigationType?: string;
    storage?: FakeStorage;
  } = {},
) {
  const storage = options.storage ?? new FakeStorage();
  const order: string[] = [];
  const sdk = {
    init: vi.fn(async (_o: { liffId: string }) => {
      order.push("init");
      await options.init?.();
    }),
    isLoggedIn: vi.fn(() => options.loggedIn ?? true),
    isInClient: vi.fn(() => true),
    login: vi.fn((_o?: { redirectUri?: string }) => {
      order.push("login");
    }),
    logout: vi.fn(() => {
      order.push("logout");
    }),
    getIDToken: vi.fn(() => (options.idToken === undefined ? ID_TOKEN : options.idToken)),
    closeWindow: vi.fn(),
    openWindow: vi.fn(),
  } satisfies LiffSdk;
  const api = {
    getLiffConfig: vi.fn(async () => {
      order.push("config");
      return options.config ? options.config() : { liff_id: options.liffId === undefined ? "2011782032-WJwjePnJ" : options.liffId };
    }),
    exchangeLineIdToken: vi.fn(async (_token: string) => {
      order.push("exchange");
      return options.exchange ? options.exchange() : sessionResponse();
    }),
  };
  const setBearer = vi.fn((_t: string | null) => {
    order.push("bearer");
  });
  const replaceUrl = vi.fn((_p: string) => {
    order.push("replace");
  });
  const deps: LiffBootDeps = {
    sdk: async () => sdk,
    api,
    location: { origin: ORIGIN, pathname: "/liff", search: options.search ?? "" },
    storage,
    setBearer,
    navigationType: () => options.navigationType,
    replaceUrl,
  };
  return { deps, sdk, api, setBearer, replaceUrl, storage, order };
}

describe("bootLiff: the happy path", () => {
  test("goes config, init, exchange, bearer, URL, ready - in that order, once each", async () => {
    const h = harness({ search: "?view=records" });

    const state = await bootLiff(h.deps);

    expect(h.order).toEqual(["config", "init", "exchange", "bearer", "replace"]);
    expect(h.sdk.init).toHaveBeenCalledWith({ liffId: "2011782032-WJwjePnJ" });
    expect(h.api.exchangeLineIdToken).toHaveBeenCalledTimes(1);
    expect(h.api.exchangeLineIdToken).toHaveBeenCalledWith(ID_TOKEN);
    expect(h.setBearer).toHaveBeenCalledWith(BEARER);
    expect(h.sdk.login).not.toHaveBeenCalled();
    expect(state).toEqual({
      phase: "ready",
      ledgerId: LEDGER,
      intent: { kind: "records" },
      session: {
        expiresAt: "2026-11-02T10:00:00.000Z",
        user: { id: "user_1", email: "a@example.com", displayName: "Alice", avatarUrl: undefined },
      },
    });
  });

  test("replaces the address with the ledger path alone - no query, no fragment", async () => {
    const h = harness({ search: "?entry=msg%3A1234567890&code=SECRET&liffClientId=1" });
    await bootLiff(h.deps);
    expect(h.replaceUrl).toHaveBeenCalledTimes(1);
    expect(h.replaceUrl).toHaveBeenCalledWith(`/group/${LEDGER}`);
  });

  test("the bearer and the LINE ID token never reach the tab's storage", async () => {
    const h = harness();
    await bootLiff(h.deps);
    const stored = JSON.stringify([...h.storage.map.entries()]);
    expect(stored).not.toContain(BEARER);
    expect(stored).not.toContain(ID_TOKEN);
    expect([...h.storage.map.keys()]).toEqual([LIFF_BOOTED_KEY]);
  });

  test("an intent-less open is ready with a null intent", async () => {
    const state = await bootLiff(harness().deps);
    expect(state).toMatchObject({ phase: "ready", intent: null });
  });
});

describe("bootLiff: before the sign-in", () => {
  test("a page restored from history, after this tab signed in once, closes itself and asks for nothing", async () => {
    const storage = new FakeStorage();
    storage.setItem(LIFF_BOOTED_KEY, "1");
    const h = harness({ navigationType: "back_forward", storage });

    const state = await bootLiff(h.deps);

    expect(state).toEqual({ phase: "redirecting" });
    expect(h.sdk.closeWindow).toHaveBeenCalledTimes(1);
    expect(h.api.getLiffConfig).not.toHaveBeenCalled();
    expect(h.api.exchangeLineIdToken).not.toHaveBeenCalled();
  });

  test("back/forward in a tab that never signed in is an ordinary boot", async () => {
    const h = harness({ navigationType: "back_forward" });
    expect(await bootLiff(h.deps)).toMatchObject({ phase: "ready" });
    expect(h.sdk.closeWindow).not.toHaveBeenCalled();
  });

  test("a reload or fresh navigation does not close", async () => {
    const storage = new FakeStorage();
    storage.setItem(LIFF_BOOTED_KEY, "1");
    const h = harness({ navigationType: "reload", storage });
    expect(await bootLiff(h.deps)).toMatchObject({ phase: "ready" });
    expect(h.sdk.closeWindow).not.toHaveBeenCalled();
  });

  test("LIFF switched off (no id) is unavailable, with the browser app as the way out, and never initialises", async () => {
    const h = harness({ liffId: null, search: "?view=analysis" });
    const state = await bootLiff(h.deps);
    expect(state).toEqual({
      phase: "unavailable",
      fallbackUrl: `${ORIGIN}/?view=analysis&openExternalBrowser=1`,
    });
    expect(h.sdk.init).not.toHaveBeenCalled();
  });

  test("an unreachable config is a failure, not a blank page", async () => {
    const h = harness({
      config: async () => {
        throw apiError("NETWORK_ERROR");
      },
    });
    expect(await bootLiff(h.deps)).toEqual({ phase: "failed", fallbackUrl: `${ORIGIN}/?openExternalBrowser=1` });
    expect(h.sdk.init).not.toHaveBeenCalled();
  });

  test("an SDK that cannot load is a failure", async () => {
    const h = harness();
    h.deps.sdk = async () => {
      throw new Error("chunk failed");
    };
    expect(await bootLiff(h.deps)).toMatchObject({ phase: "failed" });
  });

  test("init throwing is a failure, and nothing is exchanged", async () => {
    const h = harness({
      init: async () => {
        throw new Error("INIT_FAILED");
      },
    });
    expect(await bootLiff(h.deps)).toMatchObject({ phase: "failed" });
    expect(h.api.exchangeLineIdToken).not.toHaveBeenCalled();
    expect(h.setBearer).not.toHaveBeenCalled();
  });
});

describe("bootLiff: logging in", () => {
  test("not logged in sends the user to LINE once, back to /liff with the same intent and nothing else", async () => {
    const h = harness({
      loggedIn: false,
      search: "?entry=msg%3A1234567890&code=SECRET&liffClientId=1&liff.state=%2Fx#access_token=SECRET",
    });

    const state = await bootLiff(h.deps);

    expect(state).toEqual({ phase: "redirecting" });
    expect(h.sdk.login).toHaveBeenCalledTimes(1);
    expect(h.sdk.login).toHaveBeenCalledWith({ redirectUri: `${ORIGIN}/liff?entry=msg%3A1234567890` });
    expect(h.api.exchangeLineIdToken).not.toHaveBeenCalled();
    expect(h.storage.map.get(LIFF_RELOGIN_KEY)).toBe("1");
  });

  test("a second visit to LINE's login in the same tab is refused: failed, not a loop", async () => {
    const storage = new FakeStorage();
    const first = harness({ loggedIn: false, storage });
    await bootLiff(first.deps);

    const second = harness({ loggedIn: false, storage });
    expect(await bootLiff(second.deps)).toMatchObject({ phase: "failed" });
    expect(second.sdk.login).not.toHaveBeenCalled();
  });

  test("logged in with no ID token goes to login, under the same once-per-tab guard", async () => {
    const storage = new FakeStorage();
    const first = harness({ idToken: null, storage });
    expect(await bootLiff(first.deps)).toEqual({ phase: "redirecting" });
    expect(first.sdk.login).toHaveBeenCalledTimes(1);
    expect(first.api.exchangeLineIdToken).not.toHaveBeenCalled();

    const second = harness({ idToken: null, storage });
    expect(await bootLiff(second.deps)).toMatchObject({ phase: "failed" });
    expect(second.sdk.login).not.toHaveBeenCalled();
  });

  test("an expired ID token logs out and in again - once per tab", async () => {
    const storage = new FakeStorage();
    const expired = () => Promise.reject(apiError("LINE_ID_TOKEN_EXPIRED"));
    const first = harness({ exchange: expired, storage, search: "?view=records" });

    expect(await bootLiff(first.deps)).toEqual({ phase: "redirecting" });
    expect(first.order.slice(-2)).toEqual(["logout", "login"]);
    expect(first.sdk.login).toHaveBeenCalledWith({ redirectUri: `${ORIGIN}/liff?view=records` });
    expect(first.setBearer).not.toHaveBeenCalled();

    // Back from LINE with a token that is STILL expired: no second trip.
    const second = harness({ exchange: expired, storage });
    expect(await bootLiff(second.deps)).toMatchObject({ phase: "failed" });
    expect(second.sdk.login).not.toHaveBeenCalled();
    expect(second.sdk.logout).not.toHaveBeenCalled();
  });

  test("a sign-in that works gives the next expiry its single re-login back", async () => {
    const storage = new FakeStorage();
    const expired = () => Promise.reject(apiError("LINE_ID_TOKEN_EXPIRED"));

    await bootLiff(harness({ exchange: expired, storage }).deps);
    expect(storage.map.has(LIFF_RELOGIN_KEY)).toBe(true);

    expect(await bootLiff(harness({ storage }).deps)).toMatchObject({ phase: "ready" });
    expect(storage.map.has(LIFF_RELOGIN_KEY)).toBe(false);

    const later = harness({ exchange: expired, storage });
    expect(await bootLiff(later.deps)).toEqual({ phase: "redirecting" });
  });

  test("when the guard cannot be written down, redirecting could loop forever, so it does not", async () => {
    const storage = new FakeStorage();
    storage.throwOnSet = true;
    const h = harness({ loggedIn: false, storage });
    expect(await bootLiff(h.deps)).toMatchObject({ phase: "failed" });
    expect(h.sdk.login).not.toHaveBeenCalled();
  });
});

describe("bootLiff: the exchange says no", () => {
  test("not linked", async () => {
    const h = harness({ exchange: () => Promise.reject(apiError("LINE_NOT_LINKED")) });
    expect(await bootLiff(h.deps)).toEqual({ phase: "notLinked" });
    expect(h.setBearer).not.toHaveBeenCalled();
    expect(h.replaceUrl).not.toHaveBeenCalled();
  });

  test("account disabled", async () => {
    const h = harness({ exchange: () => Promise.reject(apiError("ACCOUNT_DISABLED")) });
    expect(await bootLiff(h.deps)).toEqual({ phase: "disabled" });
    expect(h.setBearer).not.toHaveBeenCalled();
  });

  test.each(["LINE_ID_TOKEN_INVALID", "NO_LEDGER", "RATE_LIMITED", "LINE_UNAVAILABLE", "NETWORK_ERROR", "SERVER_ERROR", "WHO_KNOWS"])(
    "%s is a failure with the browser app as the way out, and no session",
    async (code) => {
      const h = harness({ exchange: () => Promise.reject(apiError(code)), search: "?view=records" });
      const state = await bootLiff(h.deps);
      expect(state).toEqual({ phase: "failed", fallbackUrl: `${ORIGIN}/?view=records&openExternalBrowser=1` });
      expect(h.setBearer).not.toHaveBeenCalled();
      expect(h.sdk.login).not.toHaveBeenCalled();
    },
  );
});

describe("readLiffIntent: only the closed set, never a URL", () => {
  const KEY = "msg:1234567890";

  test("reads the endpoint URL's own query", () => {
    expect(readLiffIntent("?view=records")).toEqual({ kind: "records" });
    expect(readLiffIntent("?view=analysis")).toEqual({ kind: "analysis" });
    expect(readLiffIntent(`?entry=${encodeURIComponent(KEY)}`)).toEqual({ kind: "entry", entryKey: KEY });
    expect(readLiffIntent(`?view=records&entry=${encodeURIComponent(KEY)}`)).toEqual({ kind: "entry", entryKey: KEY });
  });

  test("reads liff.state, with or without a path in front", () => {
    expect(readLiffIntent(`?liff.state=${encodeURIComponent("?view=analysis")}`)).toEqual({ kind: "analysis" });
    expect(readLiffIntent(`?liff.state=${encodeURIComponent(`/some/path?entry=${KEY}`)}`)).toEqual({
      kind: "entry",
      entryKey: KEY,
    });
    expect(readLiffIntent(`?liff.state=${encodeURIComponent("?view=records#frag")}`)).toEqual({ kind: "records" });
  });

  test("the URL's own query wins over liff.state", () => {
    expect(readLiffIntent(`?view=records&liff.state=${encodeURIComponent("?view=analysis")}`)).toEqual({ kind: "records" });
  });

  test.each([
    ["an absolute URL", "https://evil.example/"],
    ["a protocol-relative URL", "//evil.example/x"],
    ["a script URL", "javascript:alert(1)"],
    ["a path with no query", "/group/other"],
    ["a view that is a URL", "?view=https://evil.example"],
    ["an unknown view", "?view=members"],
    ["an entry that is a URL", "?entry=https://evil.example/x"],
    ["a too-short entry", "?entry=abc"],
    ["an entry with a slash", "?entry=aaaaaaaa/../bbbb"],
    ["a nested liff.state", `?liff.state=${encodeURIComponent("?liff.state=%3Fview%3Drecords")}`],
  ])("%s is ignored", (_name, state) => {
    expect(readLiffIntent(`?liff.state=${encodeURIComponent(state)}`)).toBeNull();
  });

  test("nothing at all is null", () => {
    expect(readLiffIntent("")).toBeNull();
    expect(readLiffIntent("?code=abc&liffClientId=1")).toBeNull();
  });

  test("boot honours liff.state, and what it opens is only ever an intent", async () => {
    const h = harness({ search: `?liff.state=${encodeURIComponent("https://evil.example/?view=records")}` });
    const state = await bootLiff(h.deps);
    // The only thing taken from it is the closed-set query; the URL part is dropped.
    expect(state).toMatchObject({ phase: "ready", intent: { kind: "records" } });
    expect(h.replaceUrl).toHaveBeenCalledWith(`/group/${LEDGER}`);

    const hostile = harness({ search: `?liff.state=${encodeURIComponent("https://evil.example/")}` });
    expect(await bootLiff(hostile.deps)).toMatchObject({ phase: "ready", intent: null });
    expect(hostile.replaceUrl).toHaveBeenCalledWith(`/group/${LEDGER}`);
  });
});

describe("the URLs it builds", () => {
  test("login returns to /liff with only the intent", () => {
    expect(liffRedirectUri(ORIGIN, null)).toBe(`${ORIGIN}/liff`);
    expect(liffRedirectUri(ORIGIN, { kind: "analysis" })).toBe(`${ORIGIN}/liff?view=analysis`);
    expect(liffRedirectUri(ORIGIN, { kind: "entry", entryKey: "msg:1234567890" })).toBe(
      `${ORIGIN}/liff?entry=msg%3A1234567890`,
    );
  });

  test("the browser fallback carries the same intent and LINE's open-externally flag", () => {
    expect(liffFallbackUrl(ORIGIN, null, null)).toBe(`${ORIGIN}/?openExternalBrowser=1`);
    expect(liffFallbackUrl(ORIGIN, LEDGER, { kind: "records" })).toBe(
      `${ORIGIN}/group/${LEDGER}?view=records&openExternalBrowser=1`,
    );
  });
});

describe("reauthenticateLiff: a 401 on an ordinary request", () => {
  function reauth(options: Parameters<typeof harness>[0] = {}) {
    const h = harness(options);
    return { h, run: () => reauthenticateLiff(h.deps) };
  }

  test("drops the old bearer BEFORE the exchange, then installs the new one", async () => {
    const { h, run } = reauth();
    await expect(run()).resolves.toBe(true);
    expect(h.order).toEqual(["bearer", "exchange", "bearer"]);
    expect(h.setBearer.mock.calls).toEqual([[null], [BEARER]]);
  });

  test("an exchange that fails leaves no bearer at all", async () => {
    const { h, run } = reauth({ exchange: () => Promise.reject(apiError("LINE_NOT_LINKED")) });
    await expect(run()).resolves.toBe(false);
    expect(h.setBearer.mock.calls).toEqual([[null]]);
  });

  test.each(["ACCOUNT_DISABLED", "LINE_UNAVAILABLE", "RATE_LIMITED", "NETWORK_ERROR", "LINE_ID_TOKEN_INVALID"])(
    "%s ends the session",
    async (code) => {
      const { run } = reauth({ exchange: () => Promise.reject(apiError(code)) });
      await expect(run()).resolves.toBe(false);
    },
  );

  test("an expired LINE token re-logs-in once and reports that the page is on its way out", async () => {
    const storage = new FakeStorage();
    const expired = () => Promise.reject(apiError("LINE_ID_TOKEN_EXPIRED"));
    const first = harness({ exchange: expired, storage });

    await expect(reauthenticateLiff(first.deps)).resolves.toBe(true);
    expect(first.order.slice(-2)).toEqual(["logout", "login"]);
    expect(first.sdk.login).toHaveBeenCalledWith({ redirectUri: `${ORIGIN}/liff` });

    const second = harness({ exchange: expired, storage });
    await expect(reauthenticateLiff(second.deps)).resolves.toBe(false);
    expect(second.sdk.login).not.toHaveBeenCalled();
  });

  test("not logged in or no token goes to login, once", async () => {
    const storage = new FakeStorage();
    const first = harness({ loggedIn: false, storage });
    await expect(reauthenticateLiff(first.deps)).resolves.toBe(true);
    expect(first.sdk.login).toHaveBeenCalledTimes(1);

    const second = harness({ idToken: null, storage });
    await expect(reauthenticateLiff(second.deps)).resolves.toBe(false);
  });

  test("an SDK that will not load ends the session instead of throwing", async () => {
    const { h } = reauth();
    h.deps.sdk = async () => {
      throw new Error("chunk failed");
    };
    await expect(reauthenticateLiff(h.deps)).resolves.toBe(false);
  });
});
