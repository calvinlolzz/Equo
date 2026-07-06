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

export type StoredSession = {
  token: string;
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
  return (
    typeof candidate.token === "string" &&
    typeof candidate.expiresAt === "string" &&
    isStoredUser(candidate.user)
  );
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

  return parsed;
}

export function saveSession(session: StoredSession, storage: SessionStorage | null = browserStorage()) {
  storage?.setItem(SESSION_KEY, JSON.stringify(session));
}

export function clearSession(storage: SessionStorage | null = browserStorage()) {
  storage?.removeItem(SESSION_KEY);
}
