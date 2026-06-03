/**
 * sw.js  —  Virowatch Service Worker  v1.0
 *
 * Strategy: Network-first with Cache API fallback for Anikoto API pages.
 *
 * What this does:
 * - Intercepts every fetch to anikotoapi.site (via any proxy) and caches
 * the successful response in the Cache API (50MB+ quota, separate from localStorage).
 * - On subsequent visits the cached response is returned immediately while a
 * background revalidation request goes out — this is "stale-while-revalidate".
 * - After CACHE_MAX_AGE (24h) the SW forces a fresh network fetch so data
 * never goes too stale.
 * - All other requests (your CSS, JS, HTML assets) are NOT touched — this
 * SW is Anikoto-only to keep it simple and safe.
 *
 * Deployment:
 * 1. Drop sw.js into your repo root (same directory as your HTML file).
 * 2. The anikoto-loader.js v4.0 registers it automatically on DOMContentLoaded.
 * 3. That's it — no build step, no bundler, static-site friendly.
 */

const ANIKOTO_CACHE   = "anikoto-api-v1";   // must match SW_CACHE_NAME in anikoto-loader.js
const CACHE_MAX_AGE   = 24 * 60 * 60 * 1000; // 24 hours in ms
const ANIKOTO_HOST    = "anikotoapi.site";

// ── Proxy hostnames whose requests carry Anikoto API URLs ─────────────────
// We cache the *proxy* responses (which contain the Anikoto JSON) because
// that's what the browser actually fetches.
const PROXY_HOSTS = [
  "api.allorigins.win",
  "api.codetabs.com",
  "thingproxy.freeboard.io",
  "corsproxy.io",
];

// ── Install: claim clients immediately, no pre-caching needed ────────────
self.addEventListener("install", event => {
  self.skipWaiting();
});

self.addEventListener("activate", event => {
  // Clean up any old cache versions
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k.startsWith("anikoto-api-") && k !== ANIKOTO_CACHE)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Helper: is this request one we should cache? ─────────────────────────
function isAnikotoRequest(request) {
  try {
    const url = new URL(request.url);

    // Direct request to the API (unlikely due to CORS, but handle it)
    if (url.hostname === ANIKOTO_HOST) return true;

    // Proxy request carrying an Anikoto URL
    if (PROXY_HOSTS.includes(url.hostname)) {
      const proxied = decodeURIComponent(
        url.searchParams.get("url") ||
        url.searchParams.get("quest") ||
        url.pathname.replace(/^\/fetch\//, "")
      );
      return proxied.includes(ANIKOTO_HOST);
    }
  } catch (_) {}
  return false;
}

// ── Helper: check if a cached response is still fresh ────────────────────
function isFresh(response) {
  if (!response) return false;
  const dateHeader = response.headers.get("sw-cached-at");
  if (!dateHeader) return false;
  return (Date.now() - parseInt(dateHeader, 10)) < CACHE_MAX_AGE;
}

// ── Helper: clone a response and tag it with a cache timestamp ───────────
// We can't mutate the original response headers, so we rebuild it.
async function tagAndStore(cache, request, response) {
  if (!response || !response.ok) return;
  const body    = await response.clone().arrayBuffer();
  const headers = new Headers(response.headers);
  headers.set("sw-cached-at", String(Date.now()));
  const tagged = new Response(body, {
    status     : response.status,
    statusText : response.statusText,
    headers,
  });
  await cache.put(request, tagged);
}

// ── Fetch handler: stale-while-revalidate for Anikoto requests ───────────
self.addEventListener("fetch", event => {
  if (!isAnikotoRequest(event.request)) return; // pass through everything else

  event.respondWith(
    caches.open(ANIKOTO_CACHE).then(async cache => {
      const cached = await cache.match(event.request);

      if (cached && isFresh(cached)) {
        // Fresh hit — respond immediately, revalidate quietly in the background
        event.waitUntil(
          fetch(event.request.clone())
            .then(fresh => tagAndStore(cache, event.request.clone(), fresh))
            .catch(() => {}) // ignore bg revalidation failures
        );
        return cached;
      }

      // No cache or stale — go to network, cache the result, return it
      try {
        const fresh = await fetch(event.request.clone());
        if (fresh && fresh.ok) {
          // Store without blocking the response
          event.waitUntil(tagAndStore(cache, event.request.clone(), fresh.clone()));
        }
        return fresh;
      } catch (networkErr) {
        // Network failed — return stale cache if we have it (better than nothing)
        if (cached) {
          console.warn("Anikoto SW: offline, returning stale cache for", event.request.url);
          return cached;
        }
        throw networkErr;
      }
    })
  );
});

// ── Message handler: manual cache clear from devtools or the app ─────────
// Usage: navigator.serviceWorker.controller.postMessage({ type: "CLEAR_ANIKOTO_CACHE" })
self.addEventListener("message", event => {
  if (event.data?.type === "CLEAR_ANIKOTO_CACHE") {
    caches.delete(ANIKOTO_CACHE).then(() => {
      event.source?.postMessage({ type: "ANIKOTO_CACHE_CLEARED" });
    });
  }
});