const CACHE_NAME = "loose-change-shell-v1";
const OFFLINE_URL = "/offline";
const PRECACHE_URLS = [OFFLINE_URL, "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(PRECACHE_URLS)).then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// Navigations: network-first so the app always gets the latest shell when online,
// falling back to the offline page only when the network request fails entirely.
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.mode !== "navigate") return;

  event.respondWith(
    fetch(request).catch(() => caches.match(OFFLINE_URL).then((res) => res || Response.error())),
  );
});

// Reminder pushes carry a JSON payload ({ title, body }) — see convex/push.ts.
self.addEventListener("push", (event) => {
  if (!event.data) return;
  const { title, body } = event.data.json();
  event.waitUntil(self.registration.showNotification(title, { body, icon: "/icons/icon-192.png" }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("/search"));
});
