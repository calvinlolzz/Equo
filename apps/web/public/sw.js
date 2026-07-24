// Minimal PWA service worker. Strategy:
//  - install: skipWaiting so a new SW takes over without waiting for old
//    tabs to close.
//  - activate: delete any cache from a previous version, cache "/" for the
//    navigation fallback below, then clients.claim so open tabs are
//    controlled immediately.
//  - fetch: only intercept same-origin GET requests.
//      * /assets/* (hashed, immutable build output) -> cache-first, since
//        the filename changes whenever the content does.
//      * navigation requests (SPA routes) -> network-first, falling back to
//        the cached "/" shell when offline so the app still boots.
//      * everything else (notably /api/* and any cross-origin request,
//        e.g. Supabase) passes through untouched - never cached, never
//        intercepted.
const CACHE_NAME = "equo-cache-v1";

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)));
      const cache = await caches.open(CACHE_NAME);
      // Guard the shell precache: if the device is offline at activate (or "/"
      // returns non-200), a rejection here must NOT abort clients.claim() or
      // leave the caches deleted with open tabs uncontrolled. The navigate
      // handler re-caches "/" on the next successful load.
      try {
        await cache.add("/");
      } catch {
        // Ignore — shell will be cached on the next online navigation.
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (url.pathname.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then((cached) => cached ?? fetch(request).then((response) => {
        const copy = response.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        return response;
      })),
    );
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          // Stale-while-revalidate the offline shell: keep the cached "/" in
          // step with the latest deploy instead of frozen at first install.
          // Only cache genuine HTML — a direct navigation to /robots.txt,
          // /icons/*.png, /site.webmanifest, etc. is also mode:"navigate" and
          // must never be stored as the app shell.
          const isHtml = (response.headers.get("content-type") || "").includes("text/html");
          if (response && response.ok && isHtml) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put("/", copy)).catch(() => {});
          }
          return response;
        } catch {
          const cached = await caches.match("/");
          return cached ?? fetch(request);
        }
      })(),
    );
  }
});
