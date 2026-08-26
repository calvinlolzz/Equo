import { Info, TriangleAlert, Wrench, X } from "lucide-react";
import type { SiteNoticeState } from "./useSiteNotice";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.notice;

/**
 * The operator's announcement and maintenance notice, above everything else.
 *
 * Both can be on at once and both are shown: they say different things, and a
 * maintenance window usually has an announcement explaining what is being done.
 * Maintenance goes first because it is the one that explains why the app is not
 * behaving.
 *
 * The message is whatever the operator typed - it is not translated, because
 * there is one operator writing one sentence and machine-translating it would
 * produce a worse sentence than the one they wrote. Only the chrome around it
 * (the label, the dismiss button) follows the reader's language.
 */
export function SiteNoticeBar({ notice }: { notice: SiteNoticeState }) {
  if (!notice.maintenance && !notice.banner) return null;

  return (
    <div className="site-notice-stack">
      {notice.maintenance ? (
        <div className="site-notice site-notice--maintenance" role="status">
          <Wrench aria-hidden="true" size={16} />
          <p>
            <strong>{text.maintenanceLabel}</strong>
            {notice.maintenance.message}
          </p>
        </div>
      ) : null}

      {notice.banner ? (
        <div
          className={
            notice.banner.level === "warning"
              ? "site-notice site-notice--warning"
              : "site-notice site-notice--info"
          }
          // An announcement is not urgent enough to interrupt a screen reader
          // mid-sentence, so status rather than alert - even at warning level,
          // which is about how it looks, not about how it is announced.
          role="status"
        >
          {notice.banner.level === "warning" ? (
            <TriangleAlert aria-hidden="true" size={16} />
          ) : (
            <Info aria-hidden="true" size={16} />
          )}
          <p>{notice.banner.message}</p>
          <button type="button" aria-label={text.dismiss} onClick={notice.dismissBanner}>
            <X aria-hidden="true" size={14} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
