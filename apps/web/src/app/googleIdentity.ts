const SCRIPT_SRC = "https://accounts.google.com/gsi/client";
const SCRIPT_LOAD_TIMEOUT_MS = 8_000;

export type GoogleCredentialResponse = {
  credential: string;
};

export type GoogleAccountsId = {
  initialize: (config: { client_id: string; callback: (response: GoogleCredentialResponse) => void }) => void;
  renderButton: (
    parent: HTMLElement,
    options: {
      type?: "standard" | "icon";
      theme?: "outline" | "filled_blue" | "filled_black";
      size?: "large" | "medium" | "small";
      text?: "signin_with" | "signup_with" | "continue_with" | "signin";
      width?: number;
    },
  ) => void;
  prompt: (momentListener?: (notification: unknown) => void) => void;
};

export type GoogleGlobal = {
  accounts: {
    id: GoogleAccountsId;
  };
};

type WindowWithGoogle = typeof window & { google?: GoogleGlobal };

let scriptLoadPromise: Promise<void> | null = null;

function getWindow(): WindowWithGoogle | null {
  return typeof window === "undefined" ? null : (window as WindowWithGoogle);
}

/**
 * Injects the Google Identity Services script (once) and resolves once
 * window.google.accounts.id is available. Rejects on script load error or
 * after an ~8s timeout.
 */
export function loadGoogleIdentityScript(): Promise<void> {
  const win = getWindow();
  if (!win) {
    return Promise.reject(new Error("Google Identity Services requires a browser environment."));
  }

  if (win.google?.accounts?.id) {
    return Promise.resolve();
  }

  if (scriptLoadPromise) {
    return scriptLoadPromise;
  }

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    const existing = win.document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);

    const finish = () => {
      window.clearTimeout(timeoutId);
      if (win.google?.accounts?.id) {
        resolve();
      } else {
        reject(new Error("Google Identity Services failed to initialize."));
      }
    };

    const fail = (error: unknown) => {
      window.clearTimeout(timeoutId);
      scriptLoadPromise = null;
      reject(error instanceof Error ? error : new Error("Failed to load Google Identity Services."));
    };

    const timeoutId = window.setTimeout(() => {
      scriptLoadPromise = null;
      reject(new Error("Timed out loading Google Identity Services."));
    }, SCRIPT_LOAD_TIMEOUT_MS);

    if (existing) {
      existing.addEventListener("load", finish, { once: true });
      existing.addEventListener("error", fail, { once: true });
      // Script may have already finished loading before this listener attached.
      if (win.google?.accounts?.id) finish();
      return;
    }

    const script = win.document.createElement("script");
    script.src = SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", finish, { once: true });
    script.addEventListener("error", fail, { once: true });
    win.document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

/**
 * Initializes google.accounts.id with the given client id and a callback that
 * resolves the returned promise with the ID token credential. Renders the
 * real Google Sign-In button into `container` (more reliable than the One
 * Tap prompt(), which browsers frequently suppress).
 *
 * The `google` param is injectable for tests; it defaults to window.google.
 */
export function renderGoogleSignInButton(
  clientId: string,
  container: HTMLElement,
  onCredential: (credential: string) => void,
  google: GoogleGlobal | undefined = getWindow()?.google,
) {
  if (!google?.accounts?.id) {
    throw new Error("Google Identity Services is not loaded.");
  }

  google.accounts.id.initialize({
    client_id: clientId,
    callback: (response) => onCredential(response.credential),
  });

  google.accounts.id.renderButton(container, {
    type: "standard",
    theme: "filled_black",
    size: "large",
    text: "signin_with",
    width: 260,
  });
}

/**
 * Convenience wrapper: loads the script (if needed), then renders the button
 * and resolves with the credential once the user completes sign-in.
 */
export async function requestGoogleCredential(clientId: string, container: HTMLElement): Promise<string> {
  await loadGoogleIdentityScript();

  return new Promise<string>((resolve) => {
    renderGoogleSignInButton(clientId, container, resolve);
  });
}

/** Test-only helper to reset the module's cached script-load promise. */
export function __resetGoogleIdentityScriptCacheForTests() {
  scriptLoadPromise = null;
}
