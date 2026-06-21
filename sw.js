// ═══════════════════════════════════════════════════════════════════════════
// Virowatch / Anikoto Service Worker
// Fixed: Proper error handling for CORS proxy requests
// ═══════════════════════════════════════════════════════════════════════════

const CACHE_NAME    = 'virowatch-v1';
const API_CACHE     = 'virowatch-api-v1';
const STATIC_ASSETS = [
  './',
  'Virowatch_0_40_0.html',
  'virostyle.css',
  'virostyle-light.css',
  'virostyle2.css',
  'virostyle2-light.css',
  'content.js',
  'anikoto-loader.js',
  'streambroadcast-live.js',
];

// ── Install: pre-cache static assets ────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(STATIC_ASSETS).catch(() => {}))
      .then(() => self.skipWaiting())
  );
});

// ── Activate: clean old caches ──────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys
          .filter(key => key !== CACHE_NAME && key !== API_CACHE)
          .map(key => caches.delete(key))
      ))
      .then(() => self.clients.claim())
  );
});

// ── Fetch: smart routing with error handling ────────────────────────
self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url     = new URL(request.url);

  // Only handle GET requests
  if (request.method !== 'GET') return;

  // ── Same-origin requests: network-first with cache fallback ──────
  if (url.origin === self.location.origin) {
    event.respondWith(
      fetch(request)
        .then(response => {
          if (response.ok) {
            const clone = response.clone();
            caches.open(CACHE_NAME)
              .then(cache => cache.put(request, clone))
              .catch(() => {});
          }
          return response;
        })
        .catch(() => {
          return caches.match(request)
            .then(cached => cached || new Response('Offline', {
              status: 503,
              headers: { 'Content-Type': 'text/plain' }
            }));
        })
    );
    return;
  }

  // ── Cross-origin requests (CORS proxies, APIs, embeds) ───────────
  // Try network → cache → graceful failure
  // CRITICAL: All fetches are wrapped in try/catch to prevent
  // "Uncaught (in promise) TypeError: Failed to fetch" errors
  event.respondWith(
    (async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          // Cache successful API responses (not embed iframes)
          if (request.headers.get('accept')?.includes('application/json') ||
              url.href.includes('allorigins') ||
              url.href.includes('codetabs') ||
              url.href.includes('corsproxy') ||
              url.href.includes('anikotoapi')) {
            const clone = response.clone();
            caches.open(API_CACHE)
              .then(cache => cache.put(request, clone))
              .catch(() => {});
          }
        }
        return response;
      } catch (err) {
        // Network/CORS error — try cache
        console.log(`Anikoto SW: network failed for ${url.href}, trying cache...`);
        const cached = await caches.match(request);
        if (cached) {
          console.log(`Anikoto SW: returning cached response for ${url.href}`);
          return cached;
        }
        // No cache — return error response instead of throwing
        console.log(`Anikoto SW: no cache available for ${url.href}`);
        return new Response(JSON.stringify({ error: 'Network unavailable' }), {
          status: 503,
          headers: { 'Content-Type': 'application/json' }
        });
      }
    })()
  );
});
