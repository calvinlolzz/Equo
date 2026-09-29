import { useEffect, useState } from "react";
import { createApiClient } from "./apiClient";
import {
  clearPendingLineLink,
  isLineInAppBrowser,
  readLinkTokenFromSearch,
  readPendingLineLink,
  stashPendingLineLink,
} from "./lineLink";
import { loadSession } from "./sessionStore";
import { buildAuthorizeUrl } from "./supabaseOAuth";
import { ACTIVE_LOCALE, UI_TEXT } from "./uiText";

const text = UI_TEXT.lineLink;

type LineLinkPageState = "loading" | "expired" | "signedOut" | "confirm" | "redirecting" | "done" | "error";

/**
 * /line/link - the browser half of the LINE account-link flow (see
 * server/line/lineWebhook.ts / lineRoutes.ts for the bot and API halves).
 *
 * A visitor lands here from a link the bot sent (?linkToken=...), possibly
 * signed out. Signing in bounces through Google/Supabase OAuth, which drops
 * back at the bare origin (redirect_to) rather than back here - so the token
 * is stashed in sessionStorage before that redirect, exactly like an invite
 * token (see useInviteFlow.ts), and useAuthSession's resumePendingLineLink
 * call bounces the freshly-signed-in visitor back to this page once a
 * session exists.
 */
export function LineLinkPage() {
  const [state, setState] = useState<LineLinkPageState>("loading");
  const [token, setToken] = useState("");
  const [email, setEmail] = useState("");
  const [alreadyLinked, setAlreadyLinked] = useState(false);

  useEffect(() => {
    window.document.title = `${text.pageTitle} — Equo`;
  }, []);

  // Runs once, on mount: resolve which token this visit is about (URL first,
  // stash second - mirrors readPendingInviteToken's order), strip it from the
  // address bar immediately (it must not sit in the URL, history, or
  // Analytics - see main.tsx skipping <Analytics /> on this path), and figure
  // out whether there is a session to confirm the link with.
  useEffect(() => {
    const now = Date.now();
    const urlToken = readLinkTokenFromSearch(window.location.search);

    if (urlToken) {
      stashPendingLineLink(urlToken, now);
      const url = new URL(window.location.href);
      url.searchParams.delete("linkToken");
      url.searchParams.delete("openExternalBrowser");
      window.history.replaceState(null, document.title, `${url.pathname}${url.search}${url.hash}`);
    }

    const resolved = urlToken || readPendingLineLink(now);
    if (!resolved) {
      setState("expired");
      return;
    }
    setToken(resolved);

    const session = loadSession(now);
    if (!session) {
      setState("signedOut");
      return;
    }
    setEmail(session.user.email);

    createApiClient()
      .getMyLineLink()
      .then((result) => {
        setAlreadyLinked(result.linked);
        setState("confirm");
      })
      .catch((error: { code?: string }) => {
        setState(error?.code === "UNAUTHENTICATED" ? "signedOut" : "error");
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSignIn() {
    const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
    if (!supabaseUrl) {
      setState("error");
      return;
    }
    // redirect_to is the bare origin (not this page) - see the module doc.
    window.location.href = buildAuthorizeUrl(supabaseUrl, window.location.origin);
  }

  async function handleConfirm() {
    setState("redirecting");
    try {
      const result = await createApiClient().startLineLink(token, ACTIVE_LOCALE);

      if ("already_linked" in result && result.already_linked) {
        clearPendingLineLink();
        setState("done");
        return;
      }

      // Re-checked here even though the server built the URL: this is the
      // last line of defence against ever navigating somewhere that isn't
      // LINE's own accountLink dialog.
      if ("redirect_url" in result && result.redirect_url.startsWith("https://access.line.me/")) {
        clearPendingLineLink();
        window.location.assign(result.redirect_url);
        return;
      }

      setState("error");
    } catch (error) {
      setState((error as { code?: string } | null)?.code === "LINE_LINK_EXPIRED" ? "expired" : "error");
    }
  }

  function handleCancel() {
    clearPendingLineLink();
    window.location.href = "/";
  }

  const inAppBrowser = typeof navigator !== "undefined" && isLineInAppBrowser(navigator.userAgent);
  const confirmAccountText = text.confirmAccount.replace("{email}", email);

  return (
    <main className="app-shell legal-page">
      <div className="legal-page-inner glass-panel line-link-page">
        {state === "loading" ? <p className="line-link-status">…</p> : null}

        {state === "expired" ? (
          <div className="line-link-body">
            <h1>{text.expiredTitle}</h1>
            <p>{text.expiredBody}</p>
            <a className="primary-action line-link-action" href="/">
              {text.backHome}
            </a>
          </div>
        ) : null}

        {state === "signedOut" ? (
          <div className="line-link-body">
            <h1>{text.pageTitle}</h1>
            <p>{text.signInPrompt}</p>
            {inAppBrowser ? (
              <p className="line-link-hint">{text.inAppBrowserHint}</p>
            ) : (
              <button className="primary-action line-link-action" type="button" onClick={handleSignIn}>
                {text.signIn}
              </button>
            )}
          </div>
        ) : null}

        {state === "confirm" || state === "redirecting" ? (
          <div className="line-link-body">
            <h1>{text.pageTitle}</h1>
            <p>{confirmAccountText}</p>
            {alreadyLinked ? <p className="line-link-hint">{text.alreadyLinkedNote}</p> : null}
            <p className="line-link-notice">{text.unlinkNotice}</p>
            <div className="line-link-actions">
              <button
                className="secondary-action line-link-action"
                type="button"
                onClick={handleCancel}
                disabled={state === "redirecting"}
              >
                {text.cancel}
              </button>
              <button
                className="primary-action line-link-action"
                type="button"
                onClick={handleConfirm}
                disabled={state === "redirecting"}
              >
                {state === "redirecting" ? text.redirecting : text.confirm}
              </button>
            </div>
          </div>
        ) : null}

        {state === "done" ? (
          <div className="line-link-body">
            <h1>{text.pageTitle}</h1>
            <p>{text.doneAlready}</p>
            <a className="primary-action line-link-action" href="/">
              {text.backHome}
            </a>
          </div>
        ) : null}

        {state === "error" ? (
          <div className="line-link-body">
            <h1>{text.pageTitle}</h1>
            <p>{text.failed}</p>
            <a className="primary-action line-link-action" href="/">
              {text.backHome}
            </a>
          </div>
        ) : null}
      </div>
    </main>
  );
}
