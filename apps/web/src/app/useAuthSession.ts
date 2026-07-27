import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { createApiClient } from "./apiClient";
import { clearCloudCache } from "./cloudCache";
import { createCloudGroupsStore, type CloudGroupsStore } from "./cloudStore";
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
};

/**
 * Who is signed in, and the cloud store that belongs to them.
 *
 * The store is keyed to the user: a new session builds a new one, and signing
 * out throws it away along with the cached data. That is why they live together
 * here rather than as two independent pieces of state - a session without its
 * store, or a store outliving its session, is a bug in either direction.
 */
export function useAuthSession({ showToast, onSignedIn, onSignedOut }: UseAuthSessionOptions) {
  const [session, setSession] = useState<StoredSession | null>(() => loadSession(Date.now()));
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");

  /** The server rejected the session (expired, revoked, or the account was disabled). */
  function handleSessionExpired() {
    clearSession();
    clearCloudCache();
    setSession(null);
    showToast(text.sessionExpired);
  }

  const cloudStore = useMemo<CloudGroupsStore | null>(() => {
    if (!session) return null;
    return createCloudGroupsStore({
      apiClient: createApiClient(),
      onSessionExpired: handleSessionExpired,
      userId: session.user.id,
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
   * Coming back from the Supabase OAuth redirect: the access token arrives in the
   * URL fragment. Exchange it for our own session, and get it out of the URL -
   * it must not sit in the address bar, the history entry, or a shared link.
   *
   * Runs once, on boot. A page with no fragment falls straight through.
   */
  useEffect(() => {
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
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;

    if (!supabaseUrl) {
      showToast(UI_TEXT.login.missingSupabaseUrl);
      return;
    }

    // The redirect comes back at the bare origin, so remember the group the
    // visitor was trying to reach before the path is thrown away.
    stashPendingRoute();
    window.location.href = buildAuthorizeUrl(supabaseUrl, window.location.origin);
  }

  function signOut() {
    clearSession();
    clearCloudCache();
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
