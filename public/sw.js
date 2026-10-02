// Small service worker: lets the app install to the home screen and keeps
// the app files and stroke data on the device so they load fast.
// Notes, quizzes and AI features still need an internet connection.
const CACHE = "kotobachou-v1";

self.addEventListener("install", function () {
  self.skipWaiting();
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys()
      .then(function (names) {
        return Promise.all(names.filter(function (n) { return n !== CACHE; }).map(function (n) { return caches.delete(n); }));
      })
      .then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // never touch Supabase or other sites
  if (url.pathname.indexOf("/.netlify/") === 0) return; // never cache the AI function

  // Stroke data and built files never change under the same name: serve from cache first.
  if (url.pathname.indexOf("/strokes/") === 0 || url.pathname.indexOf("/assets/") === 0) {
    event.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then(function (c) { c.put(req, copy); });
          }
          return res;
        });
      })
    );
    return;
  }

  // Pages: always try the network first so a new version shows up straight away.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then(function (res) {
          const copy = res.clone();
          caches.open(CACHE).then(function (c) { c.put("/", copy); });
          return res;
        })
        .catch(function () { return caches.match("/"); })
    );
  }
});
