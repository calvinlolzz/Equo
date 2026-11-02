import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { App } from "../App";
import type { LiffAppContext } from "../appChrome";
import { createApiClient, setApiBearerToken } from "../apiClient";
import { UI_TEXT } from "../uiText";
import { installCspViolationReporter } from "./cspReporter";
import { bootLiff, reauthenticateLiff, type LiffBootDeps, type LiffBootState } from "./liffBoot";
import { loadLiffSdk } from "./liffSdk";

const text = UI_TEXT.liff;

/** The real browser, wired to the state machine. Tests override pieces of it. */
function createBootDeps(overrides: Partial<LiffBootDeps> = {}): LiffBootDeps {
  let sdk: ReturnType<typeof loadLiffSdk> | null = null;
  return {
    // One load, however many callers: boot, a 401 re-auth and the close button share it.
    sdk: () => {
      sdk ??= loadLiffSdk().catch((error) => {
        sdk = null;
        throw error;
      });
      return sdk;
    },
    api: createApiClient(),
    location: window.location,
    storage: window.sessionStorage,
    setBearer: setApiBearerToken,
    navigationType: () => {
      const entry = window.performance?.getEntriesByType?.("navigation")?.[0] as PerformanceNavigationTiming | undefined;
      return entry?.type;
    },
    replaceUrl: (path) => window.history.replaceState(null, "", path),
    ...overrides,
  };
}

function Screen({ title, children }: { title?: string; children: ReactNode }) {
  return (
    <main className="app-shell legal-page">
      <div className="legal-page-inner glass-panel line-link-page">
        <div className="line-link-body">
          {title ? <h1>{title}</h1> : null}
          {children}
        </div>
      </div>
    </main>
  );
}

/**
 * /liff - the app, opened from a card inside LINE.
 *
 * Signs in with LINE's ID token (liffBoot.ts), then renders the ordinary <App />
 * in its LIFF chrome (appChrome.ts). The session is held in memory only: this
 * component never writes the saved-session key, and the App it renders is told
 * not to (useAuthSession's `persist: false`). A session that ends - the token
 * ran out and could not be renewed - lands on a plain screen here, never on
 * the Google login wall, which cannot work inside LINE.
 */
export function LiffApp({ overrides }: { overrides?: Partial<LiffBootDeps> }) {
  const deps = useMemo(() => createBootDeps(overrides), [overrides]);
  const [state, setState] = useState<LiffBootState>({ phase: "loading" });
  const [ended, setEnded] = useState(false);
  const mounted = useRef(false);
  const started = useRef(false);

  // Page-view analytics is not mounted on /liff (PageAnalytics); this is the
  // other half: a CSP gap shows up in the error log, not just a console nobody
  // can open inside LINE.
  useEffect(() => installCspViolationReporter(), []);

  // StrictMode runs this effect, tears it down and runs it again. The boot
  // itself must happen once - a second sign-in would race the first - so only
  // the "may I still set state" flag follows the effect.
  useEffect(() => {
    mounted.current = true;
    if (!started.current) {
      started.current = true;
      void bootLiff(deps).then((next) => {
        if (mounted.current) setState(next);
      });
    }
    return () => {
      mounted.current = false;
    };
  }, [deps]);

  const reauthenticate = useCallback(async () => {
    const ok = await reauthenticateLiff(deps);
    if (!ok && mounted.current) setEnded(true);
    return ok;
  }, [deps]);

  const closeWindow = useCallback(() => {
    deps
      .sdk()
      .then((sdk) => sdk.closeWindow())
      .catch(() => window.close());
  }, [deps]);

  const context = useMemo<LiffAppContext | null>(
    () =>
      state.phase === "ready"
        ? { session: state.session, ledgerId: state.ledgerId, intent: state.intent, reauthenticate }
        : null,
    [state, reauthenticate],
  );

  if (ended) {
    return (
      <Screen>
        <p>{text.sessionEnded}</p>
        <button className="primary-action line-link-action" type="button" onClick={closeWindow}>
          {text.backToChat}
        </button>
      </Screen>
    );
  }

  if (context) return <App liff={context} />;

  switch (state.phase) {
    case "notLinked":
      return (
        <Screen title={text.notLinkedTitle}>
          <p>{text.notLinkedBody}</p>
          <button className="primary-action line-link-action" type="button" onClick={closeWindow}>
            {text.backToChat}
          </button>
        </Screen>
      );
    case "disabled":
      return (
        <Screen>
          <p>{text.disabled}</p>
          <button className="primary-action line-link-action" type="button" onClick={closeWindow}>
            {text.backToChat}
          </button>
        </Screen>
      );
    case "unavailable":
    case "failed":
      return (
        <Screen>
          <p>{text.failed}</p>
          <a className="primary-action line-link-action" href={state.fallbackUrl} target="_blank" rel="noopener noreferrer">
            {text.openInBrowser}
          </a>
        </Screen>
      );
    default:
      // loading, and redirecting (the page is about to leave for LINE's sign-in, or to close).
      return (
        <Screen>
          <p className="line-link-status">{text.loading}</p>
        </Screen>
      );
  }
}
