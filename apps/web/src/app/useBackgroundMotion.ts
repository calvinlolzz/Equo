import { useState } from "react";
import {
  applyBackgroundMotion,
  isBackgroundUnavailable,
  readStoredBackgroundMotion,
  storeBackgroundMotion,
  type BackgroundMotion,
} from "./backgroundStore";

/**
 * The animated-backdrop switch. main.tsx has already applied the stored value
 * to <html> before first paint, so this only reads it — the state exists to
 * drive the row in the profile sheet and to write changes back.
 *
 * `unavailable` is read once on mount rather than watched: GlassBackground
 * decides it during its first build, which happens before anyone can open the
 * profile sheet, and it cannot change without a reload.
 */
export function useBackgroundMotion() {
  const [motion, setMotion] = useState<BackgroundMotion>(() => readStoredBackgroundMotion());
  const [unavailable] = useState<boolean>(() => isBackgroundUnavailable());

  function toggleBackgroundMotion() {
    const next: BackgroundMotion = motion === "off" ? "on" : "off";
    applyBackgroundMotion(next);
    storeBackgroundMotion(next);
    setMotion(next);
  }

  return { backgroundMotion: motion, backgroundUnavailable: unavailable, toggleBackgroundMotion };
}
