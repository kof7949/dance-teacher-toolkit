const CACHE_NAME = 'dance-toolkit-v53';
const ASSETS = [
  './',
  './index.html',
  './manifest.json',
  './css/styles.css',
  './js/lock.js',
  './js/vendor/jspdf.umd.min.js',
  './js/db.js',
  './js/seed.js',
  './js/music.js',
  './js/progress.js',
  './js/formation.js',
  './js/metronome.js',
  './js/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Cache each asset individually rather than cache.addAll(), which aborts the *entire*
      // precache the moment a single request fails (e.g. one dropped packet on a flaky
      // connection) -- that would otherwise leave the app with no offline cache at all.
      return Promise.all(ASSETS.map((url) => cache.add(url).catch((err) => {
        console.warn('[sw] failed to precache', url, err);
      })));
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  // Large media (e.g. the Rhythm Example video) is never precached and would otherwise get
  // opportunistically cached-then-wiped every time CACHE_NAME bumps (which happens on every
  // deploy). Let the browser's own HTTP cache handle it instead, independent of app updates.
  if (event.request.url.includes('/videos/')) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) return cached;
      return fetch(event.request).then((response) => {
        if (response.ok && response.type === 'basic') {
          const clone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, clone));
        }
        return response;
      }).catch(() => {
        // Offline and this exact request was never cached -- e.g. a navigation URL that
        // differs slightly from the precached './' / './index.html' entries (trailing
        // slash, query string, etc). Fall back to the cached app shell instead of letting
        // the browser show its own native offline page, so the app still opens offline.
        if (event.request.mode === 'navigate') {
          return caches.match('./index.html').then((shell) => shell || cached);
        }
        return cached;
      });
    })
  );
});
