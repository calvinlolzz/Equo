// @vitest-environment jsdom
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import type { StoredSession } from "./sessionStore";
import { UI_TEXT } from "./uiText";
import { useAuthSession } from "./useAuthSession";

/**
 * useAuthSession in LIFF mode: a session handed in, nothing read from or written
 * to the browser's storage, and an expiry that asks the page for a replacement
 * instead of signing out. The normal app's own saved session on the same origin
 * has to come through all of it untouched.
 */
const INJECTED: StoredSession = {
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: { id: "user_liff", email: "liff@example.com", displayName: "Liff" },
};

const NORMAL_SESSION = JSON.stringify({
  expiresAt: "2099-01-01T00:00:00.000Z",
  user: { id: "user_normal", email: "normal@example.com", displayName: "Normal" },
});

function snapshot(): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (let i = 0; i < window.localStorage.length; i += 1) {
    const key = window.localStorage.key(i)!;
    out[key] = window.localStorage.getItem(key);
  }
  return out;
}

function stubGroups(status: number, body: unknown) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const UNAUTHENTICATED = { error: { code: "UNAUTHENTICATED", message: "no" } };

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/liff");
  window.localStorage.setItem("equo.clean.session", NORMAL_SESSION);
  window.localStorage.setItem("equo.clean.cloud_cache", JSON.stringify({ userId: "user_normal", groups: [], groupDetails: {} }));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function mount(options: Partial<Parameters<typeof useAuthSession>[0]> = {}) {
  const showToast = vi.fn();
  const onSignedOut = vi.fn();
  const hook = renderHook(() =>
    useAuthSession({
      showToast,
      onSignedIn: vi.fn(),
      onSignedOut,
      injectedSession: INJECTED,
      persist: false,
      skipOAuthFragment: true,
      ...options,
    }),
  );
  return { ...hook, showToast, onSignedOut };
}

describe("an injected, non-persisting session", () => {
  test("is the session, and the saved normal one is not consulted", () => {
    stubGroups(200, { groups: [] });
    const { result } = mount();
    expect(result.current.session).toEqual(INJECTED);
  });

  test("storage is exactly as it was after the session loads, syncs and unmounts", async () => {
    const before = snapshot();
    const fetchMock = stubGroups(200, { groups: [] });
    const { unmount } = mount();
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    // The cloud cache is written ~300ms after the data lands; wait it out.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 450));
    });
    unmount();
    expect(snapshot()).toEqual(before);
  });

  test("a sign-out never clears the normal app's saved session or cache", () => {
    stubGroups(200, { groups: [] });
    const before = snapshot();
    const { result, onSignedOut } = mount();
    act(() => result.current.signOut());
    expect(result.current.session).toBeNull();
    expect(onSignedOut).toHaveBeenCalled();
    expect(snapshot()).toEqual(before);
  });

  test("Google sign-in is a no-op: no redirect, nothing stashed", () => {
    stubGroups(200, { groups: [] });
    const { result } = mount();
    const before = snapshot();
    act(() => result.current.startGoogleLogin());
    expect(snapshot()).toEqual(before);
    expect(window.sessionStorage.length).toBe(0);
  });

  test("an OAuth-looking fragment is left alone and never exchanged", async () => {
    const fetchMock = stubGroups(200, { groups: [] });
    window.history.replaceState(null, "", "/liff#access_token=LINE_SECRET&token_type=bearer");
    mount();
    await act(async () => {});
    expect(window.location.hash).toBe("#access_token=LINE_SECRET&token_type=bearer");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("/auth/supabase"))).toBe(false);
  });

  test("the same fragment IS exchanged in the ordinary app (the guard is the flag, not the page)", async () => {
    const fetchMock = stubGroups(401, UNAUTHENTICATED);
    window.localStorage.clear();
    window.history.replaceState(null, "", "/#access_token=abc&token_type=bearer");
    renderHook(() => useAuthSession({ showToast: vi.fn(), onSignedIn: vi.fn(), onSignedOut: vi.fn() }));
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(0));
    expect(window.location.hash).toBe("");
  });
});

describe("a session that expires", () => {
  test("asks the page for a replacement and keeps going when it gets one", async () => {
    stubGroups(401, UNAUTHENTICATED);
    const onSessionExpired = vi.fn(async () => true);
    const { result, showToast } = mount({ onSessionExpired });
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalled());
    await act(async () => {});
    expect(result.current.session).toEqual(INJECTED);
    // (The failed sync itself toasts; the session-ended toast is the one that must not.)
    expect(showToast).not.toHaveBeenCalledWith(UI_TEXT.app.sessionExpired);
  });

  test("ends when the page cannot supply one - and still leaves the normal app's storage alone", async () => {
    const before = snapshot();
    stubGroups(401, UNAUTHENTICATED);
    const onSessionExpired = vi.fn(async () => false);
    const { result, showToast } = mount({ onSessionExpired });
    await waitFor(() => expect(result.current.session).toBeNull());
    expect(showToast).toHaveBeenCalledWith(UI_TEXT.app.sessionExpired);
    expect(snapshot()).toEqual(before);
  });

  test("a callback that throws is the same as one that says no", async () => {
    stubGroups(401, UNAUTHENTICATED);
    const onSessionExpired = vi.fn(async () => {
      throw new Error("boom");
    });
    const { result } = mount({ onSessionExpired });
    await waitFor(() => expect(result.current.session).toBeNull());
  });

  test("a burst of 401s renews once", async () => {
    const fetchMock = stubGroups(401, UNAUTHENTICATED);
    let release: (value: boolean) => void = () => {};
    const onSessionExpired = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          release = resolve;
        }),
    );
    const { result } = mount({ onSessionExpired });
    await waitFor(() => expect(onSessionExpired).toHaveBeenCalledTimes(1));
    // A second request fails with 401 while the first renewal is still in flight.
    await act(async () => {
      await result.current.cloudStore!.refreshGroups().catch(() => {});
    });
    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(onSessionExpired).toHaveBeenCalledTimes(1);
    await act(async () => release(true));
    expect(result.current.session).toEqual(INJECTED);
  });

  test("without a callback the session simply ends, as it always did", async () => {
    stubGroups(401, UNAUTHENTICATED);
    const { result } = mount();
    await waitFor(() => expect(result.current.session).toBeNull());
  });
});

describe("the default (persisting) mode is unchanged", () => {
  test("loads the saved session and clears it on expiry", async () => {
    stubGroups(401, UNAUTHENTICATED);
    window.history.replaceState(null, "", "/");
    const { result } = renderHook(() =>
      useAuthSession({ showToast: vi.fn(), onSignedIn: vi.fn(), onSignedOut: vi.fn() }),
    );
    expect(result.current.session?.user.id).toBe("user_normal");
    await waitFor(() => expect(result.current.session).toBeNull());
    expect(window.localStorage.getItem("equo.clean.session")).toBeNull();
  });
});
