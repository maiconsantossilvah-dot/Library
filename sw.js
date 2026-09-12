// These concrete defaults also run when GitHub Pages serves the repository root.
// The optional build replaces only these two declarations with hashed assets.
const CACHE_NAME = "vault-shell-source-v7";
const SOURCE_ASSETS = [
  "./app.js",
  "./privacy-init.js",
  "./modules/privacy.js",
  "./modules/video-scenes.js",
  "./styles.css",
  "./vendor/lucide.js",
  "./modules/async-queue.js",
  "./modules/board-model.js",
  "./modules/file-hash.js",
  "./modules/folder-covers.js",
  "./modules/google-drive.js",
  "./modules/icons.js",
  "./modules/interface.js",
  "./modules/legacy-import.js",
  "./modules/local-store.js",
  "./modules/local-text-search.js",
  "./modules/mural.js",
  "./modules/page-order.js",
  "./modules/photo-metadata.js",
  "./modules/pwa.js",
];
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/vault-icon.svg",
  ...SOURCE_ASSETS,
];
self.addEventListener("install", (event) =>
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)),
  ),
);
self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") self.skipWaiting();
});
self.addEventListener("activate", (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("vault-shell-") && k !== CACHE_NAME)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => self.clients.claim()),
  ),
);
self.addEventListener("fetch", (event) => {
  const request = event.request,
    url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request).catch(() =>
        caches.open(CACHE_NAME).then((c) => c.match("./index.html")),
      ),
    );
    return;
  }
  if (
    !APP_SHELL.some(
      (p) => new URL(p, self.registration.scope).href === url.href,
    )
  )
    return;
  // Source filenames are stable, unlike the optional build's hashed assets.
  // Prefer the network so an installed worker cannot pin old source code.
  if (CACHE_NAME.startsWith("vault-shell-source-")) {
    event.respondWith(
      caches.open(CACHE_NAME).then(async (cache) => {
        try {
          const response = await fetch(request);
          if (response.ok) await cache.put(request, response.clone());
          return response;
        } catch (error) {
          const cached = await cache.match(request);
          if (cached) return cached;
          throw error;
        }
      }),
    );
    return;
  }
  event.respondWith(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => (await cache.match(request)) || fetch(request)),
  );
});
