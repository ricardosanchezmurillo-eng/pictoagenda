// PictoAgenda: funciona sin conexión con lo ya visto
const SHELL = 'pa-shell-v4', IMGS = 'pa-img', APIC = 'pa-api';
const FILES = ['./', './index.html', './manifest.json', './icon-192.png', './icon-512.png'];
self.addEventListener('install', e => e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener('activate', e => e.waitUntil(
  caches.keys().then(ks => Promise.all(ks.filter(k => ![SHELL, IMGS, APIC].includes(k)).map(k => caches.delete(k)))).then(() => self.clients.claim())));
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.hostname === 'static.arasaac.org') {            // pictogramas: primero caché
    e.respondWith(caches.open(IMGS).then(async c => {
      const m = await c.match(req); if (m) return m;
      const r = await fetch(req); if (r.ok || r.type === 'opaque') c.put(req, r.clone()); return r;
    })); return;
  }
  if (u.hostname === 'api.arasaac.org') {               // búsquedas: primero red
    e.respondWith(fetch(req).then(r => { if (r.ok) { const cl = r.clone(); caches.open(APIC).then(c => c.put(req, cl)); } return r; })
      .catch(() => caches.match(req))); return;
  }
  if (u.origin === location.origin) {                   // la app: primero red, si no hay, caché
    e.respondWith(fetch(req).then(r => { const cl = r.clone(); caches.open(SHELL).then(c => c.put(req, cl)); return r; })
      .catch(() => caches.match(req).then(m => m || caches.match('./index.html'))));
  }
});
