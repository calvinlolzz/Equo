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

// ---------------------------------------------------------------------------
// Web push
// ---------------------------------------------------------------------------
//
// The payload is the JSON the server encrypted (see server/push/pushNotification):
// { title, body, url, tag }. Anything unreadable still produces a notification —
// on Chrome, a push event that ends without showNotification() gets the browser's
// own "This site has been updated in the background" instead, which is worse
// than a generic line of our own.
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  const title = payload.title || "Equo";
  const options = {
    body: payload.body || "群組有新的記錄",
    tag: payload.tag || "equo",
    // Same tag replaces the previous notification rather than stacking; renotify
    // still buzzes, so a second expense is not silently swallowed.
    renotify: Boolean(payload.tag),
    icon: "/icons/equo-icon-192.png",
    badge: "/icons/equo-icon-192.png",
    data: { url: payload.url || "/" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// Tapping one should land on the group it is about, in a window that is
// already open where possible — opening a second copy of an installed PWA is
// disorienting and loses whatever was on screen.
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/";

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      for (const client of windows) {
        if (new URL(client.url).pathname === target) {
          return client.focus();
        }
      }

      const existing = windows[0];
      if (existing) {
        await existing.focus();
        if ("navigate" in existing) return existing.navigate(target);
        return undefined;
      }

      return self.clients.openWindow(target);
    })(),
  );
});
