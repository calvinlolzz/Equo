// Minimal PWA service worker. Strategy:
//  - install: skipWaiting so a new SW takes over without waiting for old
//    tabs to close.
//  - activate: delete any cache from a previous version, cache "/" for the
//    navigation fallback below, then clients.claim so open tabs are
//    controlled immediately.
//  - fetch: intercept same-origin GET requests, plus the one POST below.
//      * POST /share-target -> the OS share sheet handing us a photo; park it
//        and redirect to a GET the app can read.
//      * /assets/* (hashed, immutable build output) -> cache-first, since
//        the filename changes whenever the content does.
//      * navigation requests (SPA routes) -> network-first, falling back to
//        the cached "/" shell when offline so the app still boots.
//      * everything else (notably /api/* and any cross-origin request,
//        e.g. Supabase) passes through untouched - never cached, never
//        intercepted.
const CACHE_NAME = "equo-cache-v1";

// Handover slot for Web Share Target. Kept in its own cache so the activate
// handler's "delete every cache that isn't the current one" sweep can spare it,
// and so a shared photo is never one entry away from the app shell.
// Both names are mirrored in src/app/sharedReceipt.ts - change them together.
const SHARE_CACHE = "equo-share-v1";
const SHARE_KEY = "/__shared-receipt";
const KEEP_CACHES = [CACHE_NAME, SHARE_CACHE];

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((key) => !KEEP_CACHES.includes(key)).map((key) => caches.delete(key)));
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
  const url = new URL(request.url);

  // ---- Web Share Target ---------------------------------------------------
  // The OS posts the shared photo here as a form submission. There is no page
  // at /share-target and there deliberately isn't one: a POST can't be re-read
  // on the next load, so the file is parked in a cache and the browser is sent
  // on to a plain GET that the app picks up (see src/app/sharedReceipt.ts).
  // The redirect happens whether or not a usable file arrived - somebody who
  // shared plain text still ends up in the app rather than staring at an error.
  if (request.method === "POST" && url.origin === self.location.origin && url.pathname === "/share-target") {
    event.respondWith(
      (async () => {
        try {
          const form = await request.formData();
          const file = form.get("receipt");
          if (file && typeof file !== "string" && file.size > 0) {
            const cache = await caches.open(SHARE_CACHE);
            await cache.put(
              SHARE_KEY,
              new Response(file, { headers: { "content-type": file.type || "application/octet-stream" } }),
            );
            return Response.redirect("/?share=receipt", 303);
          }
        } catch {
          // A malformed multipart body, or storage that refuses the write.
          // Falls through to the plain redirect below.
        }
        return Response.redirect("/", 303);
      })(),
    );
    return;
  }

  if (request.method !== "GET") return;
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

  event.waitUntil(
    (async () => {
      await self.registration.showNotification(title, options);

      // Put a count on the home-screen icon as well, so a phone that was never
      // unlocked to read the banner still shows that something arrived. The
      // server doesn't send a per-recipient unread total, so the tray is the
      // source: how many of our notifications are still sitting there
      // undismissed. It is a close enough proxy - tags mean a second expense in
      // the same group replaces rather than stacks - and the app overwrites it
      // with the exact number the moment it is opened (see appBadge.ts).
      try {
        if (self.navigator && "setAppBadge" in self.navigator) {
          const outstanding = await self.registration.getNotifications();
          await self.navigator.setAppBadge(Math.max(outstanding.length, 1));
        }
      } catch {
        // Badging is decoration; never let it cost us the notification.
      }
    })(),
  );
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
