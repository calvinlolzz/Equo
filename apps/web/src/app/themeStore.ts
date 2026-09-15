export type ThemeMode = "dark" | "light";

export const THEME_KEY = "equo.theme";

/** The app ships dark-first; light (日間模式) is opt-in and persisted. */
const DEFAULT_THEME: ThemeMode = "dark";

function isThemeMode(value: unknown): value is ThemeMode {
  return value === "dark" || value === "light";
}

export function readStoredTheme(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(THEME_KEY);
    if (isThemeMode(stored)) return stored;
  } catch {
    // Private-mode / disabled storage — fall back to the default.
  }
  return DEFAULT_THEME;
}

/**
 * The browser/OS chrome colour (Safari toolbar, Android status bar, PWA title
 * bar) tracks the ACTIVE in-app theme, not the OS scheme — the day/night mode
 * is a user toggle persisted in localStorage, independent of
 * prefers-color-scheme. These are the two --page-1 token values (see
 * app-base.css) so the chrome always matches the page background.
 */
const THEME_COLORS: Record<ThemeMode, string> = { dark: "#07080D", light: "#F4F5F9" };

function syncThemeColorMeta(theme: ThemeMode): void {
  if (typeof document === "undefined") return;
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", THEME_COLORS[theme]);
}

/**
 * Reflect the theme onto <html>. Dark is the default styling, so it carries no
 * attribute; light sets data-theme="light", which the CSS token overrides key
 * off. Keeping dark attribute-free means the shipped dark UI is untouched.
 */
export function applyTheme(theme: ThemeMode): void {
  const root = document.documentElement;
  syncThemeColorMeta(theme);
  // Chromium does not repaint a property that resolves through a custom
  // property when only that custom property changes while the property has an
  // active `transition` — the old resolved colour is held. On a live toggle
  // that would freeze half the themed UI at its previous colour. Suppressing
  // transitions for one frame and forcing a reflow makes every token-derived
  // colour recompute at once; transitions resume next frame for normal use.
  root.classList.add("theme-switching");
  if (theme === "light") root.setAttribute("data-theme", "light");
  else root.removeAttribute("data-theme");
  void root.offsetWidth;
  if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(() => root.classList.remove("theme-switching"));
  } else {
    root.classList.remove("theme-switching");
  }
}

export function storeTheme(theme: ThemeMode): void {
  try {
    window.localStorage.setItem(THEME_KEY, theme);
  } catch {
    // Ignore — the in-memory React state still drives the current session.
  }
}

/**
 * Read + apply the persisted theme before React mounts so there is no
 * dark→light flash on load. Returns the resolved theme for the initial
 * React state. Call this only for the user-facing app; the admin console
 * stays dark regardless of the stored preference.
 */
export function initTheme(): ThemeMode {
  const theme = readStoredTheme();
  applyTheme(theme);
  return theme;
}
