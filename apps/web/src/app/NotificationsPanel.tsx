import { useEffect, useMemo } from "react";
import { Megaphone, MessageSquareText, Trash2, X } from "lucide-react";
import type { NotificationRow } from "./apiClient";
import { formatActivityTime } from "./appDates";
import { useSwipeToDismiss } from "./useSwipeToDismiss";
import { mergeRefs, useDialogChrome } from "./useDialogChrome";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

type NotificationsPanelProps = {
  items: NotificationRow[];
  loading: boolean;
  onClose: () => void;
  /** Called once on open: everything visible is read by the act of reading it. */
  onOpened: () => void;
  /** Follow a notification's in-app link. */
  onNavigate: (link: string) => void;
  /** Delete one row. */
  onDelete: (id: string) => void;
  /** Delete the whole inbox. */
  onClearAll: () => void;
};

/**
 * The inbox.
 *
 * Everything is marked read on open rather than per row. The alternative -
 * tapping each one - makes the badge a chore rather than a signal, and there is
 * nothing here that a person can act on twice; the reply and the announcement
 * have both done their job once they have been seen.
 */
export function NotificationsPanel({
  items,
  loading,
  onClose,
  onOpened,
  onNavigate,
  onDelete,
  onClearAll,
}: NotificationsPanelProps) {
  const swipe = useSwipeToDismiss(onClose);
  const chromeRef = useDialogChrome(swipe.requestClose);
  const dialogRef = useMemo(
    () => mergeRefs<HTMLElement>(swipe.dragProps.ref, chromeRef),
    [swipe.dragProps.ref, chromeRef],
  );

  useEffect(() => {
    onOpened();
    // Deliberately once per mount: re-running whenever the callback identity
    // changed would re-send the write on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={swipe.closing ? "modal-backdrop closing" : "modal-backdrop"}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) swipe.requestClose();
      }}
    >
      <section
        className={swipe.closing ? "flow-dialog glass-panel closing" : "flow-dialog glass-panel"}
        role="dialog"
        aria-modal="true"
        aria-label={text.notificationsTitle}
        {...swipe.dragProps}
        ref={dialogRef}
      >
        <div className="dialog-drag-handle" aria-hidden="true" />
        <button className="dialog-close" type="button" aria-label={text.cancel} onClick={swipe.requestClose}>
          <X aria-hidden="true" size={18} />
        </button>

        <div className="dialog-header">
          <h3>{text.notificationsTitle}</h3>
          <p>{text.notificationsDescription}</p>
        </div>

        {items.length > 0 && (
          <div className="notification-toolbar">
            <button
              className="notification-clear"
              type="button"
              onClick={() => {
                // Everything at once and unrecoverable, so it asks. Deleting
                // one row does not - that one is easy to re-read from the
                // console if it mattered.
                if (window.confirm(text.notificationsClearConfirm)) onClearAll();
              }}
            >
              {text.notificationsClearAll}
            </button>
          </div>
        )}

        {loading && items.length === 0 ? (
          <p className="notification-empty">{text.processing}</p>
        ) : items.length === 0 ? (
          <p className="notification-empty">{text.notificationsEmpty}</p>
        ) : (
          <ul className="notification-list">
            {items.map((item) => {
              const reply = item.kind === "feedback_reply";
              const Icon = reply ? MessageSquareText : Megaphone;
              return (
                <li key={item.id} className={item.read_at ? "notification-row" : "notification-row unread"}>
                  <span className="notification-icon" aria-hidden="true">
                    <Icon size={16} />
                  </span>
                  <div className="notification-body">
                    <p className="notification-title">
                      {item.title}
                      <span className="notification-kind">
                        {reply ? text.notificationsReply : text.notificationsAnnouncement}
                      </span>
                    </p>
                    <p className="notification-text">{item.body}</p>
                    <p className="notification-time">{formatActivityTime(item.created_at)}</p>
                    {item.link ? (
                      <button className="notification-link" type="button" onClick={() => onNavigate(item.link as string)}>
                        {text.notificationsOpenLink}
                      </button>
                    ) : null}
                  </div>
                  <button
                    className="notification-delete"
                    type="button"
                    aria-label={`${text.notificationsDelete}：${item.title}`}
                    onClick={() => onDelete(item.id)}
                  >
                    <Trash2 aria-hidden="true" size={15} />
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
