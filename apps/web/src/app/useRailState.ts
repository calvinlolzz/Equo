import { useState } from "react";
import { applyRail, readStoredRail, storeRail, type RailState } from "./railStore";

/**
 * Desktop group-rail collapse/expand toggle. main.tsx already applied the
 * persisted value to <html> before first paint (so there is no 64→260px
 * flash), which is why this only reads the stored value rather than applying
 * it on mount — the state exists to drive the arrow's direction and
 * aria-expanded, and to write changes back.
 */
export function useRailState() {
  const [rail, setRail] = useState<RailState>(() => readStoredRail());

  function toggleRail() {
    const next: RailState = rail === "expanded" ? "collapsed" : "expanded";
    applyRail(next);
    storeRail(next);
    setRail(next);
  }

  return { railExpanded: rail === "expanded", toggleRail };
}
