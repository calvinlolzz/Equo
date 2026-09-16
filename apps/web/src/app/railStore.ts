export type RailState = "collapsed" | "expanded";

export const RAIL_KEY = "equo.rail";

/** The strip is the resting state; opening it is something you ask for. */
const DEFAULT_RAIL: RailState = "collapsed";

function isRailState(value: unknown): value is RailState {
  return value === "collapsed" || value === "expanded";
}

export function readStoredRail(): RailState {
  try {
    const stored = window.localStorage.getItem(RAIL_KEY);
    if (isRailState(stored)) return stored;
  } catch {
    // Private-mode / disabled storage — fall back to the default.
  }
  return DEFAULT_RAIL;
}

/**
 * Reflect the state onto <html>. Collapsed is the default, so it carries no
 * attribute — same convention as themeStore's data-theme and backgroundStore's
 * data-bg-motion, which keeps the common case free of markup nobody has to
 * reason about. The desktop CSS keys off `:not([data-rail="expanded"])`
 * rather than a bare base rule for the same reason.
 */
export function applyRail(state: RailState): void {
  const root = document.documentElement;
  if (state === "expanded") root.setAttribute("data-rail", "expanded");
  else root.removeAttribute("data-rail");
}

export function storeRail(state: RailState): void {
  try {
    window.localStorage.setItem(RAIL_KEY, state);
  } catch {
    // Ignore — the in-memory React state still drives the current session.
  }
}

/**
 * Read + apply before React mounts, so the rail never widens from 64px to
 * 260px one frame after first paint.
 */
export function initRail(): RailState {
  const state = readStoredRail();
  applyRail(state);
  return state;
}
