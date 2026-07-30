import React, { Suspense } from "react";
import { createRoot } from "react-dom/client";
import { Analytics } from "@vercel/analytics/react";
import "./app/App.css";
import { App } from "./app/App";
import { ErrorBoundary } from "./app/ErrorBoundary";
import { installErrorReporter } from "./app/errorReporter";
import { purgeLegacyBrowserStorage } from "./app/legacyStorageCleanup";
import { initTheme } from "./app/themeStore";

// Drop the pre-rename `floatpay-*` localStorage keys left behind on returning
// visitors' devices (see legacyStorageCleanup.ts). Idempotent no-op once gone.
purgeLegacyBrowserStorage();

const root = document.getElementById("root");

if (!root) {
  throw new Error("MVP App Shell root element is missing");
}

// /admin serves the operator console as a lazy chunk of the same SPA bundle:
// regular users never download it, and the admin page skips the WebGL
// backdrop entirely.
const isAdminPath = window.location.pathname === "/admin" || window.location.pathname.startsWith("/admin/");
const AdminApp = React.lazy(() => import("./app/AdminApp").then((module) => ({ default: module.AdminApp })));

// The animated backdrop is decoration: a WebGL shader that nobody interacts
// with and that the app is fully usable without. Loading it in the entry chunk
// meant the first screen waited on it; as a lazy sibling it arrives a beat
// later behind an already-interactive page, and the CSS gradient underneath
// covers the gap.
const GlassBackground = React.lazy(() =>
  import("./app/GlassBackground").then((module) => ({ default: module.GlassBackground })),
);

// Apply the persisted day/night theme to <html> before first paint (no flash).
// The admin console keeps its own dark styling, so skip theming there.
if (!isAdminPath) {
  initTheme();
}

// Global crash telemetry -> POST /api/v1/errors (deduped, capped per page
// load; see errorReporter.ts). Installed before render so even a crash
// during the first mount gets reported.
installErrorReporter(isAdminPath ? "admin" : "web");

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
        <Suspense fallback={null}>
          <GlassBackground />
        </Suspense>
        <ErrorBoundary source="web">
          <App />
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

// Register the PWA service worker in production builds only, after the page
// has finished loading so it never competes with the initial render/fetch.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((error) => {
      console.debug("[sw] registration failed", error);
    });
  });
}
