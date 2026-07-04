// Legacy service worker killer: the old static Equo site registered a
// PWA service worker at this URL. This replacement unregisters itself,
// clears every cache it left behind, and reloads open clients so they
// fetch the current SPA from the network.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
      await self.registration.unregister();
      const clients = await self.clients.matchAll({ type: "window" });
      clients.forEach((client) => client.navigate(client.url));
    })(),
  );
});
