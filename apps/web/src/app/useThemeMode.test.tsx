// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, test } from "vitest";
import { THEME_KEY } from "./themeStore";
import { useThemeMode } from "./useThemeMode";

beforeEach(() => {
  window.localStorage.clear();
  document.documentElement.removeAttribute("data-theme");
});

describe("useThemeMode", () => {
  test("defaults to dark - the shipped UI", () => {
    const { result } = renderHook(() => useThemeMode());

    expect(result.current.theme).toBe("dark");
  });

  test("reads the persisted choice rather than re-applying it", () => {
    // main.tsx already put the stored theme on <html> before first paint, which
    // is why there is no flash of the wrong theme. The hook only reads.
    window.localStorage.setItem(THEME_KEY, "light");

    const { result } = renderHook(() => useThemeMode());

    expect(result.current.theme).toBe("light");
    // It did NOT touch the document on mount.
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
  });

  test("toggling to light sets data-theme, and persists it", () => {
    const { result } = renderHook(() => useThemeMode());

    act(() => result.current.toggleTheme());

    expect(result.current.theme).toBe("light");
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
    expect(window.localStorage.getItem(THEME_KEY)).toBe("light");
  });

  test("toggling back to dark REMOVES the attribute rather than setting it", () => {
    const { result } = renderHook(() => useThemeMode());

    act(() => result.current.toggleTheme());
    act(() => result.current.toggleTheme());

    expect(result.current.theme).toBe("dark");
    // Dark is the attribute-free default - the CSS tokens key off its absence,
    // so writing data-theme="dark" would not restore the shipped dark UI.
    expect(document.documentElement.hasAttribute("data-theme")).toBe(false);
    expect(window.localStorage.getItem(THEME_KEY)).toBe("dark");
  });
});
