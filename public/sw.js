// Bumped whenever the caching strategy changes — activate() drops every other
// cache, which also evicts anything a previous version stored incorrectly.
const CACHE_NAME = "loose-change-shell-v2";
const OFFLINE_URL = "/offline";
const SHELL_URL = "/";

// Only genuinely public routes belong here. A Clerk-protected route would
// follow the sign-in redirect during install (the service worker registers on
// /sign-in too) and get cached as a sign-in page under its own key, for the
// life of this cache. /offline is public via proxy.ts's isPublicRoute; "/" is
// not, so it's cached at runtime instead — see below.
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

// A response is only worth storing if it's the real thing. `redirected` catches
// the Clerk sign-in bounce, which is a 200 by the time it reaches us.
const isCacheable = (response) => response && response.ok && !response.redirected;

// Content-hashed build assets — immutable, so cache-first is always correct.
// Caching these is what makes an offline cold start actually hydrate rather
// than serving cached HTML that can't boot.
async function handleStaticAsset(request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isCacheable(response)) {
    const cache = await caches.open(CACHE_NAME);
    void cache.put(request, response.clone());
  }
  return response;
}

// Record is the one screen that must survive no signal: capture writes to
// IndexedDB first and syncs later, so the app is genuinely useful offline —
// but only if its shell is on the device. Network-first keeps it fresh when
// online, and the cached copy is what a cold offline start falls back to.
async function handleShellNavigation(request) {
  try {
    const response = await fetch(request);
    if (isCacheable(response)) {
      const cache = await caches.open(CACHE_NAME);
      void cache.put(SHELL_URL, response.clone());
    }
    return response;
  } catch {
    return (await caches.match(SHELL_URL)) ?? (await caches.match(OFFLINE_URL)) ?? Response.error();
  }
}

// Every other route needs the network for its data anyway, so there's nothing
// useful to show from cache — the offline page explains that.
async function handleOtherNavigation(request) {
  try {
    return await fetch(request);
  } catch {
    return (await caches.match(OFFLINE_URL)) ?? Response.error();
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(handleStaticAsset(request));
    return;
  }

  if (request.mode !== "navigate") return;

  event.respondWith(
    url.pathname === SHELL_URL ? handleShellNavigation(request) : handleOtherNavigation(request),
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
