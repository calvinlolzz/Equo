const AUTH_TOKEN_KEY = "equo.google_id_token";

type TokenStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStorage(): TokenStorage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

export function loadAuthToken(storage: TokenStorage | null = browserStorage()) {
  return storage?.getItem(AUTH_TOKEN_KEY) ?? null;
}

export function saveAuthToken(token: string, storage: TokenStorage | null = browserStorage()) {
  const nextToken = token.trim();

  if (!nextToken) {
    clearAuthToken(storage);
    return;
  }

  storage?.setItem(AUTH_TOKEN_KEY, nextToken);
}

export function clearAuthToken(storage: TokenStorage | null = browserStorage()) {
  storage?.removeItem(AUTH_TOKEN_KEY);
}
