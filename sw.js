// Twenty-Eight (28) Royal Casino - Service Worker
const CACHE_NAME = 'twentyeight-v4.0.2';

const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/icon.svg',
  // Stylesheets
  '/src/styles/main.css',
  '/src/styles/tokens.css',
  '/src/styles/base.css',
  '/src/styles/table.css',
  '/src/styles/cards.css',
  '/src/styles/hud.css',
  '/src/styles/modal.css',
  '/src/styles/mobile.css',
  // ES Modules
  '/src/main.js',
  '/src/engine/TwentyEightEngine.js',
  '/src/engine/InferenceMatrix.js',
  '/src/engine/ISMCTS.js',
  '/src/dds/TwentyEightDDS.js',
  '/src/dds/dds.worker.js',
  '/src/dds/telemetry.js',
  '/src/net/PeerManager.js',
  '/src/net/BackendAPI.js',
  '/src/net/session.js',
  '/src/net/network.js',
  '/src/ui/RenderQueue.js',
  '/src/ui/UIController.js',
  '/src/ui/AudioHaptics.js',
  '/src/ui/TacticalModal.js',
  '/src/ui/stats.js',
  '/src/ui/settings.js',
  '/src/ui/i18n.js',
  // CDN Dependencies
  'https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;900&family=Plus+Jakarta+Sans:wght@400;600;700;800&display=swap',
  'https://unpkg.com/peerjs@1.5.4/dist/peerjs.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js',
  'https://cdnjs.cloudflare.com/ajax/libs/gsap/3.12.5/gsap.min.js',
  'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js',
  'https://unpkg.com/lucide@latest/dist/umd/lucide.js',
  'https://cdnjs.cloudflare.com/ajax/libs/vanilla-tilt/1.8.1/vanilla-tilt.min.js'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(STATIC_ASSETS).catch((err) => {
        console.warn('Non-blocking cache error during sw install:', err);
      });
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('Purging old SW cache:', key);
            return caches.delete(key);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Let serverless backend API requests pass directly
  if (event.request.url.includes('/api/')) {
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }

  // HTML Navigation: Network-first to guarantee latest game version
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200) {
            const clone = networkResponse.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
          }
          return networkResponse;
        })
        .catch(() => caches.match(event.request) || caches.match('/index.html'))
    );
    return;
  }

  // Static Assets & ES Modules: Stale-While-Revalidate with Cache-First Fallback
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      const fetchPromise = fetch(event.request).then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const clone = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return networkResponse;
      }).catch(() => cachedResponse);

      return cachedResponse || fetchPromise;
    })
  );
});
