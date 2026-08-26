import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { useSwipeToDismiss } from "./useSwipeToDismiss";
import { mergeRefs, useDialogChrome } from "./useDialogChrome";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

export const FEEDBACK_TYPE_OPTIONS = [
  { value: "problem", label: UI_TEXT.feedbackTypes.bug },
  { value: "suggestion", label: UI_TEXT.feedbackTypes.idea },
  { value: "confusing", label: UI_TEXT.feedbackTypes.confusing },
  { value: "other", label: UI_TEXT.feedbackTypes.other },
] as const;

export type FeedbackType = (typeof FEEDBACK_TYPE_OPTIONS)[number]["value"];

type FeedbackDialogProps = {
  onClose: () => void;
  onSubmit: (payload: { type: FeedbackType; message: string }) => Promise<void>;
};

/** 意見回饋 bottom sheet - type chips + free-form message, submitted to /api/v1/feedback. */
export function FeedbackDialog({ onClose, onSubmit }: FeedbackDialogProps) {
  const swipe = useSwipeToDismiss(onClose);
  const chromeRef = useDialogChrome(swipe.requestClose);
  const dialogRef = useMemo(
    () => mergeRefs<HTMLElement>(swipe.dragProps.ref, chromeRef),
    [swipe.dragProps.ref, chromeRef],
  );
  const [type, setType] = useState<FeedbackType>("problem");
  const [message, setMessage] = useState("");
  const [sending, setSending] = useState(false);

  async function handleSubmit() {
    if (!message.trim() || sending) return;
    setSending(true);
    try {
      await onSubmit({ type, message: message.trim() });
    } finally {
      setSending(false);
    }
  }

  return (
    <div
      className={swipe.closing ? "modal-backdrop closing" : "modal-backdrop"}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        className={swipe.closing ? "flow-dialog glass-panel closing" : "flow-dialog glass-panel"}
        role="dialog"
        aria-modal="true"
        aria-label={text.feedbackTitle}
        {...swipe.dragProps}
        ref={dialogRef}
      >
        <div className="dialog-drag-handle" aria-hidden="true" />
        <button className="dialog-close" type="button" aria-label={text.cancel} onClick={onClose}>
          <X aria-hidden="true" size={18} />
        </button>

        <div className="dialog-header">
          <h3>{text.feedbackTitle}</h3>
          <p>{text.feedbackDescription}</p>
        </div>

        <div className="feedback-type-row" role="group" aria-label={text.feedbackTypeLabel}>
          {FEEDBACK_TYPE_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              aria-pressed={type === option.value}
              className={type === option.value ? "feedback-type-chip active" : "feedback-type-chip"}
              onClick={() => setType(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <textarea
          className="feedback-textarea"
          value={message}
          maxLength={2000}
          rows={5}
          placeholder={text.feedbackPlaceholder}
          onChange={(event) => setMessage(event.target.value)}
        />

        <div className="dialog-action-row">
          <button className="secondary-action" type="button" onClick={onClose} disabled={sending}>
            {text.cancel}
          </button>
          <button className="primary-action" type="button" onClick={handleSubmit} disabled={sending || !message.trim()}>
            {sending ? text.processing : text.feedbackSubmit}
          </button>
        </div>
      </section>
    </div>
  );
}
