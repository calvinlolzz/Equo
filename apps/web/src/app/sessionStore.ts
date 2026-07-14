const SESSION_KEY = "equo.clean.session";

type StoredUser = {
  id: string;
  email: string;
  displayName: string;
  /**
   * The user's real avatar (Google profile picture by default, or a custom
   * upload once set via updateMyAvatar). Optional/absent for sessions
   * persisted before this field existed - isStoredUser only requires it when
   * present, so an old stored session round-trips fine and simply has no
   * avatar until the next login/upload.
   */
  avatarUrl?: string | null;
};

/**
 * What's kept in localStorage is who is logged in and until when - NOT the
 * credential. The session token lives in the `equo_session` HttpOnly cookie
 * and JavaScript never touches it (see apiClient.ts).
 *
 * `expiresAt` mirrors the cookie's own lifetime so the app can render a logged
 * -out state without a round-trip; it is a hint, never the authority. The
 * server decides, and any request that comes back UNAUTHENTICATED logs the
 * session out regardless of what this says.
 *
 * A session persisted by an older build still carries a `token` field. It is
 * simply ignored - and cleared on the next write - so an upgrade does not log
 * anyone out.
 */
export type StoredSession = {
  expiresAt: string;
  user: StoredUser;
};

type SessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): SessionStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function isStoredUser(value: unknown): value is StoredUser {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.email === "string" &&
    typeof candidate.displayName === "string" &&
    (candidate.avatarUrl === undefined || candidate.avatarUrl === null || typeof candidate.avatarUrl === "string")
  );
}

function isStoredSession(value: unknown): value is StoredSession {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  // A `token` field from an older build may still be present. Don't require it,
  // and don't reject it - an already-logged-in user must survive the upgrade.
  return typeof candidate.expiresAt === "string" && isStoredUser(candidate.user);
}

export function loadSession(now: number = Date.now(), storage: SessionStorage | null = browserStorage()): StoredSession | null {
  const raw = storage?.getItem(SESSION_KEY);
  if (!raw) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }

  if (!isStoredSession(parsed)) return null;

  const expiresAtMs = Date.parse(parsed.expiresAt);
  if (Number.isNaN(expiresAtMs) || expiresAtMs <= now) {
    clearSession(storage);
    return null;
  }

  // Anyone logged in before this build still has the raw session token sitting
  // in localStorage. Moving the credential to an HttpOnly cookie is worth
  // nothing while a copy of it is still lying there readable, so purge it on
  // the first load after the upgrade rather than waiting for it to expire.
  const session: StoredSession = { expiresAt: parsed.expiresAt, user: parsed.user };

  if ("token" in parsed) {
    saveSession(session, storage);
  }

  return session;
}

export function saveSession(session: StoredSession, storage: SessionStorage | null = browserStorage()) {
  storage?.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(storage: SessionStorage | null = browserStorage()) {
  storage?.removeItem(SESSION_KEY);
}
