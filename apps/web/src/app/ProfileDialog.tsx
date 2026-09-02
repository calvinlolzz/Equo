import { useMemo, useRef, useState } from "react";
import { AlertTriangle, Bell, FileText, Globe, Lock, LogOut, MessageSquareText, Moon, Pencil, ScanLine, Sparkles, Sun, Trash2, X } from "lucide-react";
import { downscaleImageFileToDataUrl } from "./expenseImage";
import { upscaleGoogleAvatar } from "./MemberAvatar";
import { useSwipeToDismiss } from "./useSwipeToDismiss";
import { mergeRefs, useDialogChrome } from "./useDialogChrome";
import type { InfoDialogMode } from "./appTypes";
import type { ThemeMode } from "./themeStore";
import type { BackgroundMotion } from "./backgroundStore";
import { LegalDocumentBody } from "./LegalDocumentBody";
import { PRIVACY_POLICY, TERMS_OF_SERVICE } from "./legalContent";
import type { ProfileData } from "./profileStore";
import { describePushState } from "./pushNotifications";
import { usePushNotifications } from "./usePushNotifications";
import type { StoredSession } from "./sessionStore";
import { ACTIVE_LOCALE, UI_TEXT } from "./uiText";
import { LOCALE_NAMES, LOCALES, setLocale, type Locale } from "./i18n/locale";

const text = UI_TEXT.profile;
const appText = UI_TEXT.app;

type ProfileTab = "account" | "other";

const TABS: Array<{ id: ProfileTab; label: string }> = [
  { id: "account", label: text.accountTab },
  { id: "other", label: text.otherTab },
];

function initial(name: string | undefined) {
  return (name || "?").slice(0, 1).toUpperCase();
}

function GoogleLogo() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
      <path
        fill="#FFC107"
        d="M43.611 20.083H42V20H24v8h11.303c-1.649 4.657-6.08 8-11.303 8-6.627 0-12-5.373-12-12s5.373-12 12-12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 12.955 4 4 12.955 4 24s8.955 20 20 20 20-8.955 20-20c0-1.341-.138-2.65-.389-3.917z"
      />
      <path
        fill="#FF3D00"
        d="M6.306 14.691l6.571 4.819C14.655 15.108 18.961 12 24 12c3.059 0 5.842 1.154 7.961 3.039l5.657-5.657C34.046 6.053 29.268 4 24 4 16.318 4 9.656 8.337 6.306 14.691z"
      />
      <path
        fill="#4CAF50"
        d="M24 44c5.166 0 9.86-1.977 13.409-5.192l-6.19-5.238A11.91 11.91 0 0124 36c-5.202 0-9.619-3.317-11.283-7.946l-6.522 5.025C9.505 39.556 16.227 44 24 44z"
      />
      <path
        fill="#1976D2"
        d="M43.611 20.083H42V20H24v8h11.303a12.04 12.04 0 01-4.087 5.571l.003-.002 6.19 5.238C36.971 39.205 44 34 44 24c0-1.341-.138-2.65-.389-3.917z"
      />
    </svg>
  );
}

export function ProfileDialog({
  profile,
  displayAvatarUrl,
  session,
  infoDialog,
  onOpenInfoDialog,
  theme,
  onToggleTheme,
  backgroundMotion,
  backgroundUnavailable,
  onToggleBackgroundMotion,
  onClose,
  onSave,
  onToast,
  onLogout,
  onDeleteAccount,
  onFeedback,
  scanConsentGranted = false,
  onDisableScanConsent,
}: {
  profile: ProfileData;
  /**
   * The freshest avatar to seed the picker from (session.user.avatarUrl when
   * present, else the local profileStore cache - see App.tsx's
   * displayAvatarUrl). Falls back to profile.avatarDataUrl when omitted so
   * this component still works standalone (e.g. in tests).
   */
  displayAvatarUrl?: string;
  session: StoredSession | null;
  /**
   * The privacy/terms sheet stacked on this dialog. Owned by App.tsx so the
   * Back button can close it on its own — see useOverlayHistory.
   */
  infoDialog: InfoDialogMode;
  onOpenInfoDialog: (info: InfoDialogMode) => void;
  /**
   * Day/night, shared with the top bar's icon. Two entry points onto one piece
   * of state on purpose: the icon is a shortcut, and a settings list is where
   * people go looking for a setting even when a shortcut exists.
   */
  theme: ThemeMode;
  onToggleTheme: () => void;
  backgroundMotion: BackgroundMotion;
  /** This machine cannot draw the field at all — no WebGL, or software rendering. */
  backgroundUnavailable: boolean;
  onToggleBackgroundMotion: () => void;
  onClose: () => void;
  onSave: (profile: ProfileData) => void | Promise<void>;
  onToast: (message: string) => void;
  onLogout: () => void;
  /**
   * Erase the account (DELETE /me). Resolves once the request is done; App
   * tears the session down on success and toasts on failure. This dialog only
   * owns the two-step confirm and the in-flight spinner.
   */
  onDeleteAccount: () => Promise<void>;
  onFeedback: () => void;
  /**
   * Whether this device has agreed to receipt recognition (scanConsent.ts).
   * Undefined in the standalone/test case, which simply hides the row.
   */
  scanConsentGranted?: boolean;
  /** Withdraw that consent. The next scan asks again. */
  onDisableScanConsent?: () => void;
}) {
  const [tab, setTab] = useState<ProfileTab>("account");
  // Only resolved once the 其他設定 tab is actually on screen: working out
  // whether this browser is subscribed costs a service-worker wait and a
  // request, and most opens of this dialog are for the name and avatar.
  const push = usePushNotifications(tab === "other");
  const [name, setName] = useState(profile.name);
  const initialAvatarDataUrl = displayAvatarUrl ?? profile.avatarDataUrl ?? "";
  const [avatarDataUrl, setAvatarDataUrl] = useState(initialAvatarDataUrl);
  const [editingName, setEditingName] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [deletingAccount, setDeletingAccount] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isLoggedIn = Boolean(session);
  const swipe = useSwipeToDismiss(onClose);
  const chromeRef = useDialogChrome(swipe.requestClose);
  const dialogRef = useMemo(
    () => mergeRefs<HTMLElement>(swipe.dragProps.ref, chromeRef),
    [swipe.dragProps.ref, chromeRef],
  );

  async function handleAvatarPick(file: File | null) {
    if (!file) return;
    try {
      const dataUrl = await downscaleImageFileToDataUrl(file);
      setAvatarDataUrl(dataUrl);
    } catch {
      onToast(appText.photoError);
    }
  }

  async function handleConfirm() {
    setSaving(true);
    try {
      await onSave({ name: name.trim() || profile.name, avatarDataUrl: avatarDataUrl || undefined });
    } finally {
      setSaving(false);
    }
  }

  const hasPendingChange = name.trim() !== profile.name || avatarDataUrl !== initialAvatarDataUrl;

  return (
    <div
      className={swipe.closing ? "modal-backdrop closing" : "modal-backdrop"}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) swipe.requestClose();
      }}
    >
      <section
        className={swipe.closing ? "flow-dialog profile-dialog glass-panel closing" : "flow-dialog profile-dialog glass-panel"}
        role="dialog"
        aria-modal="true"
        aria-label={text.title}
        {...swipe.dragProps}
        ref={dialogRef}
      >
        <div className="dialog-drag-handle" aria-hidden="true" />
        <button className="dialog-close" type="button" aria-label={appText.cancel} onClick={swipe.requestClose}>
          <X aria-hidden="true" size={18} />
        </button>

        <div className="dialog-header">
          <h3>{text.title}</h3>
        </div>

        <div className="profile-identity-row">
          <button
            className="profile-avatar-picker"
            type="button"
            aria-label={text.changeAvatar}
            onClick={() => fileInputRef.current?.click()}
          >
            {avatarDataUrl ? <img src={upscaleGoogleAvatar(avatarDataUrl)} alt="" /> : <span>{initial(name)}</span>}
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="visually-hidden"
            onChange={(event) => handleAvatarPick(event.target.files?.[0] ?? null)}
          />

          <div className="profile-name-field">
            {editingName ? (
              <input
                className="profile-name-input"
                value={name}
                autoFocus
                onChange={(event) => setName(event.target.value)}
                onBlur={() => setEditingName(false)}
                aria-label={text.editName}
              />
            ) : (
              <button className="profile-name-display" type="button" onClick={() => setEditingName(true)}>
                <strong>{name}</strong>
                <Pencil aria-hidden="true" size={14} />
              </button>
            )}
            {session ? (
              <small className="profile-identity-email">
                {session.user.displayName} · {session.user.email}
              </small>
            ) : null}
          </div>

          {isLoggedIn ? (
            <button className="profile-logout-action" type="button" onClick={onLogout}>
              <LogOut aria-hidden="true" size={16} />
              {text.logout}
            </button>
          ) : null}
        </div>

        <div className="profile-tab-bar" role="tablist" aria-label={text.title}>
          {TABS.map((item) => (
            <button
              key={item.id}
              className={item.id === tab ? "profile-tab active" : "profile-tab"}
              type="button"
              role="tab"
              aria-selected={item.id === tab}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === "account" ? (
          <div className="profile-account-list">
            <div className="profile-account-row">
              <span className="profile-account-icon">
                <GoogleLogo />
              </span>
              <span className="profile-account-info">
                <strong>{text.googleAccount}</strong>
                <small className="profile-status-linked">{text.linked}</small>
              </span>
              <button className="profile-link-action" type="button" onClick={onLogout}>
                {text.unlinkAccount}
              </button>
            </div>
          </div>
        ) : (
          <div className="profile-other-list">
            <div className="profile-other-row profile-push-row">
              <Bell aria-hidden="true" size={19} />
              <span className="profile-push-text">
                <span>{text.pushNotifications}</span>
                <small>{describePushState(push.state)}</small>
              </span>
              {push.state === "on" || push.state === "off" ? (
                <button
                  className="profile-link-action"
                  type="button"
                  disabled={push.busy}
                  onClick={() => (push.state === "on" ? push.disable() : push.enable())}
                >
                  {push.busy ? text.pushWorking : push.state === "on" ? text.pushDisable : text.pushEnable}
                </button>
              ) : null}
            </div>
            {/* Only shown once consent has been given: a row offering to turn
                off something that was never on is noise, and the ask itself
                lives at the camera where the decision is actually made. */}
            {scanConsentGranted ? (
              <div className="profile-other-row profile-push-row">
                <ScanLine aria-hidden="true" size={19} />
                <span className="profile-push-text">
                  <span>{appText.receiptScanSetting}</span>
                  <small>{appText.receiptScanOn}</small>
                </span>
                <button className="profile-link-action" type="button" onClick={onDisableScanConsent}>
                  {text.pushDisable}
                </button>
              </div>
            ) : null}
            <button className="profile-other-row" type="button" onClick={onToggleTheme}>
              {theme === "light" ? <Sun aria-hidden="true" size={19} /> : <Moon aria-hidden="true" size={19} />}
              <span>{text.themeSetting}</span>
              <span className="profile-row-value">{theme === "light" ? text.themeLight : text.themeDark}</span>
            </button>
            {/* The animated backdrop, as a per-device switch. It is the most
                expensive thing the app draws — a fullscreen shader that every
                frosted panel then re-blurs — so the machine that cannot afford
                it needs a way to say so, and that answer belongs to the machine
                rather than to the account. When there is no GPU behind the
                context we have already fallen back to a static gradient; the
                row says that instead of offering a switch that does nothing. */}
            {backgroundUnavailable ? (
              <div className="profile-other-row profile-other-row-static">
                <Sparkles aria-hidden="true" size={19} />
                <span className="profile-push-text">
                  <span>{text.backgroundSetting}</span>
                  <small>{text.backgroundUnavailableHint}</small>
                </span>
                <span className="profile-row-value">{text.backgroundUnavailable}</span>
              </div>
            ) : (
              <button className="profile-other-row" type="button" onClick={onToggleBackgroundMotion}>
                <Sparkles aria-hidden="true" size={19} />
                <span className="profile-push-text">
                  <span>{text.backgroundSetting}</span>
                  <small>{text.backgroundHint}</small>
                </span>
                <span className="profile-row-value">
                  {backgroundMotion === "off" ? text.backgroundOff : text.backgroundOn}
                </span>
              </button>
            )}
            {/* A real control now that there is more than one language. The
                option names are each written in their own language and never
                translated: a picker that lists languages in a language you
                cannot read is useless to the one person who needs it. */}
            {/* The value is plain text, exactly like 外觀主題 and 動態背景 above
                it, and the <select> is stretched invisibly over the whole row.
                It used to BE the value: a styled select with direction:rtl to
                push its text right — and WebKit flips the native dropdown
                arrows along with the text, so on iOS the ⌄⌃ landed in the
                middle of the row, squeezing 語言設定 onto two lines. Now the
                row is laid out by the same rules as its neighbours and the tap
                still opens the native picker, from anywhere in the row. */}
            <div className="profile-other-row profile-language-row">
              <Globe aria-hidden="true" size={19} />
              <span>{text.languageSetting}</span>
              <span className="profile-row-value">{LOCALE_NAMES[ACTIVE_LOCALE]}</span>
              <select
                className="profile-language-select"
                aria-label={text.languageSetting}
                value={ACTIVE_LOCALE}
                onChange={(event) => setLocale(event.target.value as Locale, ACTIVE_LOCALE)}
              >
                {LOCALES.map((locale) => (
                  <option key={locale} value={locale}>
                    {LOCALE_NAMES[locale]}
                  </option>
                ))}
              </select>
            </div>
            <button className="profile-other-row" type="button" onClick={onFeedback}>
              <MessageSquareText aria-hidden="true" size={19} />
              <span>{text.feedbackEntry}</span>
            </button>
            <button className="profile-other-row" type="button" onClick={() => onOpenInfoDialog("privacy")}>
              <Lock aria-hidden="true" size={19} />
              <span>{text.privacyPolicy}</span>
            </button>
            <button className="profile-other-row" type="button" onClick={() => onOpenInfoDialog("terms")}>
              <FileText aria-hidden="true" size={19} />
              <span>{text.termsOfService}</span>
            </button>
            {isLoggedIn ? (
              <button
                className="profile-other-row profile-other-row-danger"
                type="button"
                onClick={() => setConfirmingDelete(true)}
              >
                <Trash2 aria-hidden="true" size={19} />
                <span>{text.deleteAccount}</span>
              </button>
            ) : null}
          </div>
        )}

        {hasPendingChange ? (
          <div className="dialog-action-row">
            <button className="secondary-action" type="button" onClick={swipe.requestClose} disabled={saving}>
              {appText.cancel}
            </button>
            <button className="primary-action" type="button" onClick={handleConfirm} disabled={saving}>
              {saving ? appText.savingChanges : appText.confirm}
            </button>
          </div>
        ) : null}
      </section>

      {confirmingDelete ? (
        <div
          className="modal-backdrop info-subdialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !deletingAccount) setConfirmingDelete(false);
          }}
        >
          <section className="flow-dialog glass-panel" role="dialog" aria-modal="true" aria-label={text.deleteAccountConfirmTitle}>
            <div className="dialog-header centered">
              <AlertTriangle aria-hidden="true" size={28} />
              <h3>{text.deleteAccountConfirmTitle}</h3>
              <p>{text.deleteAccountConfirmBody}</p>
            </div>
            <div className="dialog-action-row">
              <button
                className="secondary-action"
                type="button"
                onClick={() => setConfirmingDelete(false)}
                disabled={deletingAccount}
              >
                {appText.cancel}
              </button>
              <button
                className="danger-action"
                type="button"
                disabled={deletingAccount}
                onClick={async () => {
                  // Guard the whole await: onDeleteAccount unmounts this dialog
                  // on success (session torn down), and on failure App toasts —
                  // either way the button must not fire twice.
                  if (deletingAccount) return;
                  setDeletingAccount(true);
                  try {
                    await onDeleteAccount();
                  } finally {
                    setDeletingAccount(false);
                  }
                }}
              >
                {deletingAccount ? text.deletingAccount : text.deleteAccountConfirmAction}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {infoDialog ? (
        <div
          className="modal-backdrop info-subdialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onOpenInfoDialog(null);
          }}
        >
          {(() => {
            const doc = infoDialog === "privacy" ? PRIVACY_POLICY : TERMS_OF_SERVICE;
            return (
              <section className="flow-dialog glass-panel legal-dialog" role="dialog" aria-modal="true" aria-label={doc.title}>
                <button className="dialog-close" type="button" aria-label={appText.cancel} onClick={() => onOpenInfoDialog(null)}>
                  <X aria-hidden="true" size={18} />
                </button>
                <div className="dialog-header">
                  <h3>{doc.title}</h3>
                  <p className="legal-updated">{doc.updated}</p>
                </div>
                <div className="legal-scroll">
                  <LegalDocumentBody document={doc} />
                </div>
              </section>
            );
          })()}
        </div>
      ) : null}
    </div>
  );
}
