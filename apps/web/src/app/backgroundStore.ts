export type BackgroundMotion = "on" | "off";

export const BACKGROUND_MOTION_KEY = "equo.backgroundMotion";

/** The animated field is the shipped look, so it stays the default. */
const DEFAULT_MOTION: BackgroundMotion = "on";

/**
 * Marks a machine where the field cannot be drawn at all — no WebGL, or a
 * context that turned out to be software-rendered (see isSoftwareRenderer).
 * Set by GlassBackground when it refuses to build, read by the profile screen
 * so the switch can say so instead of looking broken.
 */
export const BACKGROUND_UNAVAILABLE_ATTR = "data-bg-unavailable";

function isBackgroundMotion(value: unknown): value is BackgroundMotion {
  return value === "on" || value === "off";
}

/**
 * The animated backdrop, as a per-device setting.
 *
 * Deliberately NOT part of the account: it answers "can this machine afford to
 * draw a fullscreen shader", which is a fact about the machine in front of you,
 * not about you. The same person's phone and their five-year-old laptop want
 * different answers, and syncing the two would be actively wrong.
 *
 * Shaped exactly like themeStore: an attribute on <html> is the seam, because
 * GlassBackground is a sibling of <App />, not a child, and already watches the
 * root element for data-theme and data-overlay.
 */
export function readStoredBackgroundMotion(): BackgroundMotion {
  try {
    const stored = window.localStorage.getItem(BACKGROUND_MOTION_KEY);
    if (isBackgroundMotion(stored)) return stored;
  } catch {
    // Private mode / blocked storage. The default is the shipped look, and a
    // setting that cannot be persisted is a much smaller problem than a blank
    // background.
  }
  return DEFAULT_MOTION;
}

/**
 * Reflect the choice onto <html>. "on" is the default, so it carries no
 * attribute — same convention as the theme, and it keeps the common case free
 * of markup nobody has to reason about.
 */
export function applyBackgroundMotion(motion: BackgroundMotion): void {
  const root = document.documentElement;
  if (motion === "off") root.setAttribute("data-bg-motion", "off");
  else root.removeAttribute("data-bg-motion");
}

export function storeBackgroundMotion(motion: BackgroundMotion): void {
  try {
    window.localStorage.setItem(BACKGROUND_MOTION_KEY, motion);
  } catch {
    // Ignore — the in-memory state still drives this session.
  }
}

/**
 * Read + apply before React mounts, so a machine that has the field switched
 * off never pays for one frame of it.
 */
export function initBackgroundMotion(): BackgroundMotion {
  const motion = readStoredBackgroundMotion();
  applyBackgroundMotion(motion);
  return motion;
}

/** Whether this machine reported that it cannot draw the field. */
export function isBackgroundUnavailable(): boolean {
  return document.documentElement.hasAttribute(BACKGROUND_UNAVAILABLE_ATTR);
}
