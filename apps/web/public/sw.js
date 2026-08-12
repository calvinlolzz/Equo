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
        // Only store a real asset. A chunk whose hash is gone after a deploy
        // does not come back as a clean miss: the SPA rewrite used to answer
        // with index.html and a 200, and caching THAT under a .js filename
        // would pin "this chunk is HTML" for as long as the cache lives.
        // (vercel.json now excludes /assets/ from that rewrite, so it 404s
        // instead — this check also covers the 404, and covers workers still
        // running against an older deployment.)
        const type = response.headers.get("content-type") || "";
        if (response.ok && !type.includes("text/html")) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)).catch(() => {});
        }
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
// { title, body, url, tag, actions? }. Anything unreadable still produces a
// notification — on Chrome, a push event that ends without showNotification()
// gets the browser's own "This site has been updated in the background" instead,
// which is worse than a generic line of our own.
self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = {};
  }

  // Action buttons, each carrying its own destination. showNotification only
  // accepts {action, title}, so the urls ride along in `data` and are read back
  // on click. Capped at the platform's own limit (2 on Android, 0 where actions
  // aren't supported at all — an over-long list is silently truncated, and the
  // urls of the dropped ones would just be dead entries in `data`).
  const declared = Array.isArray(payload.actions) ? payload.actions.filter((a) => a && a.action && a.url) : [];
  const maxActions = typeof Notification !== "undefined" && Notification.maxActions >= 0 ? Notification.maxActions : 2;
  const actions = declared.slice(0, maxActions);

  const actionUrls = {};
  for (const entry of actions) actionUrls[entry.action] = entry.url;

  const title = payload.title || "Equo";
  const options = {
    body: payload.body || "群組有新的記錄",
    tag: payload.tag || "equo",
    // Same tag replaces the previous notification rather than stacking; renotify
    // still buzzes, so a second expense is not silently swallowed.
    renotify: Boolean(payload.tag),
    icon: "/icons/equo-icon-192.png",
    badge: "/icons/equo-icon-192.png",
    actions: actions.map((entry) => ({ action: entry.action, title: entry.title })),
    data: { url: payload.url || "/", actionUrls },
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
  const data = event.notification.data || {};
  // An action button goes where the button says; the body goes where the
  // notification says. An unknown action id (a notification shown by an older
  // worker, then clicked after an update) falls back to the body's target
  // rather than dropping the tap on the floor.
  const target = (event.action && data.actionUrls && data.actionUrls[event.action]) || data.url || "/";
  const targetUrl = new URL(target, self.location.origin);

  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });

      for (const client of windows) {
        const clientUrl = new URL(client.url);
        // Search as well as path: an action target differs from the body's only
        // by its ?shortcut=, and a window already sitting on the bare group is
        // NOT where "記一筆" was asking to go. Matching on pathname alone would
        // focus that window and never open the composer.
        if (clientUrl.pathname === targetUrl.pathname && clientUrl.search === targetUrl.search) {
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
