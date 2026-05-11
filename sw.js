const CACHE_NAME = "hasinah-shell-disabled-v1";
const SHELL_FILES = [];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.delete(CACHE_NAME));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
