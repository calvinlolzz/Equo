import { Share, SquarePlus, X } from "lucide-react";
import type { InstallState } from "./useInstallPrompt";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.install;

/**
 * The "add Equo to your home screen" hint.
 *
 * Two shapes, because the platforms genuinely differ: Chromium gets a button
 * that opens the real install dialog, iOS Safari gets the tap-by-tap route
 * because there is no API to call. Both are dismissible and never come back.
 */
export function InstallHint({
  state,
  onInstall,
  onDismiss,
}: {
  state: InstallState;
  onInstall: () => void;
  onDismiss: () => void;
}) {
  if (state === "unavailable") return null;

  return (
    <aside className="install-hint" aria-label={text.title}>
      <div className="install-hint-body">
        <strong>{text.title}</strong>
        {state === "installable" ? (
          <small>{text.benefit}</small>
        ) : (
          <small className="install-hint-steps">
            {text.iosStepShare}
            <Share aria-hidden="true" size={13} />
            {text.iosStepAdd}
            <SquarePlus aria-hidden="true" size={13} />
          </small>
        )}
      </div>
      {state === "installable" ? (
        <button className="install-hint-action" type="button" onClick={onInstall}>
          {text.action}
        </button>
      ) : null}
      <button className="install-hint-close" type="button" aria-label={text.dismiss} onClick={onDismiss}>
        <X aria-hidden="true" size={16} />
      </button>
    </aside>
  );
}
