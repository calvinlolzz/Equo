import { MessageCircle, X } from "lucide-react";
import { Suspense, useEffect, useMemo, useState } from "react";
import { lazyChunk } from "./lazyChunk";
import { lineOaUrl, markLineHintDismissed, readLineHintDismissed } from "./lineLink";
import { UI_TEXT } from "./uiText";
import { useLineLink } from "./useLineLink";

// The same specifier App.tsx uses for the invite sheet, so Rollup reuses that
// one InviteQrCode chunk. Never import ./InviteQrCode or ./inviteQr statically
// here: the QR library would land in every ledger visit.
const InviteQrCode = lazyChunk(() => import("./InviteQrCode").then((m) => ({ default: m.InviteQrCode })));

const t = UI_TEXT.lineLink;

/**
 * "Record from LINE" suggestion on the personal ledger home.
 *
 * Shown only while the account is unlinked and the add-friend URL is
 * configured, and never again once dismissed - or once the account has been
 * seen linked, so it does not come back after an unlink (the profile row
 * stays for relinking). Dismissal is per device, like InstallHint's.
 *
 * `enabled` is the caller's "nothing else has the floor" gate (data loaded,
 * not view-as, no install hint); while false the hook does not fetch.
 */
export function LineLedgerHint({ enabled, showQr }: { enabled: boolean; showQr: boolean }) {
  const url = useMemo(() => lineOaUrl(), []);
  const [dismissed, setDismissed] = useState(readLineHintDismissed);
  const active = enabled && url !== "" && !dismissed;
  const { state } = useLineLink(active);

  useEffect(() => {
    if (state === "linked") markLineHintDismissed();
  }, [state]);

  if (!active || state !== "unlinked") return null;

  return (
    <aside className={showQr ? "line-hint line-hint--qr enter-content" : "line-hint enter-content"} aria-label={t.hintTitle}>
      <div className="line-hint-body">
        <strong>
          <span className="line-hint-mark" aria-hidden="true">
            <MessageCircle size={11} strokeWidth={2.5} />
          </span>
          {t.hintTitle}
        </strong>
        <small>{t.hintBody}</small>
        {showQr ? <small>{t.hintScan}</small> : null}
      </div>
      {showQr ? (
        <div className="line-hint-qr">
          <Suspense fallback={<div className="line-hint-qr-frame" aria-hidden="true" />}>
            <InviteQrCode value={url} label={t.hintQrAlt} frameClassName="line-hint-qr-frame" />
          </Suspense>
        </div>
      ) : null}
      <a className="line-hint-action" href={url} target="_blank" rel="noopener noreferrer">
        {t.addFriend}
      </a>
      <button
        className="line-hint-close"
        type="button"
        aria-label={t.hintDismiss}
        onClick={() => {
          setDismissed(true);
          markLineHintDismissed();
        }}
      >
        <X aria-hidden="true" size={16} />
      </button>
    </aside>
  );
}
