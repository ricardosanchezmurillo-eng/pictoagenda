// PictoAgenda: funciona sin conexión con lo ya visto
const SHELL = 'pa-shell-v5', IMGS = 'pa-img', APIC = 'pa-api', FONTS = 'pa-fonts';
const FILES = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => ![SHELL, IMGS, APIC, FONTS].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim())));
const cacheFirst = (name, req) => caches.open(name).then(async c => {
  const m = await c.match(req); if (m) return m;
  const r = await fetch(req); if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r;
});
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin === location.origin && u.pathname.startsWith('/api/')) return;          // sincronización: siempre a la red
  if (u.hostname === 'static.arasaac.org') { e.respondWith(cacheFirst(IMGS, req)); return; }
  if (u.hostname === 'fonts.googleapis.com' || u.hostname === 'fonts.gstatic.com') { e.respondWith(cacheFirst(FONTS, req)); return; }
  if (u.hostname === 'api.arasaac.org') {
    e.respondWith(fetch(req).then(r => { if (r.ok) { const cl = r.clone(); caches.open(APIC).then(c => c.put(req, cl)); } return r; })
      .catch(() => caches.match(req))); return;
  }
  if (u.origin === location.origin) {
    e.respondWith(fetch(req).then(r => { const cl = r.clone(); caches.open(SHELL).then(c => c.put(req, cl)); return r; })
      .catch(() => caches.match(req).then(m => m || caches.match('./index.html'))));
  }
});
