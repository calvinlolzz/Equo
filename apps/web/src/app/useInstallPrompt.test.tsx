// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { INSTALL_DISMISSED_KEY, useInstallPrompt } from "./useInstallPrompt";

function stubBrowser(options: { userAgent?: string; standalone?: boolean; maxTouchPoints?: number } = {}) {
  vi.stubGlobal(
    "matchMedia",
    vi.fn((query: string) => ({
      matches: Boolean(options.standalone) && query.includes("display-mode"),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })),
  );
  Object.defineProperty(window, "navigator", {
    configurable: true,
    value: {
      userAgent: options.userAgent ?? "Mozilla/5.0 (Linux; Android 14) Chrome/124",
      maxTouchPoints: options.maxTouchPoints ?? 0,
      ...(options.standalone === true ? { standalone: true } : {}),
    },
  });
}

/** The Chromium event, close enough for the hook's purposes. */
function firePrompt() {
  const event = new Event("beforeinstallprompt") as Event & {
    prompt: () => Promise<void>;
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
  };
  event.prompt = vi.fn(async () => {});
  event.userChoice = Promise.resolve({ outcome: "accepted" as const });
  act(() => {
    window.dispatchEvent(event);
  });
  return event;
}

beforeEach(() => {
  window.localStorage.clear();
  stubBrowser();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("useInstallPrompt", () => {
  test("offers nothing until the browser says the app is installable", () => {
    const { result } = renderHook(() => useInstallPrompt());

    expect(result.current.state).toBe("unavailable");
  });

  test("becomes installable when Chromium fires beforeinstallprompt", () => {
    const { result } = renderHook(() => useInstallPrompt());

    firePrompt();

    expect(result.current.state).toBe("installable");
  });

  test("installing fires the real dialog and retires the hint for good", async () => {
    const { result } = renderHook(() => useInstallPrompt());
    const event = firePrompt();

    await act(async () => {
      await result.current.promptInstall();
    });

    expect(event.prompt).toHaveBeenCalled();
    expect(result.current.state).toBe("unavailable");
    expect(window.localStorage.getItem(INSTALL_DISMISSED_KEY)).toBe("1");
  });

  test("a dismissal is remembered across reloads — nobody gets asked twice", () => {
    const first = renderHook(() => useInstallPrompt());
    firePrompt();
    act(() => first.result.current.dismiss());
    expect(first.result.current.state).toBe("unavailable");

    // A fresh mount is what a reload looks like.
    const second = renderHook(() => useInstallPrompt());
    firePrompt();
    expect(second.result.current.state).toBe("unavailable");
  });

  test("iOS Safari gets manual instructions, since it has no install API", () => {
    stubBrowser({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Version/17.0 Safari" });

    const { result } = renderHook(() => useInstallPrompt());

    // No beforeinstallprompt will ever fire here.
    expect(result.current.state).toBe("manual");
  });

  test("Chrome on iOS gets nothing — it cannot add to the home screen", () => {
    stubBrowser({ userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) CriOS/124 Safari" });

    const { result } = renderHook(() => useInstallPrompt());

    // Showing Safari's share-sheet steps here would just be wrong.
    expect(result.current.state).toBe("unavailable");
  });

  test("says nothing when the app is already installed", () => {
    stubBrowser({ userAgent: "Mozilla/5.0 (iPhone) Safari", standalone: true });

    const { result } = renderHook(() => useInstallPrompt());

    expect(result.current.state).toBe("unavailable");
  });

  test("hides itself once the install completes", () => {
    const { result } = renderHook(() => useInstallPrompt());
    firePrompt();
    expect(result.current.state).toBe("installable");

    act(() => {
      window.dispatchEvent(new Event("appinstalled"));
    });

    expect(result.current.state).toBe("unavailable");
  });
});
