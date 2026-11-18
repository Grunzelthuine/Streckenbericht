/* Service Worker – Jagd Thuine (JG Thuine)
 * Bei jeder Änderung an App-Dateien VERSION erhöhen → Nutzer bekommen den Hinweis „Neue Version“.
 * Push: zeigt Benachrichtigungen des Konten-Servers und zählt sie am App-Symbol.
 */
importScripts('config.js');
const CONF = self.JAGD_CFG || {};
const PRE = CONF.lsPrefix || '';           // Test-Umgebung: eigene Cache-Namen
const VERSION = PRE + 'sb-2.25.6';
const BADGE = PRE + 'sb-badge';
const SHELL = [
  './', 'index.html', 'style.css', 'app.js', 'config.js', 'konto.js', 'manifest.webmanifest',
  'icons/logo.png', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png',
  'vendor/jspdf.umd.min.js', 'vendor/jspdf.plugin.autotable.min.js', 'vendor/pdf.min.js', 'vendor/pdf.worker.min.js',
];

self.addEventListener('install', e => {
  // cache: 'reload' → immer frisch vom Server holen, nicht aus dem Browser-Cache
  // (sonst landet die alte Version im neuen Cache)
  e.waitUntil(caches.open(VERSION).then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  // nur eigene alte Caches löschen (andere Apps unter derselben Adresse nicht anfassen)
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith(PRE + 'sb-') && k !== VERSION && k !== BADGE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', e => {
  if (e.data === 'skipWaiting') self.skipWaiting();
  if (e.data === 'badge0') setBadge(0);
});

self.addEventListener('fetch', e => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return; // GitHub-API, Konten-Server & KI nie cachen
  const datei = ['strecke.json', 'jagdzeiten.json'].find(f => url.pathname.endsWith('/data/' + f));
  if (datei) {
    // Daten: immer Netz, offline letzter Stand
    e.respondWith(fetch(e.request).then(r => {
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then(c => c.put('data/' + datei, copy)); }
      return r;
    }).catch(() => caches.match('data/' + datei)));
    return;
  }
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then(hit => hit || fetch(e.request)));
});

/* ---------- Push ---------- */
async function getBadge() { try { const r = await (await caches.open(BADGE)).match('n'); return r ? Number(await r.text()) || 0 : 0; } catch { return 0; } }
/* Zähler merken; die Zahl am Symbol setzt nur das Push-Ereignis (Löschen übernimmt die App beim Öffnen) */
async function setBadge(n) {
  try { await (await caches.open(BADGE)).put('n', new Response(String(n))); } catch { /* egal */ }
  try { if (n > 0 && 'setAppBadge' in self.navigator) await self.navigator.setAppBadge(n); } catch { /* egal */ }
}
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil((async () => {
    await setBadge((await getBadge()) + 1);
    await self.registration.showNotification(d.title || 'Jagd Thuine', {
      body: d.body || '', tag: d.tag || undefined, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
      data: { url: d.url || self.registration.scope }, lang: 'de',
    });
  })());
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const c = all.find(x => x.url.startsWith(self.registration.scope));
    if (c) return c.focus();
    return self.clients.openWindow(e.notification.data?.url || self.registration.scope);
  })());
});
