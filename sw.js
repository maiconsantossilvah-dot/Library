const CACHE_NAME = "vault-shell-v4";
const APP_SHELL = [
  "./",
  "./index.html",
  "./style.css",
  "./layout.css",
  "./theme.css",
  "./app.js",
  "./modules/async-queue.js",
  "./modules/file-hash.js",
  "./modules/page-order.js",
  "./modules/local-text-search.js",
  "./modules/photo-metadata.js",
  "./manifest.webmanifest",
  "./icons/vault-icon.svg",
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(APP_SHELL)));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(key => key.startsWith("vault-shell-") && key !== CACHE_NAME).map(key => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", event => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then(cached => cached || fetch(event.request).then(response => {
      if (response.ok && url.pathname.startsWith(self.registration.scope.replace(self.location.origin, ""))) {
        const copy = response.clone();
        caches.open(CACHE_NAME).then(cache => cache.put(event.request, copy));
      }
      return response;
    }))
  );
});
