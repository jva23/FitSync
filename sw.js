// Cache-first app shell. No server data to be network-first for — everything
// lives in IndexedDB on-device. Bump CACHE_VERSION on every deploy.
const CACHE_VERSION = "v8";
const CACHE_NAME = `fitsync-shell-${CACHE_VERSION}`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./css/app.css",
  "./js/app.js",
  "./js/db.js",
  "./js/state.js",
  "./js/utils.js",
  "./js/icons.js",
  "./js/toast.js",
  "./js/seed/exercises.js",
  "./js/views/today.js",
  "./js/views/plan.js",
  "./js/views/meals.js",
  "./js/views/progress.js",
  "./js/views/coach.js",
  "./js/views/settings.js",
  "./js/views/exercises.js",
  "./js/views/onboarding.js",
  "./js/views/workout-log.js",
  "./js/views/review.js",
  "./js/views/ai-events.js",
  "./js/views/recipes.js",
  "./js/views/recipe-detail.js",
  "./js/charts.js",
  "./js/ai.js",
  "./js/ai-snapshot.js",
  "./js/ai-actions.js",
  "./js/ai-preview.js",
  "./js/nudges.js",
  "./js/recipe-export.js",
  "./js/recipe-form.js",
  "./js/recipe-intake.js",
  "./js/ai-recipes.js",
  "./js/aisle.js",
  "./js/grocery.js",
  "./js/grocery-ui.js",
  "./js/meal-plan-helpers.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-192.png",
  "./icons/icon-maskable-512.png",
];

// Best-effort — CDN dependencies. Cached individually so a single failure
// (e.g. offline install) doesn't abort the whole precache.
const CDN_ASSETS = [
  "https://cdn.jsdelivr.net/npm/idb@8/+esm",
  "https://cdn.jsdelivr.net/npm/chart.js@4/auto/+esm",
  "https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;500;600;700&display=swap",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(APP_SHELL);
      await Promise.all(
        CDN_ASSETS.map((url) =>
          fetch(url, { mode: "cors" })
            .then((res) => (res.ok ? cache.put(url, res) : null))
            .catch(() => null)
        )
      );
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

self.addEventListener("message", (event) => {
  if (event.data?.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(
    (async () => {
      const clientsList = await self.clients.matchAll({ type: "window" });
      if (clientsList.length > 0) {
        await clientsList[0].focus();
        return;
      }
      await self.clients.openWindow("./");
    })()
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;

  event.respondWith(
    (async () => {
      const cached = await caches.match(event.request);
      if (cached) return cached;
      try {
        const response = await fetch(event.request);
        if (response.ok && event.request.url.startsWith(self.location.origin)) {
          const cache = await caches.open(CACHE_NAME);
          cache.put(event.request, response.clone());
        }
        return response;
      } catch (err) {
        if (event.request.mode === "navigate") {
          return caches.match("./index.html");
        }
        throw err;
      }
    })()
  );
});
