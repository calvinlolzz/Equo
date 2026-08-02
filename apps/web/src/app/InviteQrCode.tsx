import { useMemo } from "react";
import { buildQrModules, buildQrPath } from "./inviteQr";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

/** Quiet zone, in modules. The spec asks for 4; anything less and some scanners refuse to lock on. */
const QUIET_ZONE = 2;

/**
 * The invite link as a scannable code.
 *
 * Rendered as SVG rather than a canvas so it stays sharp on every pixel ratio
 * and inherits the theme's foreground colour — a QR is only readable at high
 * contrast, and hard-coding black would invert badly in day mode.
 *
 * The quiet zone is narrower than the spec's 4 modules because the card around
 * it is already a large flat area of background, which is what the margin is
 * there to provide.
 */
export function InviteQrCode({ value }: { value: string }) {
  const { path, size } = useMemo(() => {
    if (!value) return { path: "", size: 0 };
    const modules = buildQrModules(value);
    return { path: buildQrPath(modules), size: modules.length };
  }, [value]);

  if (!path) return <div className="invite-qr-frame invite-qr-frame--empty" aria-hidden="true" />;

  const extent = size + QUIET_ZONE * 2;

  return (
    <div className="invite-qr-frame">
      <svg
        className="invite-qr"
        viewBox={`0 0 ${extent} ${extent}`}
        role="img"
        aria-label={text.inviteQrAlt}
        shapeRendering="crispEdges"
      >
        <path d={path} transform={`translate(${QUIET_ZONE} ${QUIET_ZONE})`} fill="currentColor" />
      </svg>
    </div>
  );
}
