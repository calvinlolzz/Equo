import type { EquoApiClient } from "../apiClient";
import { readLineIntent, type LineIntent } from "../lineIntent";
import type { StoredSession } from "../sessionStore";
import { LIFF_BOOTED_KEY } from "./liffPath";
import type { LiffSdk } from "./liffSdk";

export { LIFF_BOOTED_KEY };

/**
 * Signing in on /liff, as a state machine over an injected SDK and API.
 *
 * Nothing here touches the real SDK, window or network, so every branch is
 * driven by a fake in liffBoot.test.ts. The order of the steps is the contract:
 *
 *   1. back/forward guard  - a page restored from history closes itself
 *   2. GET /line/liff      - no id => LIFF is switched off => unavailable
 *   3. sdk.init            - throws or takes over 20 s => failed
 *      not inside the LINE app => unavailable (the browser app is the way out)
 *   4. not logged in       - login(), once per tab
 *   5. no ID token         - login(), once per tab
 *   6. POST /auth/line     - EXPIRED => re-login once per tab; NOT_LINKED, DISABLED
 *   7. bearer set          - held in memory by the api client, nowhere else
 *   8. intent read         - only the closed set lineIntent.ts allows
 *   9. URL replaced        - /group/<ledger>, no query, no fragment
 *  10. ready
 *
 * The LINE ID token goes to exactly one place: POST /auth/line.
 */
export type LiffBootState =
  | { phase: "loading" }
  | { phase: "unavailable"; fallbackUrl: string }
  | { phase: "redirecting" }
  | { phase: "notLinked" }
  | { phase: "disabled" }
  | { phase: "failed"; fallbackUrl: string }
  | { phase: "ready"; session: StoredSession; ledgerId: string; intent: LineIntent | null };

export type LiffBootDeps = {
  sdk: () => Promise<LiffSdk>;
  api: Pick<EquoApiClient, "getLiffConfig" | "exchangeLineIdToken">;
  location: Pick<Location, "origin" | "pathname" | "search">;
  /** sessionStorage: tab-scoped, so the guards below reset with the tab. */
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  /** The api client's in-memory bearer (setApiBearerToken). */
  setBearer: (token: string | null) => void;
  /** `performance.getEntriesByType("navigation")[0]?.type`. */
  navigationType: () => string | undefined;
  /** history.replaceState(null, "", path). */
  replaceUrl: (path: string) => void;
};

/** Set when this tab has sent the user to LINE's login. One per tab, until a sign-in succeeds. */
export const LIFF_RELOGIN_KEY = "equo.liff.relogin";

/**
 * How long sdk.init may take. In one SDK path (the Android external-browser
 * login) a vendor script it waits for can be blocked by our CSP with no error
 * event, so init would never settle and the page would sit on "opening Equo"
 * for ever, silently. Time out and show the way out instead.
 */
export const LIFF_INIT_TIMEOUT_MS = 20_000;

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error("LIFF init timed out")), ms);
  });

  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

function safeGet(storage: LiffBootDeps["storage"], key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(storage: LiffBootDeps["storage"], key: string): boolean {
  try {
    storage.setItem(key, "1");
    return true;
  } catch {
    return false;
  }
}

function safeRemove(storage: LiffBootDeps["storage"], key: string): void {
  try {
    storage.removeItem(key);
  } catch {
    // Nothing to clear if the storage is unreachable.
  }
}

/**
 * The one login this tab gets. True means "go ahead and redirect"; false means
 * it was already spent - or could not be recorded, in which case redirecting
 * could loop forever, so the answer is no.
 */
function claimLogin(storage: LiffBootDeps["storage"]): boolean {
  if (safeGet(storage, LIFF_RELOGIN_KEY)) return false;
  return safeSet(storage, LIFF_RELOGIN_KEY);
}

/**
 * What a link asked for, from the page's query string.
 *
 * LINE delivers the part of `https://liff.line.me/<id>?view=records` after the
 * id in two ways: on the endpoint URL's own query, or - after a sign-in round
 * trip - folded into `liff.state` ("?view=records", possibly with a path in
 * front). Both are read through readLineIntent, i.e. through the closed set:
 * `view` in {records, analysis} or `entry` matching the key pattern. Nothing
 * from liff.state is ever treated as a URL, a path or anything to navigate to.
 */
export function readLiffIntent(search: string): LineIntent | null {
  const direct = readLineIntent(search);
  if (direct) return direct;

  const state = new URLSearchParams(search).get("liff.state");
  if (!state) return null;

  const queryStart = state.indexOf("?");
  if (queryStart < 0) return null;
  return readLineIntent(state.slice(queryStart).split("#")[0]);
}

function intentQuery(intent: LineIntent | null): string {
  if (!intent) return "";
  return intent.kind === "entry" ? `entry=${encodeURIComponent(intent.entryKey)}` : `view=${intent.kind}`;
}

/** The /liff address LINE should come back to after signing in. Rebuilt from the closed set - never copied from the current URL, which may hold LINE's own parameters. */
export function liffRedirectUri(origin: string, intent: LineIntent | null): string {
  const query = intentQuery(intent);
  return `${origin}/liff${query ? `?${query}` : ""}`;
}

/** Where "open in browser" goes: the same ledger page the card used to link to, so nothing is lost. */
export function liffFallbackUrl(origin: string, ledgerId: string | null, intent: LineIntent | null): string {
  const query = [intentQuery(intent), "openExternalBrowser=1"].filter(Boolean).join("&");
  return ledgerId
    ? `${origin}/group/${encodeURIComponent(ledgerId)}?${query}`
    : `${origin}/?${query}`;
}

function errorCode(error: unknown): string | undefined {
  return (error as { code?: string } | null)?.code;
}

/** Runs the sign-in. Resolves to the state to show; `ready` carries everything App needs. */
export async function bootLiff(deps: LiffBootDeps): Promise<LiffBootState> {
  const { location, storage } = deps;
  // Read before init: the SDK tidies the address bar as it goes.
  const initialIntent = readLiffIntent(location.search);
  const failed = (): LiffBootState => ({
    phase: "failed",
    fallbackUrl: liffFallbackUrl(location.origin, null, initialIntent),
  });

  let sdk: LiffSdk;
  try {
    sdk = await deps.sdk();
  } catch {
    return failed();
  }

  // 1. Back/forward: a page the browser restored from history, after this tab
  // already signed in once, has nothing to show but a way out.
  if (deps.navigationType() === "back_forward" && safeGet(storage, LIFF_BOOTED_KEY)) {
    sdk.closeWindow();
    return { phase: "redirecting" };
  }

  // 2.
  let liffId: string | null;
  try {
    liffId = (await deps.api.getLiffConfig()).liff_id;
  } catch {
    return failed();
  }
  if (!liffId) {
    return { phase: "unavailable", fallbackUrl: liffFallbackUrl(location.origin, null, initialIntent) };
  }

  // 3.
  try {
    await withTimeout(sdk.init({ liffId }), LIFF_INIT_TIMEOUT_MS);
  } catch {
    return failed();
  }

  // LIFF is for the LINE app. In an external or desktop browser the SDK leaves
  // LINE's own tokens in localStorage, where whoever uses that browser next
  // could walk back into the ledger; Equo's normal sign-in is the right door
  // there. Before any login or exchange.
  if (!sdk.isInClient()) {
    return { phase: "unavailable", fallbackUrl: liffFallbackUrl(location.origin, null, initialIntent) };
  }

  const intent = initialIntent ?? readLiffIntent(location.search);
  const signIn = (): LiffBootState => {
    if (!claimLogin(storage)) return failed();
    sdk.login({ redirectUri: liffRedirectUri(location.origin, intent) });
    return { phase: "redirecting" };
  };

  // 4. and 5.
  if (!sdk.isLoggedIn()) return signIn();
  const idToken = sdk.getIDToken();
  if (!idToken) return signIn();

  // 6.
  let response: Awaited<ReturnType<LiffBootDeps["api"]["exchangeLineIdToken"]>>;
  try {
    response = await deps.api.exchangeLineIdToken(idToken);
  } catch (error) {
    switch (errorCode(error)) {
      case "LINE_ID_TOKEN_EXPIRED":
        if (!claimLogin(storage)) return failed();
        sdk.logout();
        sdk.login({ redirectUri: liffRedirectUri(location.origin, intent) });
        return { phase: "redirecting" };
      case "LINE_NOT_LINKED":
        return { phase: "notLinked" };
      case "ACCOUNT_DISABLED":
        return { phase: "disabled" };
      default:
        return failed();
    }
  }

  const { session } = response;

  // 7. A sign-in worked, so the next one gets its single re-login back.
  deps.setBearer(session.token);
  safeRemove(storage, LIFF_RELOGIN_KEY);
  safeSet(storage, LIFF_BOOTED_KEY);

  // 9. Query and fragment out of the address bar: the intent is in memory now.
  deps.replaceUrl(`/group/${encodeURIComponent(session.ledger_id)}`);

  // 10.
  return {
    phase: "ready",
    ledgerId: session.ledger_id,
    intent,
    session: {
      expiresAt: session.expires_at,
      user: {
        id: session.user.id,
        email: session.user.email,
        displayName: session.user.display_name,
        avatarUrl: session.user.avatar_url ?? undefined,
      },
    },
  };
}

export type LiffReauthDeps = Pick<LiffBootDeps, "sdk" | "api" | "location" | "storage" | "setBearer"> & {
  /** Called with the new session's expiry whenever a renewal produced one (not when the page is just leaving for LINE's login). */
  onRenewed?: (expiresAt: string) => void;
};

/**
 * A 401 on a LIFF request: the 60-minute token ran out (or was revoked). Get a
 * new one the same way boot did. True means "carry on" - a fresh bearer is in
 * place, or a LINE sign-in has just been started and the page is about to
 * leave. False means the session is over.
 *
 * The old bearer is dropped BEFORE the exchange so it can never ride along:
 * an expired one would be refused by the server's gate before the route ran.
 */
export async function reauthenticateLiff(deps: LiffReauthDeps): Promise<boolean> {
  deps.setBearer(null);

  try {
    const sdk = await deps.sdk();
    const redirectUri = liffRedirectUri(deps.location.origin, null);

    const signIn = (): boolean => {
      if (!claimLogin(deps.storage)) return false;
      sdk.login({ redirectUri });
      return true;
    };

    if (!sdk.isLoggedIn()) return signIn();
    const idToken = sdk.getIDToken();
    if (!idToken) return signIn();

    try {
      const { session } = await deps.api.exchangeLineIdToken(idToken);
      deps.setBearer(session.token);
      safeRemove(deps.storage, LIFF_RELOGIN_KEY);
      deps.onRenewed?.(session.expires_at);
      return true;
    } catch (error) {
      if (errorCode(error) !== "LINE_ID_TOKEN_EXPIRED") return false;
      if (!claimLogin(deps.storage)) return false;
      sdk.logout();
      sdk.login({ redirectUri });
      return true;
    }
  } catch {
    return false;
  }
}
