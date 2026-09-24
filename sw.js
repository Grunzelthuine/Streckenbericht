/* Service Worker – Jagd Thuine (JG Thuine)
 * Bei jeder Änderung an App-Dateien VERSION erhöhen → Nutzer bekommen den Hinweis „Neue Version“.
 */
const VERSION = 'sb-2.8.0';
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'icons/logo.png', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js',
];

self.addEventListener('install', e => {
  // cache: 'reload' → immer frisch vom Server holen, nicht aus dem Browser-Cache
  // (sonst landet die alte Version im neuen Cache)
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // GitHub-API & KI nie cachen
  if (url.pathname.endsWith('/data/strecke.json')) {
    // Daten: immer Netz, offline letzter Stand
    e.respondWith(fetch(e.request).then(r => {
      const copy = r.clone(); caches.open(VERSION).then(c => c.put('data/strecke.json', copy)); return r;
    }).catch(() => caches.match('data/strecke.json')));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});
