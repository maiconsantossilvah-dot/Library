const CACHE_NAME = "vault-shell-__VERSION__";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/vault-icon.svg",
  ...__ASSETS__,
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
  event.respondWith(
    caches
      .open(CACHE_NAME)
      .then(async (cache) => (await cache.match(request)) || fetch(request)),
  );
});
