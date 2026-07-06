import { useRef, useState } from "react";
import { Contrast, FileText, Globe, Lock, LogOut, Pencil, X, Apple } from "lucide-react";
import { downscaleImageFileToDataUrl } from "./expenseImage";
import type { ProfileData } from "./profileStore";
import type { StoredSession } from "./sessionStore";
import { UI_TEXT } from "./uiText";

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
  onClose,
  onSave,
  onToast,
  onLogout,
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
  onClose: () => void;
  onSave: (profile: ProfileData) => void | Promise<void>;
  onToast: (message: string) => void;
  onLogout: () => void;
}) {
  const [tab, setTab] = useState<ProfileTab>("account");
  const [name, setName] = useState(profile.name);
  const initialAvatarDataUrl = displayAvatarUrl ?? profile.avatarDataUrl ?? "";
  const [avatarDataUrl, setAvatarDataUrl] = useState(initialAvatarDataUrl);
  const [editingName, setEditingName] = useState(false);
  const [infoDialog, setInfoDialog] = useState<"privacy" | "terms" | null>(null);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isLoggedIn = Boolean(session);

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
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section className="flow-dialog profile-dialog glass-panel" role="dialog" aria-modal="true" aria-label={text.title}>
        <button className="dialog-close" type="button" aria-label={appText.cancel} onClick={onClose}>
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
            {avatarDataUrl ? <img src={avatarDataUrl} alt="" /> : <span>{initial(name)}</span>}
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
          <span
            className="profile-tab-indicator"
            style={{ transform: `translateX(${TABS.findIndex((item) => item.id === tab) * 100}%)` }}
            aria-hidden="true"
          />
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
            <div className="profile-account-row">
              <span className="profile-account-icon">
                <Apple aria-hidden="true" size={20} />
              </span>
              <span className="profile-account-info">
                <strong>{text.appleAccount}</strong>
                <small>{text.notLinked}</small>
              </span>
              <button className="profile-link-action" type="button" onClick={() => onToast(text.appleLinkToast)}>
                {text.linkAccount}
              </button>
            </div>
          </div>
        ) : (
          <div className="profile-other-list">
            <button className="profile-other-row" type="button" onClick={() => onToast(text.switchThemeToast)}>
              <Contrast aria-hidden="true" size={19} />
              <span>{text.switchTheme}</span>
            </button>
            <button className="profile-other-row" type="button" onClick={() => onToast(text.languageToast)}>
              <Globe aria-hidden="true" size={19} />
              <span>{text.languageSetting}</span>
            </button>
            <button className="profile-other-row" type="button" onClick={() => setInfoDialog("privacy")}>
              <Lock aria-hidden="true" size={19} />
              <span>{text.privacyPolicy}</span>
            </button>
            <button className="profile-other-row" type="button" onClick={() => setInfoDialog("terms")}>
              <FileText aria-hidden="true" size={19} />
              <span>{text.termsOfService}</span>
            </button>
          </div>
        )}

        {hasPendingChange ? (
          <div className="dialog-action-row">
            <button className="secondary-action" type="button" onClick={onClose} disabled={saving}>
              {appText.cancel}
            </button>
            <button className="primary-action" type="button" onClick={handleConfirm} disabled={saving}>
              {saving ? appText.savingChanges : appText.confirm}
            </button>
          </div>
        ) : null}
      </section>

      {infoDialog ? (
        <div
          className="modal-backdrop info-subdialog-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setInfoDialog(null);
          }}
        >
          <section className="flow-dialog glass-panel" role="dialog" aria-modal="true" aria-label={infoDialog === "privacy" ? text.privacyPolicy : text.termsOfService}>
            <button className="dialog-close" type="button" aria-label={appText.cancel} onClick={() => setInfoDialog(null)}>
              <X aria-hidden="true" size={18} />
            </button>
            <div className="dialog-header">
              <h3>{infoDialog === "privacy" ? text.privacyPolicy : text.termsOfService}</h3>
              <p>{infoDialog === "privacy" ? text.privacyPolicyBody : text.termsOfServiceBody}</p>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
