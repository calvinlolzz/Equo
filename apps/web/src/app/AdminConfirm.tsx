import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

export type ConfirmRequest = {
  title: string;
  /** The consequence, in a sentence. Shown under the title. */
  body?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** Red confirm button, for anything that removes or disables. */
  danger?: boolean;
  /**
   * When set, the operator has to type this exact string before the confirm
   * button does anything — the guard 刪除帳號 has always had, generalised.
   * Compared trimmed and case-insensitively, because an email pasted out of a
   * table brings whitespace with it.
   */
  typeToConfirm?: string;
  /** What to say above the box, e.g. 「請輸入這個帳號的 email」. */
  typeToConfirmHint?: string;
};

type Ask = (request: ConfirmRequest) => Promise<boolean>;

const AdminConfirmContext = createContext<Ask | null>(null);

/**
 * The console's confirm.
 *
 * Every destructive action here used to go through window.confirm/prompt. Two
 * reasons that was worth replacing, and the second is not cosmetic:
 *
 * - A browser dialog cannot be styled, cannot show the row it is about, and
 *   cannot refuse a wrong answer — the merge guard had to accept the typed
 *   email, close, and then report 「email 不符」 as an error afterwards.
 * - Chrome offers "prevent this page from creating additional dialogs" after a
 *   few of them. Tick it and every later confirm() returns false: the operator
 *   presses 刪除, nothing happens, and nothing says why.
 */
export function useAdminConfirm(): Ask {
  const ask = useContext(AdminConfirmContext);
  if (!ask) throw new Error("useAdminConfirm used outside AdminConfirmProvider");
  return ask;
}

type Pending = { request: ConfirmRequest; resolve: (ok: boolean) => void };

export function AdminConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null);
  const [typed, setTyped] = useState("");
  const confirmRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const ask = useCallback<Ask>((request) => {
    setTyped("");
    return new Promise<boolean>((resolve) => setPending({ request, resolve }));
  }, []);

  const settle = useCallback(
    (ok: boolean) => {
      setPending((current) => {
        current?.resolve(ok);
        return null;
      });
    },
    [],
  );

  useEffect(() => {
    if (!pending) return;

    // Focus what the operator has to act on: the box when there is one to
    // type in, the button when the answer is just yes or no.
    (pending.request.typeToConfirm ? inputRef.current : confirmRef.current)?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") settle(false);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [pending, settle]);

  const value = useMemo(() => ask, [ask]);

  return (
    <AdminConfirmContext.Provider value={value}>
      {children}
      {pending ? <ConfirmDialog pending={pending} typed={typed} onTyped={setTyped} onSettle={settle} confirmRef={confirmRef} inputRef={inputRef} /> : null}
    </AdminConfirmContext.Provider>
  );
}

/** Whether what has been typed unlocks the confirm button. */
export function typedMatches(expected: string | undefined, typed: string): boolean {
  if (!expected) return true;
  return typed.trim().toLowerCase() === expected.trim().toLowerCase();
}

function ConfirmDialog({
  pending,
  typed,
  onTyped,
  onSettle,
  confirmRef,
  inputRef,
}: {
  pending: Pending;
  typed: string;
  onTyped: (value: string) => void;
  onSettle: (ok: boolean) => void;
  confirmRef: React.RefObject<HTMLButtonElement | null>;
  inputRef: React.RefObject<HTMLInputElement | null>;
}) {
  const { request } = pending;
  const unlocked = typedMatches(request.typeToConfirm, typed);

  return (
    <div className="admin-modal" role="presentation" onClick={() => onSettle(false)}>
      <article
        className="admin-modal__panel admin-confirm"
        role="alertdialog"
        aria-modal="true"
        aria-label={request.title}
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="admin-modal__title">{request.title}</h3>
        {request.body ? <p className="admin-modal__note">{request.body}</p> : null}

        {request.typeToConfirm ? (
          <label className="admin-confirm__type">
            <span>{request.typeToConfirmHint ?? `請輸入「${request.typeToConfirm}」以確認`}</span>
            <input
              ref={inputRef}
              className="admin-input"
              value={typed}
              onChange={(event) => onTyped(event.target.value)}
              // Enter is the whole gesture once the box is right.
              onKeyDown={(event) => {
                if (event.key === "Enter" && unlocked) onSettle(true);
              }}
              autoComplete="off"
              spellCheck={false}
              aria-label={request.typeToConfirmHint ?? request.title}
            />
          </label>
        ) : null}

        <div className="admin-confirm__actions">
          <button type="button" className="admin-action" onClick={() => onSettle(false)}>
            {request.cancelLabel ?? "取消"}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={request.danger ? "admin-action admin-action--danger" : "admin-action admin-action--primary"}
            // A wrong answer is refused here rather than accepted and reported
            // afterwards, which is what the browser prompt forced.
            disabled={!unlocked}
            onClick={() => onSettle(true)}
          >
            {request.confirmLabel ?? "確定"}
          </button>
        </div>
      </article>
    </div>
  );
}
