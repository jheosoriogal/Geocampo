// GeoCampo — service worker: app disponible sin internet y caché de mosaicos ya vistos
const APP = 'geocampo2-app-v2';
const TILES = 'geocampo2-tiles-v1';
const MAX_TILES = 4000;
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png', './apple-touch-icon.png',
  './vendor/leaflet.js', './vendor/leaflet.css', './vendor/proj4.js', './vendor/jszip.min.js', './vendor/capacitor.js',
  './vendor/turf.min.js', './vendor/piexif.js', './vendor/shp.min.js', './vendor/shpwrite.js', './vendor/jspdf.umd.min.js',
  './vendor/geotiff.js', './vendor/pdf.min.js', './vendor/pdf.worker.min.js', './vendor/images/layers.png', './vendor/images/layers-2x.png',
  './js/app.js', './js/offline.js', './js/photos.js', './js/nav.js', './js/edit.js', './js/georef.js', './js/report.js', './js/main.js'];
const TILE_HOSTS = ['arcgisonline.com', 'tile.openstreetmap.org', 'tile.opentopomap.org'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(APP).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== APP && k !== TILES).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
let trimming = false;
async function trimTiles() {
  if (trimming) return; trimming = true;
  try { const c = await caches.open(TILES); const ks = await c.keys(); for (let i = 0; i < ks.length - MAX_TILES; i++) await c.delete(ks[i]); }
  finally { trimming = false; }
}
self.addEventListener('fetch', e => {
  const req = e.request; if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (TILE_HOSTS.some(h => url.hostname.endsWith(h))) {
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(req); if (hit) return hit;
      try { const res = await fetch(req); if (res.ok) { c.put(req, res.clone()); if (Math.random() < 0.02) trimTiles(); } return res; }
      catch (err) { return new Response('', {status: 504}); }
    }));
    return;
  }
  if (url.origin === location.origin) {
    // Red primero (para recibir actualizaciones), caché si no hay señal
    e.respondWith(fetch(req).then(res => { if (res.ok) caches.open(APP).then(c => c.put(req, res.clone())); return res; })
      .catch(() => caches.match(req, {ignoreSearch: true}).then(r => r || caches.match('./index.html'))));
  }
});
