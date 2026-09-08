const CACHE = "pulse-shell-v3";

const SHELL = [
  "/",
  "/index.html",
  "/css/base.css",
  "/css/join.css",
  "/css/chat.css",
  "/js/main.js",
  "/js/socket.js",
  "/js/ui.js",
  "/js/chat.js",
  "/js/call.js",
  "/js/session.js",
  "/js/background.js",
  "/js/tilt.js",
  "/js/awake.js",
  "/js/diagnostics.js",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting())
      .catch(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/socket.io/")) return;
  if (url.pathname.startsWith("/uploads/")) return;
  if (url.pathname === "/healthz" || url.pathname === "/ice-config") return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request).then((cached) => cached || caches.match("/index.html"))
      )
  );
});
