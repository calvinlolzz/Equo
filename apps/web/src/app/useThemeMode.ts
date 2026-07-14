import { useState } from "react";
import { applyTheme, readStoredTheme, storeTheme, type ThemeMode } from "./themeStore";

/**
 * Day/night toggle. main.tsx already applied the persisted value to <html>
 * before first paint (so there is no flash of the wrong theme), which is why
 * this only reads the stored value rather than applying it on mount - the
 * state exists to drive the toggle's icon and to write changes back.
 */
export function useThemeMode() {
  const [theme, setTheme] = useState<ThemeMode>(() => readStoredTheme());

  function toggleTheme() {
    const next: ThemeMode = theme === "light" ? "dark" : "light";
    applyTheme(next);
    storeTheme(next);
    setTheme(next);
  }

  return { theme, toggleTheme };
}
