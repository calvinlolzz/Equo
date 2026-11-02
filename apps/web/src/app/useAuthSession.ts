import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createApiClient } from "./apiClient";
import { clearCloudCache } from "./cloudCache";
import { createCloudGroupsStore, type CloudGroupsStore } from "./cloudStore";
import { createMemoryStorage } from "./memoryStorage";
import { clearStashedLineIntent, readLineIntent, stashLineIntent } from "./lineIntent";
import { resumePendingLineLink } from "./lineLink";
import { stashPendingRoute } from "./pendingRoute";
import { clearSession, loadSession, saveSession, type StoredSession } from "./sessionStore";
import { buildAuthorizeUrl, parseOAuthFragment } from "./supabaseOAuth";
import { UI_TEXT } from "./uiText";

const text = UI_TEXT.app;

export type UseAuthSessionOptions = {
  showToast: (message: string) => void;
  /**
   * Called once, when an OAuth exchange creates a brand-new session - so the
   * profile can seed its display name from the account. Not called on a restored
   * session: the name is already whatever the user has since set it to.
   */
  onSignedIn: (session: StoredSession) => void;
  /** Sign-out has to close the open group too, which is the route's business, not this hook's. */
  onSignedOut: () => void;
  /**
   * A session that already exists, handed in by the page (LIFF signs in with
   * LINE before the App mounts). Nothing is read from storage to find one.
   */
  injectedSession?: StoredSession;
  /**
   * Whether the session, the cloud cache and the offline queue are kept in the
   * browser's storage. Default true. `false` means none of them is read,
   * written or cleared - the normal app's saved session on the same origin is
   * left exactly as it is, and the cloud store runs on a throwaway in-memory
   * storage instead.
   */
  persist?: boolean;
  /**
   * The server said the session is no longer good. Resolve true if a fresh one
   * is in place (the session is kept and work carries on), false to end it.
   * Without this the session is simply ended, as before.
   */
  onSessionExpired?: () => Promise<boolean>;
  /** Do not look for an OAuth redirect in the URL fragment (on /liff it can hold LINE's tokens, never ours). */
  skipOAuthFragment?: boolean;
};

/**
 * Who is signed in, and the cloud store that belongs to them.
 *
 * The store is keyed to the user: a new session builds a new one, and signing
 * out throws it away along with the cached data. That is why they live together
 * here rather than as two independent pieces of state - a session without its
 * store, or a store outliving its session, is a bug in either direction.
 */
export function useAuthSession({
  showToast,
  onSignedIn,
  onSignedOut,
  injectedSession,
  persist = true,
  onSessionExpired,
  skipOAuthFragment = false,
}: UseAuthSessionOptions) {
  const [session, setSession] = useState<StoredSession | null>(() => injectedSession ?? loadSession(Date.now()));
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  // Where the cloud store keeps its cache and offline queue. Undefined means
  // the browser's localStorage; a non-persisting session gets its own.
  const cacheStorage = useMemo(() => (persist ? undefined : createMemoryStorage()), [persist]);
  // One renewal at a time: a screenful of requests that all come back 401
  // together must produce one sign-in, not one each.
  const renewing = useRef<Promise<boolean> | null>(null);

  function endSession() {
    if (persist) {
      clearSession();
      clearCloudCache();
    }
    setSession(null);
    showToast(text.sessionExpired);
  }

  /** The server rejected the session (expired, revoked, or the account was disabled). */
  function handleSessionExpired() {
    if (!onSessionExpired) {
      endSession();
      return;
    }
    renewing.current ??= onSessionExpired()
      .catch(() => false)
      .finally(() => {
        renewing.current = null;
      });
    void renewing.current.then((kept) => {
      if (!kept) endSession();
    });
  }

  const cloudStore = useMemo<CloudGroupsStore | null>(() => {
    if (!session) return null;
    return createCloudGroupsStore({
      apiClient: createApiClient(),
      onSessionExpired: handleSessionExpired,
      userId: session.user.id,
      cacheStorage,
      onWriteDropped: () => showToast(text.offlineWriteDropped),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user.id]);

  const cloudState = useSyncExternalStore(
    (listener) => (cloudStore ? cloudStore.subscribe(listener) : () => {}),
    () => (cloudStore ? cloudStore.getState() : null),
    () => (cloudStore ? cloudStore.getState() : null),
  );

  useEffect(() => {
    if (!cloudStore) return;
    cloudStore.refreshGroups().catch(() => showToast(`${text.cloudSyncFailedPrefix}${text.groupNotFound}`));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cloudStore]);

  /**
   * Drain anything recorded while offline. Three triggers, because no single
   * one is reliable: mount covers "the app was closed before the network came
   * back", the online event covers a live reconnect, and visibilitychange
   * covers waking a backgrounded PWA on a device that never fired an online
   * event. flushPendingWrites is re-entrancy guarded, so overlapping triggers
   * are harmless.
   */
  useEffect(() => {
    if (!cloudStore) return;
    const flush = () => {
      cloudStore.flushPendingWrites().catch(() => {});
    };
    const flushIfVisible = () => {
      if (document.visibilityState === "visible") flush();
    };
    flush();
    window.addEventListener("online", flush);
    document.addEventListener("visibilitychange", flushIfVisible);
    return () => {
      window.removeEventListener("online", flush);
      document.removeEventListener("visibilitychange", flushIfVisible);
    };
  }, [cloudStore]);

  /**
   * Coming back from the Supabase OAuth redirect: the access token arrives in the
   * URL fragment. Exchange it for our own session, and get it out of the URL -
   * it must not sit in the address bar, the history entry, or a shared link.
   *
   * Runs once, on boot. A page with no fragment falls straight through.
   */
  useEffect(() => {
    if (skipOAuthFragment) return;
    const parsed = parseOAuthFragment(window.location.hash);
    if (!parsed) return;

    window.history.replaceState(null, document.title, window.location.pathname + window.location.search);

    if ("error" in parsed) {
      setAuthError(`${UI_TEXT.login.oauthErrorPrefix}${parsed.error}`);
      return;
    }

    setAuthLoading(true);

    createApiClient()
      .exchangeSupabaseToken(parsed.accessToken)
      .then(({ session: nextSession }) => {
        // nextSession.token is deliberately ignored: the same response set the
        // equo_session HttpOnly cookie, and that is what authenticates from here
        // on. Keeping a copy in localStorage would hand the credential to any XSS
        // on the page - see sessionStore.
        const stored: StoredSession = {
          expiresAt: nextSession.expires_at,
          user: {
            id: nextSession.user.id,
            email: nextSession.user.email,
            displayName: nextSession.user.display_name,
            avatarUrl: nextSession.user.avatar_url ?? undefined,
          },
        };
        saveSession(stored);
        // A pending LINE link survives the round trip the same way an
        // invite token does - see lineLink.ts. If one is waiting, bounce
        // straight to /line/link instead of finishing the rest of this
        // (App-shell-only) sign-in flow.
        if (resumePendingLineLink(Date.now())) return;
        setSession(stored);
        onSignedIn(stored);
        showToast(`${text.loginSuccessPrefix}${stored.user.displayName}`);
      })
      .catch((error: { code?: string }) => {
        setAuthError(error?.code === "ACCOUNT_DISABLED" ? text.accountDisabled : text.loginFailed);
      })
      .finally(() => {
        setAuthLoading(false);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function startGoogleLogin() {
    // Google sign-in cannot run inside LINE (disallowed_useragent), and a
    // non-persisting session has nowhere to put the result anyway.
    if (!persist) return;
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

    if (!supabaseUrl) {
      showToast(UI_TEXT.login.missingSupabaseUrl);
      return;
    }

    // The redirect comes back at the bare origin, so remember the group the
    // visitor was trying to reach before the path is thrown away.
    stashPendingRoute();
    // Same for a link from the LINE bot (?view= / ?entry=). A stash from some
    // earlier, abandoned login is dropped so it cannot fire on this one.
    const lineIntent = readLineIntent(window.location.search);
    if (lineIntent) stashLineIntent(lineIntent);
    else clearStashedLineIntent();
    window.location.href = buildAuthorizeUrl(supabaseUrl, window.location.origin);
  }

  function signOut() {
    if (persist) {
      clearSession();
      clearCloudCache();
    }
    setSession(null);
    onSignedOut();
    showToast(text.logoutSuccess);
  }

  return {
    session,
    setSession,
    cloudStore,
    cloudState,
    authLoading,
    authError,
    startGoogleLogin,
    signOut,
  };
}
