import React, { Suspense } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import "./app/App.css";
import { App } from "./app/App";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { dismissAppSplash } from "./app/appSplash";
import { installErrorReporter } from "./app/errorReporter";
import { installKeyboardInset } from "./app/keyboardInset";
import { lazyChunk } from "./app/lazyChunk";
import { purgeLegacyBrowserStorage } from "./app/legacyStorageCleanup";
import { resolvePublicPage } from "./app/publicRoute";
import { initTheme } from "./app/themeStore";
import { ACTIVE_LOCALE, UI_TEXT } from "./app/uiText";

// Drop the pre-rename `floatpay-*` localStorage keys left behind on returning
// visitors' devices (see legacyStorageCleanup.ts). Idempotent no-op once gone.
purgeLegacyBrowserStorage();

// index.html ships lang="zh-Hant" so the first paint declares something; this
// corrects it once the saved or browser-preferred locale is known. It matters
// beyond tidiness: screen readers pick a voice from it, and Safari offers to
// translate a page whose declared language is not the one on screen.
document.documentElement.lang = ACTIVE_LOCALE;
// index.html carries the 繁體中文 title for the first paint and for crawlers;
// correct it once the reader's language is known, so a browser tab and the
// history entry are not in a language they cannot read.
document.title = UI_TEXT.misc.documentTitle;

const root = document.getElementById("root");

if (!root) {
  throw new Error("MVP App Shell root element is missing");
}

// /admin serves the operator console as a lazy chunk of the same SPA bundle:
// regular users never download it.
const isAdminPath = window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");
const AdminApp = lazyChunk(() => import("./app/AdminApp").then((module) => ({ default: module.AdminApp })));

// /privacy and /terms render the same documents as the in-app sheet, as pages
// that need no session — so they are a URL that can be handed to the OAuth
// consent screen, an app directory, or anyone deciding whether to sign in.
// Lazy, because the people who reach them are a small minority of visits and
// the documents are the largest strings in the app.
const publicPage = isAdminPath ? null : resolvePublicPage(window.location.pathname);
const LegalPage = lazyChunk(() => import("./app/LegalPage").then((module) => ({ default: module.LegalPage })));

// Apply the persisted day/night theme to <html> before first paint (no flash).
// The admin console keeps its own dark styling, so skip theming there.
if (!isAdminPath) {
  initTheme();
}

// Global crash telemetry -> POST /api/v1/errors (deduped, capped per page
// load; see errorReporter.ts). Installed before render so even a crash
// during the first mount gets reported.
installErrorReporter(isAdminPath ? "admin" : "web");

// Publish --keyboard-inset for the bottom sheets to size against (see
// keyboardInset.ts). Both surfaces have forms, and it is a no-op wherever
// there is no on-screen keyboard, so it is not gated on the path.
installKeyboardInset();

createRoot(root).render(
  <React.StrictMode>
    {isAdminPath ? (
      <ErrorBoundary source="admin">
        <Suspense fallback={null}>
          <AdminApp />
        </Suspense>
      </ErrorBoundary>
    ) : (
      <>
        <ErrorBoundary source="web">
          {publicPage ? (
            <Suspense fallback={null}>
              <LegalPage page={publicPage} />
            </Suspense>
          ) : (
            <App />
          )}
        </ErrorBoundary>
        {/* Page-view analytics. Serves its script and beacon from the app's own
            origin (/_vercel/insights/*), so the CSP's `self` script-src and
            connect-src already allow it — no policy change needed. Cookieless
            and no cross-site tracking, which is what the privacy policy says.
            Only on the user-facing app; the operator console isn't measured. */}
        <Analytics />
      </>
    )}
  </React.StrictMode>,
);

// Lift the launch screen (see index.html) — two frames deep, not one. The first
// callback runs before the browser paints what React just rendered; the second
// runs after. Dismissing on the first would uncover an empty page for a frame,
// which is the exact thing the splash is there to prevent.
//
// There is always something real in that first paint: the session is read
// synchronously from storage (useAuthSession's lazy initial state) and the group
// data is seeded synchronously from the cloud cache, so the app lands on either
// the login screen or a populated home — never a blank one.
requestAnimationFrame(() => requestAnimationFrame(() => dismissAppSplash()));

// Register the PWA service worker in production builds only, after the page
// has finished loading so it never competes with the initial render/fetch.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.debug("[sw] registration failed", error);
    });
  });
}
