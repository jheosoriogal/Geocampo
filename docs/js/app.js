'use strict';
/* =====================================================================
   GeoCampo — captura de puntos, tracks y polígonos en campo
   ===================================================================== */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&#39;','"':'&quot;'}[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const fmt = (n, d = 2) => Number(n).toLocaleString('es-CO', {minimumFractionDigits: d, maximumFractionDigits: d});
const fmtLen = m => m >= 1000 ? fmt(m / 1000, 3) + ' km' : fmt(m, 1) + ' m';
const TYPE = {point: 'Punto', line: 'Track / línea', polygon: 'Polígono'};
/* ---------- App nativa (APK con Capacitor) o web ---------- */
const CAPX = window.capacitorExports;
const CAP = !!(CAPX && CAPX.Capacitor && CAPX.Capacitor.isNativePlatform());
const plug = n => CAP ? CAPX.registerPlugin(n) : null;
const BG = plug('BackgroundGeolocation'), FS = plug('Filesystem'), SH = plug('Share'), APPN = plug('App');
const LN = plug('LocalNotifications');
let notifAsked = false;
async function askNotif() { if (!CAP || notifAsked) return; notifAsked = true; try { await LN.requestPermissions(); } catch (e) {} }
const PALETTE = ['#e8590c', '#2b6cb0', '#d69e2e', '#805ad5', '#319795', '#c53030', '#38a169', '#dd6b20', '#3182ce', '#b83280'];

/* ---------- Sistemas de coordenadas ---------- */
proj4.defs('EPSG:9377', '+proj=tmerc +lat_0=4 +lon_0=-73 +k=0.9992 +x_0=5000000 +y_0=2000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
proj4.defs('EPSG:3116', '+proj=tmerc +lat_0=4.596200416666666 +lon_0=-74.07750791666666 +k=1 +x_0=1000000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs');
[['3114', -80.07750791666666], ['3115', -77.07750791666666], ['3117', -71.07750791666666], ['3118', -68.07750791666666]].forEach(([c, lon]) => proj4.defs('EPSG:' + c, `+proj=tmerc +lat_0=4.596200416666666 +lon_0=${lon} +k=1 +x_0=1000000 +y_0=1000000 +ellps=GRS80 +towgs84=0,0,0,0,0,0,0 +units=m +no_defs`));
[17, 18, 19].forEach(z => proj4.defs('EPSG:326' + z, `+proj=utm +zone=${z} +datum=WGS84 +units=m +no_defs`));
proj4.defs('EPSG:4686', proj4.defs('EPSG:4326'));
const CRS = {'EPSG:4326': 'WGS84 — latitud / longitud (grados)', 'EPSG:9377': 'MAGNA-SIRGAS Origen Nacional (9377)', 'EPSG:3116': 'MAGNA-SIRGAS Colombia Bogotá (3116)'};
function toCTM(lat, lon) { const [e, n] = proj4('EPSG:4326', 'EPSG:9377', [lon, lat]); return {e, n}; }
function dms(v, pos, neg) {
  const s = v < 0 ? neg : pos; v = Math.abs(v);
  let d = Math.floor(v), m = Math.floor((v - d) * 60), sec = ((v - d) * 60 - m) * 60;
  if (sec >= 59.995) { sec = 0; m++; } if (m >= 60) { m = 0; d++; }
  return `${d}°${String(m).padStart(2, '0')}'${sec.toFixed(2).padStart(5, '0')}"${s}`;
}

/* ---------- Geometría (área geodésica precisa con proyección local) ---------- */
function distM(a, b) {
  const R = 6371008.8, r = Math.PI / 180;
  const dLat = (b[0] - a[0]) * r, dLon = (b[1] - a[1]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
function lengthM(c) { let s = 0; for (let i = 1; i < c.length; i++) s += distM(c[i - 1], c[i]); return s; }
function perimM(c) { return c.length < 3 ? lengthM(c) : lengthM(c) + distM(c[c.length - 1], c[0]); }
function fArea(f) { return f.type !== 'polygon' ? 0 : Math.max(0, areaM2(f.coords) - (f.holes || []).reduce((s, h) => s + areaM2(h), 0)); }
function fPerim(f) { return perimM(f.coords) + (f.holes || []).reduce((s, h) => s + perimM(h), 0); }
function areaM2(c) {
  if (c.length < 3) return 0;
  let la = 0, lo = 0; c.forEach(p => { la += p[0]; lo += p[1]; }); la /= c.length; lo /= c.length;
  const P = proj4('EPSG:4326', `+proj=tmerc +lat_0=${la} +lon_0=${lo} +k=1 +x_0=0 +y_0=0 +ellps=WGS84 +units=m +no_defs`);
  const xy = c.map(p => P.forward([p[1], p[0]]));
  let s = 0; for (let i = 0; i < xy.length; i++) { const a = xy[i], b = xy[(i + 1) % xy.length]; s += a[0] * b[1] - b[0] * a[1]; }
  return Math.abs(s) / 2;
}

/* ---------- Almacenamiento (IndexedDB) ---------- */
const Store = {
  db: null, ok: false,
  async init() {
    try {
      this.db = await new Promise((res, rej) => {
        const r = indexedDB.open('geocampo', 2);
        r.onupgradeneeded = e => {
          const d = r.result, ov = e.oldVersion;
          if (ov < 1) { d.createObjectStore('features', {keyPath: 'id'}); d.createObjectStore('layers', {keyPath: 'id'}); d.createObjectStore('kv'); }
          if (ov < 2) { d.createObjectStore('photos', {keyPath: 'id'}); d.createObjectStore('tiles'); d.createObjectStore('overlays', {keyPath: 'id'}); }
        };
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      this.ok = true;
    } catch (e) { toast('Sin almacenamiento local: los datos no se guardarán al cerrar', 5000); }
  },
  _run(store, mode, fn) {
    if (!this.ok) return Promise.resolve();
    return new Promise((res, rej) => {
      const tx = this.db.transaction(store, mode), os = tx.objectStore(store); const r = fn(os);
      tx.oncomplete = () => res(r && r.result); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error);
    });
  },
  all(s) { return this._run(s, 'readonly', os => os.getAll()); },
  put(s, v) { return this._run(s, 'readwrite', os => os.put(v)); },
  putMany(s, arr) { return this._run(s, 'readwrite', os => { arr.forEach(v => os.put(v)); }); },
  del(s, k) { return this._run(s, 'readwrite', os => os.delete(k)); },
  delMany(s, ks) { return this._run(s, 'readwrite', os => { ks.forEach(k => os.delete(k)); }); },
  get(k) { return this._run('kv', 'readonly', os => os.get(k)); },
  getIn(s, k) { return this._run(s, 'readonly', os => os.get(k)); },
  putIn(s, k, v) { return this._run(s, 'readwrite', os => os.put(v, k)); },
  set(k, v) { return this._run('kv', 'readwrite', os => os.put(v, k)).catch(() => {}); },
  rm(k) { return this._run('kv', 'readwrite', os => os.delete(k)).catch(() => {}); }
};

/* ---------- Estado ---------- */
const S = {
  layers: new Map(), features: new Map(), pos: null, follow: true, firstFix: true, dms: false, rec: null,
  listeners: new Set(), activeLayer: 'mis-datos',
  settings: {maxAcc: 15, minDist: 3, minTime: 5, captureBy: 'dist', avgSecs: 10, vtxAvg: false}
};

/* ---------- Interfaz: toast, diálogos, hojas ---------- */
let toastT, dlgFinish = null;
function toast(msg, ms = 2600) { const t = $('#toast'); t.textContent = msg; t.classList.add('show'); clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms); }
function dialog({title = '', body = '', buttons = [{label: 'Aceptar', value: true, cls: 'pri'}], stack = false, onOpen} = {}) {
  return new Promise(res => {
    const w = $('#dlgWrap'), d = $('#dlg');
    d.innerHTML = `${title ? `<h3>${esc(title)}</h3>` : ''}<div>${body}</div><div class="${stack ? 'col' : 'row end'}">${buttons.map((b, i) => `<button class="btn ${b.cls || ''}" data-i="${i}">${b.label}</button>`).join('')}</div>`;
    w.classList.remove('hidden');
    const finish = v => { dlgFinish = null; w.classList.add('hidden'); d.innerHTML = ''; res(v); };
    dlgFinish = finish;
    d.querySelectorAll('[data-i]').forEach(btn => btn.onclick = () => {
      const b = buttons[+btn.dataset.i]; let v = b.value;
      if (typeof v === 'function') { v = v(d); if (v === undefined) return; }
      finish(v);
    });
    if (onOpen) onOpen(d, finish);
  });
}
const confirmDlg = (title, body, ok = 'Aceptar', cls = 'pri') => dialog({title, body: `<p>${body}</p>`, buttons: [{label: 'Cancelar', value: false}, {label: ok, value: true, cls}]});
function openSheet(html) { $('#sheet').innerHTML = html; $('#sheetWrap').classList.remove('hidden'); $('#sheet').scrollTop = 0; return $('#sheet'); }
function closeSheet() { $('#sheetWrap').classList.add('hidden'); $('#sheet').innerHTML = ''; }
$('#sheetWrap').addEventListener('click', e => { if (e.target.id === 'sheetWrap') closeSheet(); });
function editDialog({title, name, desc = '', info = ''}) {
  return dialog({
    title, body: `${info ? `<div class="info">${info}</div>` : ''}<label>Nombre<input id="eName" value="${esc(name)}"></label><label>Descripción / observaciones<textarea id="eDesc" rows="3">${esc(desc)}</textarea></label>`,
    buttons: [{label: 'Cancelar', value: null}, {label: 'Guardar', cls: 'pri', value: d => ({name: d.querySelector('#eName').value.trim() || name, desc: d.querySelector('#eDesc').value.trim()})}]
  });
}

/* ---------- Mapa ---------- */
const map = L.map('map', {zoomControl: false, preferCanvas: true, maxZoom: 21}).setView([4.6, -74.1], 6);
/* Capa de mosaicos que primero busca en los mapas descargados (sin conexión) y luego en internet */
const OfflineTL = L.TileLayer.extend({
  createTile(coords, done) {
    const tile = document.createElement('img');
    tile.alt = ''; tile.setAttribute('role', 'presentation'); tile.crossOrigin = 'anonymous';
    L.DomEvent.on(tile, 'load', L.Util.bind(this._tileOnLoad, this, done, tile));
    let tried = false;
    // sin internet y sin ese mosaico guardado: amplía uno guardado de un zoom menor
    const fallback = async () => {
      if (tried || !Store.ok) return this._tileOnError(done, tile); tried = true;
      for (let k = 1; k <= 6; k++) {
        const z = coords.z - k; if (z < 0) break;
        const b = await Store.getIn('tiles', `${this.options.key}/${z}/${coords.x >> k}/${coords.y >> k}`).catch(() => null);
        if (!b) continue;
        try {
          const im = await createImageBitmap(b), n = 2 ** k, sz = 256 / n, c = document.createElement('canvas'); c.width = c.height = 256;
          const g = c.getContext('2d'); g.imageSmoothingEnabled = true;
          g.drawImage(im, (coords.x % n) * sz, (coords.y % n) * sz, sz, sz, 0, 0, 256, 256);
          tile.src = c.toDataURL('image/jpeg', .9); return;
        } catch (e) { break; }
      }
      this._tileOnError(done, tile);
    };
    L.DomEvent.on(tile, 'error', fallback);
    const net = () => { tile.src = this.getTileUrl(coords); };
    if (!Store.ok) { net(); return tile; }
    Store.getIn('tiles', `${this.options.key}/${coords.z}/${coords.x}/${coords.y}`).then(b => {
      if (b) { tile._obj = URL.createObjectURL(b); tile.src = tile._obj; } else net();
    }).catch(net);
    return tile;
  }
});
const offTL = (key, url, o) => { const t = new OfflineTL(url, {...o, key}); t.on('tileunload', e => { if (e.tile._obj) URL.revokeObjectURL(e.tile._obj); }); return t; };
const BASES = {
  'Satélite (Esri)': offTL('esri', 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {maxZoom: 21, maxNativeZoom: 19, attribution: 'Imágenes © Esri, Maxar, Earthstar Geographics'}),
  'Calles (OpenStreetMap)': offTL('osm', 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', {maxZoom: 21, maxNativeZoom: 19, attribution: '© OpenStreetMap'}),
  'Topográfico (OpenTopoMap)': offTL('topo', 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {maxZoom: 21, maxNativeZoom: 17, subdomains: 'abc', attribution: '© OpenTopoMap (CC-BY-SA)'})
};
const LABELS = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {maxZoom: 21, maxNativeZoom: 19, crossOrigin: 'anonymous'});
L.control.layers(BASES, {'Nombres y límites': LABELS}, {position: 'topright'}).addTo(map);
L.control.scale({imperial: false, position: 'bottomleft'}).addTo(map);
map.on('dragstart', () => setFollow(false));

const groups = new Map();   // capa -> L.featureGroup
const drawn = new Map();    // elemento -> objeto Leaflet
function groupOf(lid) {
  let g = groups.get(lid);
  if (!g) { g = L.featureGroup(); groups.set(lid, g); const ly = S.layers.get(lid); if (!ly || ly.visible) g.addTo(map); }
  return g;
}
/* Estilo por atributo y etiquetas (por capa) */
const RAMP = ['#1a9850', '#91cf60', '#fee08b', '#fc8d59', '#d73027'];
function fieldVal(f, k) { if (!k) return null; if (k === '__name') return f.name; if (k === '__area') return f.type === 'polygon' ? +(fArea(f) / 1e4).toFixed(4) : null; return f.props ? f.props[k] : null; }
function layerFields(lid) {
  const ks = new Set();
  for (const f of S.features.values()) if (f.layer === lid && f.props) Object.keys(f.props).forEach(k => ks.add(k));
  return [...ks];
}
const styleCache = new Map();
function layerStyle(l) {
  if (!l || !l.styleBy) return null;
  let st = styleCache.get(l.id);
  if (st && st.key === l.styleBy) return st;
  const vals = [...S.features.values()].filter(f => f.layer === l.id).map(f => fieldVal(f, l.styleBy)).filter(v => v != null && v !== '');
  const nums = vals.map(v => typeof v === 'number' ? v : parseNum(v));
  if (vals.length && nums.every(isFinite) && new Set(nums).size > 5) {
    const mn = Math.min(...nums), mx = Math.max(...nums), w = (mx - mn) / 5 || 1;
    st = {key: l.styleBy, kind: 'num', mn, mx, w, color: v => { const x = typeof v === 'number' ? v : parseNum(v); if (!isFinite(x)) return '#999'; return RAMP[Math.min(4, Math.floor((x - mn) / w))]; },
      legend: RAMP.map((c, i) => [c, `${fmt(mn + i * w, 2)} – ${fmt(mn + (i + 1) * w, 2)}`])};
  } else {
    const cats = [...new Set(vals.map(String))].slice(0, 40), m = new Map(cats.map((c, i) => [c, PALETTE[i % PALETTE.length]]));
    st = {key: l.styleBy, kind: 'cat', color: v => m.get(String(v)) || '#999', legend: cats.slice(0, 12).map(c => [m.get(c), c])};
  }
  styleCache.set(l.id, st); return st;
}
function colorOf(f) {
  if (f.color) return f.color;
  const l = S.layers.get(f.layer), st = layerStyle(l);
  if (st) return st.color(fieldVal(f, l.styleBy));
  return l?.color || '#e8590c';
}
function refreshLayer(lid) { styleCache.delete(lid); for (const f of S.features.values()) if (f.layer === lid) renderFeature(f); }
function updLblZoom() { const z = map.getZoom(), m = $('#map'); [12, 14, 15, 16, 17].forEach(t => m.classList.toggle('below' + t, z < t)); }
map.on('zoomend', updLblZoom);
function renderFeature(f) {
  unrender(f.id);
  const color = colorOf(f), ll = f.coords.map(c => [c[0], c[1]]);
  let o;
  if (f.type === 'point' && f.photos && f.photos.length) o = L.marker(ll[0], {icon: L.divIcon({className: 'phico', html: `<span style="border-color:${color}">📷</span>`, iconSize: [28, 28], iconAnchor: [14, 14]})});
  else if (f.type === 'point') o = L.circleMarker(ll[0], {radius: 7, color: '#fff', weight: 2, fillColor: color, fillOpacity: 1});
  else if (f.type === 'line') o = L.polyline(ll, {color, weight: 4});
  else o = L.polygon([ll, ...(f.holes || []).map(h => h.map(c => [c[0], c[1]]))], {color, weight: 3, fillOpacity: .18});
  const l = S.layers.get(f.layer);
  if (l && l.label) { const t = fieldVal(f, l.label); if (t != null && t !== '') o.bindTooltip(esc(String(t)), {permanent: true, direction: f.type === 'point' ? 'top' : 'center', offset: f.type === 'point' ? [0, -6] : [0, 0], className: `lbl lz${l.labelZoom ?? 15}`, interactive: false}); }
  o.on('click', e => {
    L.DomEvent.stop(e);
    if (S.rec && S.rec.mode === 'tap') { addVertex([e.latlng.lat, e.latlng.lng, null, Date.now()]); return; }
    if (S.tapHook) { S.tapHook(e.latlng, f); return; }
    showInfo(f.id);
  });
  groupOf(f.layer).addLayer(o); drawn.set(f.id, o);
}
function unrender(id) { const o = drawn.get(id); if (o) { groups.forEach(g => g.removeLayer(o)); drawn.delete(id); } }
function boundsOf(fs) { const b = L.latLngBounds([]); fs.forEach(f => f.coords.forEach(c => b.extend([c[0], c[1]]))); return b; }
const activeLayerId = () => S.layers.has(S.activeLayer) ? S.activeLayer : 'mis-datos';
function zoomTo(fs) { const b = boundsOf(fs); if (!b.isValid()) return; setFollow(false); if (b.getNorthEast().equals(b.getSouthWest())) map.setView(b.getCenter(), Math.max(map.getZoom(), 18)); else map.fitBounds(b, {padding: [50, 50], maxZoom: 19}); }

/* ---------- GPS ---------- */
const me = {dot: null, circle: null};
function setFollow(on) { S.follow = on; $('#btnFollow').classList.toggle('on', on); }
$('#btnFollow').onclick = () => { setFollow(true); if (S.pos) map.setView([S.pos.lat, S.pos.lon], Math.max(map.getZoom(), 17)); else toast('Aún no hay señal GPS'); };
$('#gps').onclick = () => { if (S.gpsDenied && CAP) { BG.openSettings(); return; } S.dms = !S.dms; updateGpsPanel(); };
let gpsWatch = null, gpsBg = null, webWatch = null;
/* En la APK: bg=true activa el servicio en primer plano (notificación) y el GPS sigue con la pantalla apagada */
async function startGPS(bg = false) {
  if (CAP) {
    if (gpsWatch && gpsBg === bg) return;
    const old = gpsWatch; gpsWatch = null; gpsBg = bg;
    if (old) await BG.removeWatcher({id: old}).catch(() => {});
    const opts = {requestPermissions: true, stale: false, distanceFilter: 0};
    if (bg) await askNotif();
    if (bg) { opts.backgroundTitle = 'GeoCampo está grabando'; opts.backgroundMessage = 'Registrando con GPS. Puedes apagar la pantalla.'; }
    try {
      gpsWatch = await BG.addWatcher(opts, (loc, err) => {
        if (err) { if (err.code === 'NOT_AUTHORIZED') { S.gpsDenied = true; gpsMsg('Permiso de ubicación denegado. <u>Toca aquí para abrir los ajustes de la app</u> y permite la ubicación.'); } return; }
        if (loc) onPos({coords: {latitude: loc.latitude, longitude: loc.longitude, accuracy: loc.accuracy, altitude: loc.altitude}, timestamp: loc.time || Date.now()});
      });
    } catch (e) { gpsMsg('No se pudo iniciar el GPS: ' + esc(e.message || e)); }
    return;
  }
  if (webWatch !== null) return;
  if (!('geolocation' in navigator)) { gpsMsg('Este navegador no tiene acceso al GPS'); return; }
  if (!window.isSecureContext) gpsMsg('⚠ Abre la app desde una dirección <b>https://</b> para que el navegador permita usar el GPS.');
  webWatch = navigator.geolocation.watchPosition(onPos, onPosErr, {enableHighAccuracy: true, maximumAge: 0, timeout: 30000});
}
function gpsMsg(h) { $('#gps').innerHTML = `<div>${h}</div>`; }
function onPos(p) {
  const c = p.coords; S.gpsDenied = false;
  S.pos = {lat: c.latitude, lon: c.longitude, acc: c.accuracy, alt: c.altitude, t: p.timestamp};
  const ll = [S.pos.lat, S.pos.lon];
  if (!me.dot) {
    me.circle = L.circle(ll, {radius: S.pos.acc, color: '#3182ce', weight: 1, fillOpacity: .12, interactive: false}).addTo(map);
    me.dot = L.circleMarker(ll, {radius: 8, color: '#fff', weight: 3, fillColor: '#3182ce', fillOpacity: 1, interactive: false}).addTo(map);
  } else { me.dot.setLatLng(ll); me.circle.setLatLng(ll).setRadius(S.pos.acc); }
  me.dot.bringToFront();
  if (S.follow) { if (S.firstFix) map.setView(ll, 17); else map.panTo(ll, {animate: true}); }
  S.firstFix = false;
  updateGpsPanel();
  S.listeners.forEach(fn => fn(S.pos));
  recTick(S.pos);
}
function onPosErr(e) {
  if (e.code === 1) gpsMsg('Permiso de ubicación denegado. En Chrome: toca el candado junto a la dirección ▸ Permisos ▸ Ubicación ▸ Permitir, y recarga.');
  else if (e.code === 2) gpsMsg('GPS no disponible. Verifica que la ubicación del celular esté activada.');
  else if (!S.pos) gpsMsg('Esperando señal GPS… (sal a cielo abierto)');
}
function updateGpsPanel() {
  const p = S.pos; if (!p) return;
  const cls = p.acc <= 5 ? 'good' : p.acc <= S.settings.maxAcc ? 'mid' : 'bad';
  const {e, n} = toCTM(p.lat, p.lon);
  const ll = S.dms ? `${dms(p.lat, 'N', 'S')} ${dms(p.lon, 'E', 'O')}` : `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`;
  $('#gps').innerHTML = `<div>${ll} <span class="acc ${cls}">±${fmt(p.acc, 1)} m</span></div><div class="mut">Origen Nacional E ${fmt(e, 1)} · N ${fmt(n, 1)}${p.alt != null ? ` · Alt. GPS ${fmt(p.alt, 0)} m` : ''}</div>`;
}
function averageGPS(secs) {
  return new Promise(resolve => {
    const samples = []; let left = secs, dEl = null, closer = null;
    const upd = () => { if (dEl) dEl.querySelector('.avgst').innerHTML = `Lecturas válidas: <b>${samples.length}</b> · faltan ${left} s${S.pos ? `<br>Precisión actual ±${fmt(S.pos.acc, 1)} m (límite ${S.settings.maxAcc} m)` : '<br>Sin señal GPS'}`; };
    const seen = new Set();
    const fn = p => { if (p && !seen.has(p.t) && p.acc <= S.settings.maxAcc) { seen.add(p.t); samples.push(p); } upd(); };
    S.listeners.add(fn); fn(S.pos);
    const timer = setInterval(() => { left--; upd(); if (left <= 0) { clearInterval(timer); closer && closer(samples.length ? 'ok' : 'none'); } }, 1000);
    dialog({title: 'Promediando GPS', body: '<p class="avgst"></p><p class="mut">Mantén el celular quieto sobre el punto.</p>', buttons: [{label: 'Cancelar', value: 'cancel'}], onOpen: (d, fin) => { dEl = d; closer = fin; upd(); }})
      .then(v => {
        clearInterval(timer); S.listeners.delete(fn);
        if (v !== 'ok') { if (v === 'none') toast('No hubo lecturas dentro de la precisión requerida'); return resolve(null); }
        const n = samples.length, avg = k => samples.reduce((s, p) => s + p[k], 0) / n;
        const alts = samples.filter(p => p.alt != null);
        resolve({lat: avg('lat'), lon: avg('lon'), alt: alts.length ? alts.reduce((s, p) => s + p.alt, 0) / alts.length : null, acc: avg('acc'), n});
      });
  });
}

/* ---------- Mantener pantalla encendida mientras se graba ---------- */
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (CAP) return;
    if (on && 'wakeLock' in navigator && !wakeLock) { wakeLock = await navigator.wakeLock.request('screen'); wakeLock.addEventListener('release', () => { wakeLock = null; }); }
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch (e) {}
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.rec) keepAwake(true); });

/* ---------- Datos: crear / editar / borrar ---------- */
async function addFeatures(fs) {
  fs.forEach(f => { S.features.set(f.id, f); renderFeature(f); });
  try { await Store.putMany('features', fs); } catch (e) { toast('Error al guardar: ' + e.message, 4000); }
}
async function saveFeature(f) { S.features.set(f.id, f); renderFeature(f); try { await Store.put('features', f); } catch (e) { toast('Error al guardar: ' + e.message, 4000); } }
async function deleteFeatures(ids) {
  const ph = ids.flatMap(id => S.features.get(id)?.photos || []);
  ids.forEach(id => { S.features.delete(id); unrender(id); }); await Store.delMany('features', ids).catch(() => {});
  if (ph.length) await Store.delMany('photos', ph).catch(() => {});
}
async function saveLayer(l) { S.layers.set(l.id, l); await Store.put('layers', l).catch(() => {}); }
const countType = t => [...S.features.values()].filter(f => f.type === t && f.layer === activeLayerId()).length;

/* ---------- Herramienta: punto ---------- */
async function newPoint() {
  const ch = await dialog({
    title: 'Nuevo punto', body: '<p class="mut">¿De dónde se toma la coordenada?</p>', stack: true,
    buttons: [{label: 'Ubicación GPS actual', value: 'gps', cls: 'pri'}, {label: `Promediar GPS (${S.settings.avgSecs} s) — más preciso`, value: 'avg', cls: 'pri'}, {label: 'Centro del mapa (cruz)', value: 'cross'}, {label: 'Cancelar', value: null}]
  });
  if (!ch) return;
  let c, extra = {};
  if (ch === 'gps') { if (!S.pos) return toast('Aún no hay señal GPS'); c = [S.pos.lat, S.pos.lon, S.pos.alt, Date.now()]; extra = {acc: S.pos.acc}; }
  else if (ch === 'avg') { const a = await averageGPS(S.settings.avgSecs); if (!a) return; c = [a.lat, a.lon, a.alt, Date.now()]; extra = {acc: a.acc, n: a.n}; }
  else { const m = map.getCenter(); c = [m.lat, m.lng, null, Date.now()]; extra = {src: 'mapa'}; }
  const r = await editDialog({title: 'Guardar punto', name: `Punto ${countType('point') + 1}`, info: `${c[0].toFixed(6)}, ${c[1].toFixed(6)}${extra.acc ? ` · ±${fmt(extra.acc, 1)} m` : ''}${extra.n ? ` · ${extra.n} lecturas` : ''}`});
  if (!r) return;
  await saveFeature({id: uid(), layer: activeLayerId(), type: 'point', name: r.name, desc: r.desc, coords: [c], created: Date.now(), ...extra});
  toast('Punto guardado');
}

/* ---------- Herramienta: track / polígono ---------- */
async function startDrawing(type, target) {
  if (S.rec) return toast('Ya hay un registro en curso');
  const poly = type === 'polygon' || type === 'hole';
  const mode = await dialog({
    title: type === 'hole' ? 'Recortar hueco' : poly ? 'Nuevo polígono' : 'Nuevo track / línea', stack: true,
    body: `<p class="mut">${type === 'hole' ? 'Traza el borde del área a excluir (construcción, bosque, reservorio…):' : poly ? 'Elige cómo levantar el lote:' : 'Elige cómo trazar:'}</p>`,
    buttons: [
      {label: poly ? 'Caminando el borde (GPS automático)' : 'Grabar recorrido (GPS automático)', value: 'gps-auto', cls: 'pri'},
      {label: 'Vértice a vértice con GPS (manual)', value: 'gps-manual', cls: 'pri'},
      {label: 'Dibujando sobre el mapa', value: 'tap'},
      {label: 'Cancelar', value: null}]
  });
  if (!mode) return;
  beginRec({type, mode, coords: [], paused: false, target});
}
function beginRec(r) {
  S.rec = r; closeSheet();
  document.querySelectorAll('#bar button').forEach(b => b.disabled = b.dataset.act !== 'layers');
  keepAwake(true); if (r.mode !== 'tap') startGPS(true); renderRecUI(); updateRecGeom(); saveDraft();
  if (r.mode === 'gps-auto' && S.pos) { setFollow(true); recTick(S.pos); }
}
function endRec() {
  const r = S.rec; if (!r) return;
  r.geom && r.geom.remove(); r.vtx && r.vtx.remove();
  S.rec = null; $('#rec').classList.add('hidden');
  document.querySelectorAll('#bar button').forEach(b => b.disabled = false);
  keepAwake(false); Store.rm('rec'); if (CAP) startGPS(false);
}
function saveDraft() { const r = S.rec; if (r) Store.set('rec', {type: r.type, mode: r.mode, coords: r.coords, paused: r.paused, target: r.target}); }
function renderRecUI() {
  const r = S.rec, el = $('#rec'); el.classList.remove('hidden');
  const poly = r.type !== 'line';
  const btns = [];
  if (r.mode === 'gps-auto') btns.push(`<button class="btn" id="rPause">${r.paused ? '▶ Reanudar' : '⏸ Pausa'}</button>`, `<button class="btn" id="rSet" title="Ajustes de captura">⚙</button>`);
  if (r.mode === 'gps-manual') btns.push(`<button class="btn rec grow" id="rGps">+ Vértice GPS</button>`);
  if (r.mode !== 'gps-auto') btns.push(`<button class="btn" id="rCross">+ En la cruz</button>`);
  btns.push(`<button class="btn" id="rUndo">↶</button>`, `<button class="btn pri" id="rDone">Terminar</button>`, `<button class="btn dan" id="rCancel">✕</button>`);
  el.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px"><b>${r.type === 'hole' ? 'Hueco' : poly ? 'Polígono' : 'Track / línea'}</b><span class="mut" id="rStatus"></span></div><div id="rStats"></div><div class="row" style="margin-top:6px">${btns.join('')}</div>`;
  const on = (id, fn) => { const b = el.querySelector('#' + id); if (b) b.onclick = fn; };
  on('rPause', () => { r.paused = !r.paused; el.querySelector('#rPause').textContent = r.paused ? '▶ Reanudar' : '⏸ Pausa'; updateRecStats(); saveDraft(); });
  on('rSet', async () => { await openSettings(); updateRecStats(); });
  on('rGps', addGpsVertex);
  on('rCross', () => { const m = map.getCenter(); addVertex([m.lat, m.lng, null, Date.now()]); });
  on('rUndo', () => { r.coords.pop(); updateRecGeom(); updateRecStats(); saveDraft(); });
  on('rDone', finishRec);
  on('rCancel', async () => { if (!r.coords.length || await confirmDlg('Descartar', '¿Descartar este registro sin guardarlo?', 'Descartar', 'dan')) endRec(); });
  updateRecStats();
}
function ruleText() {
  const s = S.settings;
  return s.captureBy === 'time' ? `cada ${s.minTime} s` : s.captureBy === 'both' ? `cada ${s.minDist} m y ${s.minTime} s` : `cada ${s.minDist} m`;
}
function updateRecStats() {
  const r = S.rec; if (!r) return;
  const n = r.coords.length;
  $('#rStats').innerHTML = r.type !== 'line'
    ? `<span class="big">${fmt(areaM2(r.coords) / 1e4, 4)} ha</span> <span class="mut">· perímetro ${fmtLen(perimM(r.coords))} · ${n} vértices</span>`
    : `<span class="big">${fmtLen(lengthM(r.coords))}</span> <span class="mut">· ${n} puntos</span>`;
  let st = '';
  if (r.mode === 'gps-auto') st = r.paused ? '⏸ En pausa' : `${r.status || '● Grabando'} · ${ruleText()}`;
  else if (r.mode === 'tap') st = 'Toca el mapa para agregar vértices';
  else st = 'Párate en cada vértice y toca “+ Vértice GPS”';
  $('#rStatus').textContent = st;
}
function updateRecGeom() {
  const r = S.rec; const ll = r.coords.map(c => [c[0], c[1]]);
  if (!r.geom) {
    r.geom = (r.type !== 'line' ? L.polygon(ll, {color: '#d53f8c', weight: 3, dashArray: '6 6', fillOpacity: .15, interactive: false}) : L.polyline(ll, {color: '#d53f8c', weight: 4, interactive: false})).addTo(map);
    r.vtx = L.layerGroup().addTo(map);
  } else r.geom.setLatLngs(ll);
  r.vtx.clearLayers();
  if (r.mode !== 'gps-auto' || ll.length < 400) ll.forEach(p => L.circleMarker(p, {radius: 4, color: '#fff', weight: 1.5, fillColor: '#d53f8c', fillOpacity: 1, interactive: false}).addTo(r.vtx));
}
function addVertex(c) { if (!S.rec) return; S.rec.coords.push(c); updateRecGeom(); updateRecStats(); saveDraft(); if (navigator.vibrate) navigator.vibrate(25); }
function recTick(p) {
  const r = S.rec; if (!r || r.mode !== 'gps-auto' || r.paused) return;
  if (p.acc > S.settings.maxAcc) { r.status = `Esperando precisión (±${fmt(p.acc, 0)} m)`; updateRecStats(); return; }
  r.status = '● Grabando';
  const last = r.coords[r.coords.length - 1];
  if (last) {
    const s = S.settings, okD = distM(last, [p.lat, p.lon]) >= s.minDist, okT = (p.t - (last[3] || 0)) / 1000 >= s.minTime;
    const ok = s.captureBy === 'time' ? okT : s.captureBy === 'both' ? okD && okT : okD;
    if (!ok) { updateRecStats(); return; }
  }
  r.coords.push([p.lat, p.lon, p.alt, p.t]); updateRecGeom(); updateRecStats(); saveDraft();
}
async function addGpsVertex() {
  if (!S.pos) return toast('Aún no hay señal GPS');
  if (S.settings.vtxAvg) { const a = await averageGPS(S.settings.avgSecs); if (a) addVertex([a.lat, a.lon, a.alt, Date.now()]); return; }
  if (S.pos.acc > S.settings.maxAcc && !await confirmDlg('Precisión baja', `La precisión actual es ±${fmt(S.pos.acc, 1)} m (tu límite es ${S.settings.maxAcc} m). ¿Agregar el vértice de todas formas?`, 'Agregar')) return;
  addVertex([S.pos.lat, S.pos.lon, S.pos.alt, S.pos.t]);
}
async function finishRec() {
  const r = S.rec, poly = r.type !== 'line', min = poly ? 3 : 2;
  if (r.coords.length < min) return toast(`Se necesitan al menos ${min} puntos`);
  if (r.type === 'hole') {
    const f = S.features.get(r.target); if (!f) { endRec(); return toast('El polígono ya no existe'); }
    const cs = r.coords; endRec(); (f.holes = f.holes || []).push(cs); await saveFeature(f); toast(`Hueco recortado: ${fmt(areaM2(cs) / 1e4, 4)} ha`); showInfo(f.id); return;
  }
  const info = poly ? `<b>${fmt(areaM2(r.coords) / 1e4, 4)} ha</b> · perímetro ${fmtLen(perimM(r.coords))}` : `<b>${fmtLen(lengthM(r.coords))}</b> · ${r.coords.length} puntos`;
  const res = await editDialog({title: poly ? 'Guardar polígono' : 'Guardar track', name: `${poly ? 'Polígono' : 'Track'} ${countType(r.type) + 1}`, info});
  if (!res) return;
  const f = {id: uid(), layer: activeLayerId(), type: r.type, name: res.name, desc: res.desc, coords: r.coords, created: Date.now()};
  endRec(); await saveFeature(f); toast('Guardado'); showInfo(f.id);
}
map.on('click', e => { if (S.rec && S.rec.mode === 'tap') addVertex([e.latlng.lat, e.latlng.lng, null, Date.now()]); else if (S.tapHook) S.tapHook(e.latlng, null); });

/* ---------- Ficha de un elemento ---------- */
function statsHtml(f) {
  if (f.type === 'point') {
    const [lat, lon, alt] = f.coords[0], {e, n} = toCTM(lat, lon);
    return `<table class="kv"><tr><td>Latitud</td><td>${lat.toFixed(7)}<br><span class="mut">${dms(lat, 'N', 'S')}</span></td></tr><tr><td>Longitud</td><td>${lon.toFixed(7)}<br><span class="mut">${dms(lon, 'E', 'O')}</span></td></tr><tr><td>Origen Nacional (9377)</td><td>E ${fmt(e, 2)}<br>N ${fmt(n, 2)}</td></tr>${alt != null ? `<tr><td>Altitud GPS</td><td>${fmt(alt, 1)} m</td></tr>` : ''}${f.acc ? `<tr><td>Precisión</td><td>±${fmt(f.acc, 1)} m${f.n ? ` (promedio de ${f.n} lecturas)` : ''}</td></tr>` : ''}${f.src === 'mapa' ? '<tr><td>Origen</td><td>Marcado en el mapa</td></tr>' : ''}</table>`;
  }
  if (f.type === 'polygon') {
    const a = fArea(f);
    return `<div class="big">${fmt(a / 1e4, 4)} ha</div><table class="kv"><tr><td>Área</td><td>${fmt(a, 1)} m²</td></tr><tr><td>Perímetro</td><td>${fmtLen(fPerim(f))}</td></tr><tr><td>Vértices</td><td>${f.coords.length}</td></tr>${f.holes && f.holes.length ? `<tr><td>Huecos</td><td>${f.holes.length} (${fmt(f.holes.reduce((s, h) => s + areaM2(h), 0) / 1e4, 4)} ha descontadas)</td></tr>` : ''}</table>`;
  }
  const t0 = f.coords[0][3], t1 = f.coords[f.coords.length - 1][3];
  const dur = t0 && t1 && t1 > t0 ? Math.round((t1 - t0) / 60000) : null;
  return `<div class="big">${fmtLen(lengthM(f.coords))}</div><table class="kv"><tr><td>Puntos</td><td>${f.coords.length}</td></tr>${dur != null ? `<tr><td>Duración</td><td>${Math.floor(dur / 60)} h ${dur % 60} min</td></tr>` : ''}${f.coords.length > 2 ? `<tr><td>Área si se cierra</td><td>${fmt(fArea(f) / 1e4, 4)} ha</td></tr>` : ''}</table>`;
}
/* Extensiones de la ficha: módulos registran acciones y bloques extra */
const INFO_ACTIONS = [];   // {label, when(f), run(f)}
const INFO_EXTRA = [];     // (f, sheet) => html | Promise
function propsHtml(f) {
  const e = Object.entries(f.props || {}).filter(([, v]) => v != null && v !== '');
  return e.length ? `<details class="props"><summary>Atributos (${e.length})</summary><table class="kv">${e.map(([k, v]) => `<tr><td>${esc(k)}</td><td>${esc(v)}</td></tr>`).join('')}</table></details>` : '';
}
function showInfo(id) {
  const f = S.features.get(id); if (!f) return;
  const ly = S.layers.get(f.layer);
  const sh = openSheet(`<div class="mut"><span class="sw" style="background:${colorOf(f)}"></span> ${TYPE[f.type]} · ${esc(ly?.name || '')}</div>
    <label>Nombre<input id="fName" value="${esc(f.name)}"></label>${statsHtml(f)}
    <label>Descripción<textarea id="fDesc" rows="3">${esc(f.desc || '')}</textarea></label>${propsHtml(f)}<div id="fExtra"></div>
    <div class="row">${INFO_ACTIONS.map((a, i) => a.when(f) ? `<button class="btn" data-ia="${i}">${a.label}</button>` : '').join('')}</div>
    <div class="row"><button class="btn pri" id="fSave">Guardar</button><button class="btn" id="fZoom">Ver en mapa</button><button class="btn" id="fCopy">Copiar</button>${f.type === 'line' ? '<button class="btn" id="fClose">Convertir a polígono</button>' : ''}<button class="btn dan" id="fDel">Eliminar</button></div>`);
  sh.querySelectorAll('[data-ia]').forEach(b => b.onclick = () => INFO_ACTIONS[+b.dataset.ia].run(f));
  INFO_EXTRA.forEach(async fn => { try { const h = await fn(f, sh); if (h && sh.isConnected) sh.querySelector('#fExtra')?.insertAdjacentHTML('beforeend', h); } catch (e) {} });
  sh.querySelector('#fSave').onclick = async () => { f.name = sh.querySelector('#fName').value.trim(); f.desc = sh.querySelector('#fDesc').value.trim(); await saveFeature(f); toast('Cambios guardados'); };
  sh.querySelector('#fZoom').onclick = () => { closeSheet(); zoomTo([f]); };
  sh.querySelector('#fCopy').onclick = async () => {
    let t;
    if (f.type === 'point') { const {e, n} = toCTM(f.coords[0][0], f.coords[0][1]); t = `${f.name}: ${f.coords[0][0].toFixed(7)}, ${f.coords[0][1].toFixed(7)} (Origen Nacional E ${e.toFixed(2)} N ${n.toFixed(2)})`; }
    else if (f.type === 'polygon') t = `${f.name}: ${(fArea(f) / 1e4).toFixed(4)} ha, perímetro ${fPerim(f).toFixed(1)} m`;
    else t = `${f.name}: ${lengthM(f.coords).toFixed(1)} m`;
    try { await navigator.clipboard.writeText(t); toast('Copiado'); } catch (e) { toast(t, 6000); }
  };
  const cl = sh.querySelector('#fClose');
  if (cl) cl.onclick = async () => { if (f.coords.length < 3) return toast('Se necesitan al menos 3 puntos'); f.type = 'polygon'; await saveFeature(f); styleCache.delete(f.layer); showInfo(f.id); };
  sh.querySelector('#fDel').onclick = async () => { if (await confirmDlg('Eliminar', `¿Eliminar “${esc(f.name || 'sin nombre')}”?${f.photos?.length ? ` También se borrarán sus ${f.photos.length} fotos.` : ''}`, 'Eliminar', 'dan')) { await deleteFeatures([f.id]); closeSheet(); toast('Eliminado'); } };
}

/* ---------- Capas y proyectos ---------- */
const LAYER_TOOLS = [];  // módulos agregan filas extra al panel de capas: () => html, y bind(sheet)
function openLayers() {
  const all = [...S.features.values()], act = activeLayerId();
  const html = [...S.layers.values()].map(l => {
    const fs = all.filter(f => f.layer === l.id);
    const ha = fs.filter(f => f.type === 'polygon').reduce((s, f) => s + fArea(f), 0) / 1e4;
    const st = layerStyle(l);
    const legend = st ? `<div class="legend">${st.legend.map(([c, t]) => `<span><i style="background:${c}"></i>${esc(t)}</span>`).join('')}</div>` : '';
    const list = fs.slice(0, 500).map(f => `<div class="fi" data-f="${f.id}"><span>${f.photos?.length ? '📷' : f.type === 'point' ? '●' : f.type === 'line' ? '〰' : '⬠'} ${esc(f.name || '(sin nombre)')}</span><span class="mut">${f.type === 'polygon' ? fmt(fArea(f) / 1e4, 4) + ' ha' : f.type === 'line' ? fmtLen(lengthM(f.coords)) : ''}</span></div>`).join('');
    return `<div class="lyr ${l.id === act ? 'act' : ''}" data-l="${l.id}"><div class="lyr-h"><input type="checkbox" class="vis" ${l.visible ? 'checked' : ''}><input type="color" class="clr" value="${l.color}"><div class="grow"><b>${l.id === act ? '★ ' : ''}${esc(l.name)}</b><div class="mut">${fs.length} elementos${ha ? ` · ${fmt(ha, 4)} ha` : ''}${l.id === act ? ' · capa activa' : ''}</div></div><button class="ib lb" title="Etiquetas">🏷</button><button class="ib exp">▾</button><button class="ib cfg">⚙</button><button class="ib zm">⤢</button></div>${l.label ? `<div class="legend">🏷 ${esc(l.label === '__name' ? 'Nombre' : l.label === '__area' ? 'Área (ha)' : l.label)}</div>` : ''}${legend}<div class="lst hidden">${list || '<div class="fi mut">Sin elementos</div>'}${fs.length > 500 ? `<div class="fi mut">… y ${fs.length - 500} más</div>` : ''}</div></div>`;
  }).join('');
  const sh = openSheet(`<h3>Capas</h3><p class="mut" style="margin:0">★ = capa activa: ahí se guardan los puntos, tracks, polígonos y fotos nuevos.</p>${html}
    <div class="row"><button class="btn pri grow" id="lNew">+ Nueva capa / proyecto</button><button class="btn grow" id="lImp">Importar archivo</button><button class="btn grow" id="lExp">Exportar</button></div>${LAYER_TOOLS.map(t => t.html()).join('')}`);
  sh.querySelector('#lNew').onclick = newLayerDlg;
  sh.querySelector('#lImp').onclick = () => $('#file').click();
  sh.querySelector('#lExp').onclick = () => { closeSheet(); openExport(); };
  LAYER_TOOLS.forEach(t => t.bind && t.bind(sh));
  sh.querySelectorAll('.lyr[data-l]').forEach(el => {
    const l = S.layers.get(el.dataset.l), fs = () => all.filter(f => f.layer === l.id);
    el.querySelector('.vis').onchange = e => { l.visible = e.target.checked; const g = groupOf(l.id); l.visible ? g.addTo(map) : g.remove(); saveLayer(l); };
    el.querySelector('.clr').onchange = e => { l.color = e.target.value; saveLayer(l); fs().forEach(f => { delete f.color; }); refreshLayer(l.id); };
    el.querySelector('.exp').onclick = () => el.querySelector('.lst').classList.toggle('hidden');
    el.querySelector('.zm').onclick = () => { if (!fs().length) return toast('Capa vacía'); closeSheet(); zoomTo(fs()); };
    el.querySelector('.cfg').onclick = () => layerSettings(l);
    el.querySelector('.lb').onclick = () => labelDialog(l);
    el.querySelectorAll('.fi[data-f]').forEach(r => r.onclick = () => { const f = S.features.get(r.dataset.f); closeSheet(); zoomTo([f]); setTimeout(() => showInfo(f.id), 350); });
  });
}
async function newLayerDlg() {
  const d = new Date(), p = v => String(v).padStart(2, '0');
  const r = await dialog({title: 'Nueva capa / proyecto', body: `<p class="mut">Por ejemplo, una por finca o por visita. Quedará como capa activa.</p><label>Nombre<input id="nlN" value="Visita ${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}"></label>`,
    buttons: [{label: 'Cancelar', value: null}, {label: 'Crear', cls: 'pri', value: dl => dl.querySelector('#nlN').value.trim() || 'Proyecto'}]});
  if (!r) return;
  const l = {id: uid(), name: r, color: PALETTE[S.layers.size % PALETTE.length], visible: true, order: Date.now(), user: true};
  await saveLayer(l); setActiveLayer(l.id); openLayers(); toast(`Capa activa: ${r}`);
}
function setActiveLayer(id) { S.activeLayer = id; Store.set('activeLayer', id); }
const LBL_Z = [[0, 'Siempre (todo zoom)'], [12, 'Desde zoom 12 (vista de municipio)'], [14, 'Desde zoom 14'], [15, 'Desde zoom 15 (vista de vereda)'], [16, 'Desde zoom 16'], [17, 'Desde zoom 17 (vista de finca)']];
async function labelDialog(l) {
  const fs = [...S.features.values()].filter(f => f.layer === l.id), fields = layerFields(l.id), hasPoly = fs.some(f => f.type === 'polygon');
  const ex = f => fs.find(x => fieldVal(x, f) != null && fieldVal(x, f) !== '');
  const opt = (v, t) => { const e = ex(v); return `<option value="${esc(v)}" ${(l.label || '') === v ? 'selected' : ''}>${esc(t)}${e ? ` — ej.: ${esc(String(fieldVal(e, v)).slice(0, 25))}` : ''}</option>`; };
  const r = await dialog({title: 'Etiquetas: ' + l.name, body: `
    <label>Columna que se muestra en la etiqueta<select id="lbF"><option value="">— Sin etiquetas —</option>${opt('__name', 'Nombre')}${hasPoly ? opt('__area', 'Área (ha)') : ''}${fields.map(k => opt(k, k)).join('')}</select></label>
    <label>Mostrar<select id="lbZ">${LBL_Z.map(([z, t]) => `<option value="${z}" ${(l.labelZoom ?? 15) === z ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
    <p class="mut">Con muchos puntos conviene mostrarlas solo de cerca, para que no se amontonen.</p>`,
    buttons: [{label: 'Cancelar', value: null}, {label: 'Aplicar', cls: 'pri', value: d => ({label: d.querySelector('#lbF').value, labelZoom: +d.querySelector('#lbZ').value})}]});
  if (!r) return openLayers();
  Object.assign(l, r); await saveLayer(l); refreshLayer(l.id); updLblZoom();
  if (r.label && map.getZoom() < r.labelZoom) toast(`Acércate (zoom ${r.labelZoom} o más) para ver las etiquetas`, 3500);
  openLayers();
}
async function layerSettings(l) {
  const fs = [...S.features.values()].filter(f => f.layer === l.id);
  const fields = layerFields(l.id), hasPoly = fs.some(f => f.type === 'polygon');
  const opts = (sel, none) => `<option value="">${none}</option><option value="__name" ${sel === '__name' ? 'selected' : ''}>Nombre</option>${hasPoly ? `<option value="__area" ${sel === '__area' ? 'selected' : ''}>Área (ha)</option>` : ''}${fields.map(k => `<option value="${esc(k)}" ${sel === k ? 'selected' : ''}>${esc(k)}</option>`).join('')}`;
  const others = [...S.layers.values()].filter(x => x.id !== l.id);
  const r = await dialog({
    title: 'Capa: ' + l.name, body: `
      <label>Nombre de la capa<input id="lsN" value="${esc(l.name)}"></label>
      <label>Etiquetas en el mapa<select id="lsL">${opts(l.label || '', 'Sin etiquetas')}</select></label>
      <label>Colorear según<select id="lsS">${opts(l.styleBy || '', 'Un solo color')}</select></label>
      <label>Mostrar etiquetas<select id="lsZ">${LBL_Z.map(([z, t]) => `<option value="${z}" ${(l.labelZoom ?? 15) === z ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <p class="mut">Si el campo es numérico (p. ej. % de infestación) se usa una escala de verde a rojo en 5 rangos; si es texto, un color por categoría.</p>
      ${others.length ? `<label>Mover todos sus elementos a<select id="lsM"><option value="">— no mover —</option>${others.map(o => `<option value="${o.id}">${esc(o.name)}</option>`).join('')}</select></label>` : ''}`,
    stack: true,
    buttons: [{label: 'Guardar', cls: 'pri', value: d => ({name: d.querySelector('#lsN').value.trim() || l.name, label: d.querySelector('#lsL').value, labelZoom: +d.querySelector('#lsZ').value, styleBy: d.querySelector('#lsS').value, move: d.querySelector('#lsM')?.value || ''})},
      {label: '★ Usar como capa activa', value: 'active'}, {label: l.id === 'mis-datos' ? 'Vaciar capa' : 'Eliminar capa', cls: 'dan', value: 'del'}, {label: 'Cancelar', value: null}]
  });
  if (!r) return;
  if (r === 'active') { setActiveLayer(l.id); toast(`Capa activa: ${l.name}`); return openLayers(); }
  if (r === 'del') {
    const own = l.id === 'mis-datos';
    if (!await confirmDlg(own ? 'Vaciar capa' : 'Eliminar capa', own ? `¿Borrar los ${fs.length} elementos de “Mis datos”? Exporta antes si los necesitas.` : `¿Quitar la capa “${esc(l.name)}” y sus ${fs.length} elementos?`, own ? 'Vaciar' : 'Eliminar', 'dan')) return openLayers();
    await deleteFeatures(fs.map(f => f.id));
    if (!own) { S.layers.delete(l.id); groups.get(l.id)?.remove(); groups.delete(l.id); await Store.del('layers', l.id).catch(() => {}); if (S.activeLayer === l.id) setActiveLayer('mis-datos'); }
    return openLayers();
  }
  Object.assign(l, {name: r.name, label: r.label, labelZoom: r.labelZoom, styleBy: r.styleBy}); await saveLayer(l); refreshLayer(l.id); updLblZoom();
  if (r.move) { fs.forEach(f => { f.layer = r.move; }); await addFeatures(fs); refreshLayer(r.move); toast(`${fs.length} elementos movidos`); }
  openLayers();
}

/* ---------- Importación ---------- */
const T = (el, n) => Array.from(el.getElementsByTagNameNS('*', n));
const child = (el, n) => { const c = Array.from(el.children).find(x => x.localName === n); return c ? c.textContent.trim() : ''; };
function xmlDoc(text) { const d = new DOMParser().parseFromString(text, 'application/xml'); if (d.getElementsByTagName('parsererror').length) throw new Error('El archivo no es un XML válido'); return d; }
function stripHtml(s) { if (!/[<&]/.test(s)) return s; const d = new DOMParser().parseFromString(s, 'text/html'); return (d.body.innerText || d.body.textContent || '').trim(); }
function kmlCoords(s) {
  return s.trim().split(/\s+/).map(t => t.split(',').map(Number)).filter(a => a.length >= 2 && isFinite(a[0]) && isFinite(a[1])).map(a => [a[1], a[0], isFinite(a[2]) ? a[2] : null, null]);
}
function parseKML(text) {
  const doc = xmlDoc(text), out = [];
  for (const pm of T(doc, 'Placemark')) {
    const name = child(pm, 'name');
    const desc = stripHtml(child(pm, 'description')), props = {};
    T(pm, 'Data').forEach(d => { props[d.getAttribute('name')] = child(d, 'value'); });
    T(pm, 'SimpleData').forEach(d => { props[d.getAttribute('name')] = d.textContent.trim(); });
    const g = [];
    T(pm, 'Point').forEach(e => { const c = kmlCoords(child(e, 'coordinates')); if (c.length) g.push({type: 'point', coords: [c[0]]}); });
    T(pm, 'LineString').forEach(e => g.push({type: 'line', coords: kmlCoords(child(e, 'coordinates'))}));
    T(pm, 'Polygon').forEach(e => { const ob = T(e, 'outerBoundaryIs')[0] || e; const c = T(ob, 'coordinates')[0]; if (c) g.push({type: 'polygon', coords: kmlCoords(c.textContent), holes: T(e, 'innerBoundaryIs').map(ib => T(ib, 'coordinates')[0]).filter(Boolean).map(x => kmlCoords(x.textContent))}); });
    T(pm, 'Track').forEach(e => { const c = T(e, 'coord').map(x => x.textContent.trim().split(/\s+/).map(Number)).filter(a => a.length >= 2).map(a => [a[1], a[0], isFinite(a[2]) ? a[2] : null, null]); if (c.length) g.push({type: 'line', coords: c}); });
    g.forEach((x, i) => out.push({name: g.length > 1 ? `${name || 'Elemento'} (${i + 1})` : name, desc, props: {...props}, ...x}));
  }
  return out;
}
function parseGPX(text) {
  const doc = xmlDoc(text), out = [];
  const pt = e => { const ele = T(e, 'ele')[0], tm = T(e, 'time')[0]; return [parseFloat(e.getAttribute('lat')), parseFloat(e.getAttribute('lon')), ele ? parseFloat(ele.textContent) : null, tm ? Date.parse(tm.textContent) || null : null]; };
  T(doc, 'wpt').forEach(w => out.push({type: 'point', name: child(w, 'name'), desc: child(w, 'desc') || child(w, 'cmt'), coords: [pt(w)]}));
  T(doc, 'trk').forEach(t => {
    const segs = T(t, 'trkseg'), isPoly = child(t, 'type') === 'polygon';
    segs.forEach((s, i) => { const c = T(s, 'trkpt').map(pt); if (c.length > 1) out.push({type: isPoly ? 'polygon' : 'line', name: (child(t, 'name') || 'Track') + (segs.length > 1 ? ` (${i + 1})` : ''), desc: child(t, 'desc'), coords: c}); });
  });
  T(doc, 'rte').forEach(r => { const c = T(r, 'rtept').map(pt); if (c.length > 1) out.push({type: 'line', name: child(r, 'name') || 'Ruta', desc: child(r, 'desc'), coords: c}); });
  return out;
}
function parseGeoJSON(gj, forceSrc) {
  const out = [], crsName = JSON.stringify(gj.crs || '');
  const src = forceSrc || (/9377/.test(crsName) ? 'EPSG:9377' : /3116/.test(crsName) ? 'EPSG:3116' : null);
  const P = c => { let [x, y] = c; if (src) [x, y] = proj4(src, 'EPSG:4326', [x, y]); return [y, x, c[2] ?? null, null]; };
  const feats = gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : [{type: 'Feature', properties: {}, geometry: gj}];
  for (const ft of feats) {
    const pr = ft.properties || {};
    const nk = Object.keys(pr).find(k => /^(name|nombre|nom|label)$/i.test(k));
    const name = nk ? String(pr[nk]) : '';
    const props = Object.fromEntries(Object.entries(pr).filter(([k, v]) => k !== nk && v != null && typeof v !== 'object'));
    const dk = Object.keys(props).find(k => /^(descripcion|description|desc)$/i.test(k)); const desc = dk ? String(props[dk]) : '';
    const add = (type, coords, holes) => out.push({type, name, desc, props, coords, holes});
    const walk = g => {
      if (!g) return;
      switch (g.type) {
        case 'Point': add('point', [P(g.coordinates)]); break;
        case 'MultiPoint': g.coordinates.forEach(c => add('point', [P(c)])); break;
        case 'LineString': add('line', g.coordinates.map(P)); break;
        case 'MultiLineString': g.coordinates.forEach(l => add('line', l.map(P))); break;
        case 'Polygon': add('polygon', g.coordinates[0].map(P), g.coordinates.slice(1).map(h => h.map(P))); break;
        case 'MultiPolygon': g.coordinates.forEach(p => add('polygon', p[0].map(P), p.slice(1).map(h => h.map(P)))); break;
        case 'GeometryCollection': g.geometries.forEach(walk); break;
      }
    };
    walk(ft.geometry);
  }
  return out;
}
/* CSV: delimitador automático (; , tab |), coma decimal, grados-minutos-segundos y coordenadas planas */
const norm = s => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
function detectDelim(line) { const c = {';': 0, '\t': 0, ',': 0, '|': 0}; let q = false; for (const ch of line) { if (ch === '"') q = !q; else if (!q && ch in c) c[ch]++; } if (c[';']) return ';'; if (c['\t']) return '\t'; if (c['|'] && !c[',']) return '|'; return ','; }
function splitLine(line, d) { const out = []; let cur = '', q = false; for (let i = 0; i < line.length; i++) { const ch = line[i]; if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; } else if (ch === '"') q = true; else if (ch === d) { out.push(cur); cur = ''; } else cur += ch; } out.push(cur); return out.map(s => s.trim()); }
function parseDMS(s) {
  const neg = /[SWO]/i.test(s.replace(/[0-9.,°º'"´’”\s-]/g, '')) || /^\s*-/.test(s);
  const nums = (s.replace(/,/g, '.').match(/\d+(\.\d+)?/g) || []).map(Number);
  if (!nums.length) return NaN;
  const v = nums[0] + (nums[1] || 0) / 60 + (nums[2] || 0) / 3600; return neg ? -v : v;
}
function parseNum(s) {
  if (s == null) return NaN; s = String(s).trim(); if (!s) return NaN;
  if (/[°º'"´’”]|[NSEWO]\s*$|^[NSEWO]/i.test(s) && /\d/.test(s)) return parseDMS(s);
  s = s.replace(/\s/g, '');
  if (/^[-+]?\d{1,3}(\.\d{3}){2,}(,\d+)?$/.test(s) || /^[-+]?\d{1,3}(\.\d{3})+,\d+$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^[-+]?\d+,\d+$/.test(s)) s = s.replace(',', '.');
  else if (/^[-+]?\d{1,3}(,\d{3}){2,}(\.\d+)?$/.test(s) || /^[-+]?\d{1,3}(,\d{3})+\.\d+$/.test(s)) s = s.replace(/,/g, '');
  return s === '' ? NaN : Number(s);
}
function guessCRS(xs, ys) {
  const ok = xs.filter((x, i) => isFinite(x) && isFinite(ys[i])); if (!ok.length) return 'EPSG:4326';
  const mx = ok.reduce((a, b) => a + Math.abs(b), 0) / ok.length;
  if (mx <= 180) return 'EPSG:4326';
  if (mx > 3e6 && mx < 7e6) return 'EPSG:9377';
  return 'EPSG:3116';
}
async function readTextSmart(file) {
  const buf = await file.arrayBuffer();
  try { return new TextDecoder('utf-8', {fatal: true}).decode(buf); } catch (e) { return new TextDecoder('windows-1252').decode(buf); }
}
async function csvWizard(fname, text) {
  text = text.replace(/^﻿/, '');
  const lines = text.split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 1) throw new Error('El CSV está vacío');
  const d = detectDelim(lines[0]);
  let rows = lines.map(l => splitLine(l, d));
  const ncol = Math.max(...rows.slice(0, 20).map(r => r.length));
  const numericFirst = rows[0].filter(v => isFinite(parseNum(v))).length;
  const hasHeader = numericFirst < Math.ceil(rows[0].length / 2);
  const header = hasHeader ? rows[0].map((h, i) => h || `Columna ${i + 1}`) : Array.from({length: ncol}, (_, i) => `Columna ${i + 1}`);
  if (hasHeader) rows = rows.slice(1);
  const H = header.map(norm);
  const find = pats => H.findIndex(h => pats.some(p => p instanceof RegExp ? p.test(h) : h === p));
  let iy = find([/^lat/, 'y', 'norte', 'north', 'northing', 'coordy', 'ycoord', 'coordenaday', 'n']);
  let ix = find([/^lon/, /^lng/, 'long', 'x', 'este', 'east', 'easting', 'coordx', 'xcoord', 'coordenadax', 'e']);
  const iname = find(['nombre', 'name', 'id', 'codigo', 'cod', 'punto', 'pto', 'lote', 'predio', 'label', 'etiqueta', 'finca', 'vertice']);
  const numCols = header.map((_, i) => i).filter(i => rows.slice(0, 20).filter(r => isFinite(parseNum(r[i]))).length >= Math.min(rows.length, 20) * .8);
  if ((ix < 0 || iy < 0) && numCols.length >= 2) {
    const [a, b] = numCols.filter(i => i !== iname);
    const mean = i => rows.slice(0, 20).reduce((s, r) => s + Math.abs(parseNum(r[i]) || 0), 0);
    if (mean(a) >= mean(b)) { ix = a; iy = b; } else { ix = b; iy = a; }
  }
  const crs0 = ix >= 0 && iy >= 0 ? guessCRS(rows.slice(0, 50).map(r => parseNum(r[ix])), rows.slice(0, 50).map(r => parseNum(r[iy]))) : 'EPSG:4326';
  const opt = (sel, none) => (none ? `<option value="-1">— ninguna —</option>` : '') + header.map((h, i) => `<option value="${i}" ${i === sel ? 'selected' : ''}>${esc(h)}</option>`).join('');
  const prev = `<div class="prev"><table><tr>${header.map(h => `<td>${esc(h)}</td>`).join('')}</tr>${rows.slice(0, 5).map(r => `<tr>${header.map((_, i) => `<td>${esc(r[i] ?? '')}</td>`).join('')}</tr>`).join('')}</table></div>`;
  const cfg = await dialog({
    title: 'Importar CSV', body: `<div class="mut">${esc(fname)} · ${rows.length} filas · separador “${d === '\t' ? 'tab' : d}”</div>${prev}
      <label>Columna X / Longitud / Este<select id="cX">${opt(ix)}</select></label>
      <label>Columna Y / Latitud / Norte<select id="cY">${opt(iy)}</select></label>
      <label>Columna de nombre<select id="cN">${opt(iname, true)}</select></label>
      <label>Sistema de coordenadas<select id="cC">${Object.entries(CRS).map(([k, v]) => `<option value="${k}" ${k === crs0 ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label>Crear como<select id="cA"><option value="points">Puntos (uno por fila)</option><option value="polygon">Un polígono con todas las filas (en orden)</option><option value="line">Una línea con todas las filas (en orden)</option><option value="pgroup">Polígonos agrupados por la columna de nombre</option><option value="lgroup">Líneas agrupadas por la columna de nombre</option></select></label>`,
    buttons: [{label: 'Cancelar', value: null}, {label: 'Importar', cls: 'pri', value: dl => ({x: +dl.querySelector('#cX').value, y: +dl.querySelector('#cY').value, n: +dl.querySelector('#cN').value, crs: dl.querySelector('#cC').value, as: dl.querySelector('#cA').value})}]
  });
  if (!cfg) return null;
  let bad = 0; const pts = [];
  rows.forEach((r, k) => {
    let x = parseNum(r[cfg.x]), y = parseNum(r[cfg.y]);
    if (!isFinite(x) || !isFinite(y)) { bad++; return; }
    if (cfg.crs !== 'EPSG:4326') [x, y] = proj4(cfg.crs, 'EPSG:4326', [x, y]);
    if (Math.abs(y) > 90 || Math.abs(x) > 180) { bad++; return; }
    const props = {}; header.forEach((h, i) => { if (i !== cfg.x && i !== cfg.y && i !== cfg.n && r[i] !== undefined && r[i] !== '') props[h] = r[i]; });
    pts.push({c: [y, x, null, null], name: cfg.n >= 0 ? r[cfg.n] : `Punto ${k + 1}`, props});
  });
  if (bad) toast(`${bad} filas sin coordenadas válidas se omitieron`, 4000);
  const base = fname.replace(/\.[^.]+$/, '');
  if (cfg.as === 'points') return pts.map(p => ({type: 'point', name: p.name, desc: '', props: p.props, coords: [p.c]}));
  if (cfg.as === 'polygon' || cfg.as === 'line') return pts.length ? [{type: cfg.as, name: base, desc: '', coords: pts.map(p => p.c)}] : [];
  const grp = new Map(); pts.forEach(p => { const k = cfg.n >= 0 ? p.name : base; if (!grp.has(k)) grp.set(k, []); grp.get(k).push(p.c); });
  return [...grp].map(([k, cs]) => ({type: cfg.as === 'pgroup' ? 'polygon' : 'line', name: k, desc: '', coords: cs}));
}
function cleanFeature(f) {
  f.coords = (f.coords || []).filter(c => c && isFinite(c[0]) && isFinite(c[1]) && Math.abs(c[0]) <= 90 && Math.abs(c[1]) <= 180);
  const openRing = cs => { if (cs.length > 1) { const a = cs[0], b = cs[cs.length - 1]; if (a[0] === b[0] && a[1] === b[1]) cs.pop(); } return cs; };
  if (f.type === 'polygon') { openRing(f.coords); f.holes = (f.holes || []).map(h => openRing(h.filter(c => c && isFinite(c[0]) && isFinite(c[1])))).filter(h => h.length >= 3); if (!f.holes.length) delete f.holes; } else delete f.holes;
  if (f.props && !Object.keys(f.props).length) delete f.props;
  const min = {point: 1, line: 2, polygon: 3}[f.type];
  if (f.type === 'polygon' && f.coords.length === 2) f.type = 'line';
  return f.coords.length >= min || (f.type === 'line' && f.coords.length >= 2);
}
const IMPORTERS = [];   // módulos: {match(ext, file, all) → bool, run(file, all) → features[] | null (null = ya se manejó)}
async function importFile(file, all = [file], layerName) {
  const ext = file.name.split('.').pop().toLowerCase();
  let feats;
  try {
    const imp = IMPORTERS.find(m => m.match(ext, file, all));
    if (imp) { feats = await imp.run(file, all); if (!feats) return; } else
    if (ext === 'kml') feats = parseKML(await readTextSmart(file));
    else if (ext === 'kmz') {
      const zip = await JSZip.loadAsync(file);
      const k = Object.keys(zip.files).find(n => n.toLowerCase().endsWith('.kml'));
      if (!k) throw new Error('El KMZ no contiene un archivo .kml');
      feats = parseKML(await zip.file(k).async('string'));
    }
    else if (ext === 'gpx') feats = parseGPX(await readTextSmart(file));
    else if (ext === 'geojson' || ext === 'json') feats = parseGeoJSON(JSON.parse(await readTextSmart(file)));
    else if (ext === 'csv' || ext === 'txt') { feats = await csvWizard(file.name, await readTextSmart(file)); if (!feats) return; }
    else throw new Error(`Formato .${ext} no soportado. Usa KML, KMZ, GPX, CSV, GeoJSON, Shapefile (.zip), PDF georreferenciado, GeoTIFF o imagen con archivo de georreferencia.`);
  } catch (err) { await dialog({title: 'No se pudo importar', body: `<p><b>${esc(file.name)}</b></p><p>${esc(err.message)}</p>`}); return; }
  await addImportedLayer(layerName || file.name, feats);
}
async function addImportedLayer(name, feats, quiet) {
  feats = feats.filter(cleanFeature);
  if (!feats.length) { if (!quiet) toast(`No se encontraron elementos en ${name}`, 4000); return null; }
  const l = {id: uid(), name, color: PALETTE[S.layers.size % PALETTE.length], visible: true, order: Date.now()};
  await saveLayer(l);
  const now = Date.now();
  feats.forEach((f, i) => { f.id = uid() + i; f.layer = l.id; f.created = now; f.name = f.name || `${TYPE[f.type]} ${i + 1}`; });
  await addFeatures(feats);
  closeSheet(); zoomTo(feats);
  const c = t => feats.filter(f => f.type === t).length;
  const hasProps = feats.some(f => f.props && Object.keys(f.props).length);
  toast(`${name}: ${c('point')} puntos, ${c('line')} líneas, ${c('polygon')} polígonos${hasProps ? '. Para etiquetarlos con una columna: Capas ▸ 🏷' : ''}`, 5000);
  return l;
}
$('#file').onchange = async e => {
  const files = [...e.target.files]; e.target.value = '';
  const aux = /\.(jgw|pgw|tfw|wld|j2w|pngw|jpgw|tifw|prj|aux|xml|qmd)$/i;   // archivos acompañantes (se usan junto al principal)
  for (const f of files) if (!aux.test(f.name)) await importFile(f, files);
};

/* ---------- Exportación ---------- */
const photoFile = (f, i, id) => `${String(f.name || 'foto').replace(/[^\w\-áéíóúñÁÉÍÓÚÑ]+/g, '_').slice(0, 40)}_${i + 1}_${id.slice(-4)}.jpg`;
const KML_EXTRA = [];   // módulos: f => html extra para la descripción KML (p. ej. fotos)
const kmlColor = (hex, a) => a + hex.slice(5, 7) + hex.slice(3, 5) + hex.slice(1, 3);
const ring = f => f.type === 'polygon' ? [...f.coords, f.coords[0]] : f.coords;
const iso = t => t ? new Date(t).toISOString() : null;
function metrics(f) {
  if (f.type === 'polygon') return {area_ha: +(fArea(f) / 1e4).toFixed(4), perimetro_m: +fPerim(f).toFixed(2)};
  if (f.type === 'line') return {longitud_m: +lengthM(f.coords).toFixed(2)};
  return f.acc ? {precision_m: +f.acc.toFixed(1)} : {};
}
function toKML(fs, title) {
  const lids = [...new Set(fs.map(f => f.layer))];
  const styles = lids.map(id => { const c = S.layers.get(id)?.color || '#e8590c'; return `<Style id="s${id}"><IconStyle><color>${kmlColor(c, 'ff')}</color><scale>1</scale></IconStyle><LineStyle><color>${kmlColor(c, 'ff')}</color><width>3</width></LineStyle><PolyStyle><color>${kmlColor(c, '40')}</color></PolyStyle></Style>`; }).join('');
  const cs = f => ring(f).map(c => `${c[1]},${c[0]}${c[2] != null ? ',' + c[2] : ''}`).join(' ');
  const pm = f => {
    const m = metrics(f);
    const hs = (f.holes || []).map(h => `<innerBoundaryIs><LinearRing><coordinates>${[...h, h[0]].map(c => `${c[1]},${c[0]}`).join(' ')}</coordinates></LinearRing></innerBoundaryIs>`).join('');
    const geo = f.type === 'point' ? `<Point><coordinates>${cs(f)}</coordinates></Point>` : f.type === 'line' ? `<LineString><tessellate>1</tessellate><coordinates>${cs(f)}</coordinates></LineString>` : `<Polygon><outerBoundaryIs><LinearRing><coordinates>${cs(f)}</coordinates></LinearRing></outerBoundaryIs>${hs}</Polygon>`;
    const data = {...(f.props || {}), ...m};
    const extra = KML_EXTRA.map(fn => fn(f)).join('');
    return `<Placemark><name>${esc(f.name)}</name>${f.desc || extra ? `<description>${extra ? `<![CDATA[${esc(f.desc || '')}${extra}]]>` : esc(f.desc)}</description>` : ''}<styleUrl>#s${f.layer}</styleUrl><ExtendedData>${Object.entries(data).map(([k, v]) => `<Data name="${esc(k)}"><value>${esc(v)}</value></Data>`).join('')}</ExtendedData>${geo}</Placemark>`;
  };
  const folders = lids.map(id => `<Folder><name>${esc(S.layers.get(id)?.name || 'Capa')}</name>${fs.filter(f => f.layer === id).map(pm).join('\n')}</Folder>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<kml xmlns="http://www.opengis.net/kml/2.2"><Document><name>${esc(title)}</name>${styles}\n${folders}\n</Document></kml>`;
}
function toGPX(fs) {
  const pt = (tag, c) => `<${tag} lat="${c[0]}" lon="${c[1]}">${c[2] != null ? `<ele>${c[2]}</ele>` : ''}${c[3] ? `<time>${iso(c[3])}</time>` : ''}</${tag}>`;
  const w = fs.filter(f => f.type === 'point').map(f => { const c = f.coords[0]; return `<wpt lat="${c[0]}" lon="${c[1]}">${c[2] != null ? `<ele>${c[2]}</ele>` : ''}${c[3] ? `<time>${iso(c[3])}</time>` : ''}<name>${esc(f.name)}</name>${f.desc ? `<desc>${esc(f.desc)}</desc>` : ''}</wpt>`; });
  const t = fs.filter(f => f.type !== 'point').map(f => `<trk><name>${esc(f.name)}</name>${f.desc ? `<desc>${esc(f.desc)}</desc>` : ''}<type>${f.type}</type><trkseg>${ring(f).map(c => pt('trkpt', c)).join('')}</trkseg></trk>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="GeoCampo" xmlns="http://www.topografix.com/GPX/1/1">\n${w.join('\n')}\n${t.join('\n')}\n</gpx>`;
}
function geoJSONObj(fs, z = true) {
  return {type: 'FeatureCollection', features: fs.map(f => {
    const c = x => z && x[2] != null ? [x[1], x[0], x[2]] : [x[1], x[0]];
    const geometry = f.type === 'point' ? {type: 'Point', coordinates: c(f.coords[0])} : f.type === 'line' ? {type: 'LineString', coordinates: f.coords.map(c)} : {type: 'Polygon', coordinates: [ring(f).map(c), ...(f.holes || []).map(h => [...h, h[0]].map(c))]};
    return {type: 'Feature', properties: {nombre: f.name, descripcion: f.desc || '', capa: S.layers.get(f.layer)?.name || '', tipo: f.type, ...(f.props || {}), ...metrics(f), ...(f.photos?.length ? {fotos: f.photos.map((id, i) => photoFile(f, i, id)).join(';')} : {})}, geometry};
  })};
}
function toGeoJSON(fs) { return JSON.stringify(geoJSONObj(fs), null, 1); }
function toCSV(fs, sep, dec) {
  const n = (v, d) => v == null || !isFinite(v) ? '' : v.toFixed(d).replace('.', dec);
  const q = v => { v = String(v ?? ''); return /["\n\r]/.test(v) || v.includes(sep) ? `"${v.replace(/"/g, '""')}"` : v; };
  const pk = [...new Set(fs.flatMap(f => Object.keys(f.props || {})))];
  const out = [['capa', 'nombre', 'tipo', 'anillo', 'vertice', 'latitud', 'longitud', 'altitud_m', 'este_9377', 'norte_9377', 'area_ha', 'perimetro_m', 'longitud_m', 'precision_m', 'fecha_hora', 'descripcion', 'fotos', ...pk].map(q).join(sep)];
  fs.forEach(f => {
    const m = metrics(f), ly = S.layers.get(f.layer)?.name || '';
    const rings = [['exterior', f.coords], ...(f.holes || []).map((h, i) => [`hueco ${i + 1}`, h])];
    rings.forEach(([rn, cs]) => cs.forEach((c, i) => {
      const {e, n: no} = toCTM(c[0], c[1]);
      out.push([q(ly), q(f.name), f.type, f.type === 'polygon' ? rn : '', i + 1, n(c[0], 7), n(c[1], 7), n(c[2], 1), n(e, 2), n(no, 2), n(m.area_ha, 4), n(m.perimetro_m, 2), n(m.longitud_m, 2), n(f.acc, 1), c[3] ? q(new Date(c[3]).toLocaleString('es-CO')) : '', q(f.desc), q((f.photos || []).map((id, i) => photoFile(f, i, id)).join(';')), ...pk.map(k => q(f.props?.[k]))].join(sep));
    }));
  });
  return '﻿' + out.join('\r\n');
}
const EXPORTERS = [];   // módulos: {id, label, build(fs, title) → {blob, ext}}
async function buildExport(fs, fmtId, title) {
  switch (fmtId) {
    case 'kml': return {blob: new Blob([toKML(fs, title)], {type: 'application/vnd.google-earth.kml+xml'}), ext: 'kml'};
    case 'kmz': { const z = new JSZip(); z.file('doc.kml', toKML(fs, title)); return {blob: await z.generateAsync({type: 'blob', compression: 'DEFLATE', mimeType: 'application/vnd.google-earth.kmz'}), ext: 'kmz'}; }
    case 'gpx': return {blob: new Blob([toGPX(fs)], {type: 'application/gpx+xml'}), ext: 'gpx'};
    case 'geojson': return {blob: new Blob([toGeoJSON(fs)], {type: 'application/geo+json'}), ext: 'geojson'};
    case 'csv': return {blob: new Blob([toCSV(fs, ',', '.')], {type: 'text/csv'}), ext: 'csv'};
    case 'csvx': return {blob: new Blob([toCSV(fs, ';', ',')], {type: 'text/csv'}), ext: 'csv'};
    default: { const x = EXPORTERS.find(e => e.id === fmtId); return x.build(fs, title); }
  }
}
function blobToB64(blob) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1]); r.onerror = () => rej(r.error); r.readAsDataURL(blob); }); }
async function nativeShare(blob, name) {
  const w = await FS.writeFile({path: name, data: await blobToB64(blob), directory: 'CACHE'});
  try { await SH.share({title: name, files: [w.uri], dialogTitle: 'Enviar ' + name}); }
  catch (e) { if (!/cancel/i.test(e.message || '')) toast('No se pudo compartir: ' + (e.message || e), 4000); }
}
async function nativeSave(blob, name) {
  try {
    await FS.writeFile({path: 'GeoCampo/' + name, data: await blobToB64(blob), directory: 'DOCUMENTS', recursive: true});
    dialog({title: 'Archivo guardado', body: `<p>Quedó en la carpeta del celular:</p><p><b>Documentos / GeoCampo / ${esc(name)}</b></p><p class="mut">Lo encuentras con la app “Archivos” del celular.</p>`});
  } catch (e) { toast('No se pudo guardar en Documentos; se abrirá Compartir', 3500); await nativeShare(blob, name); }
}
function download(blob, name) {
  if (CAP) return nativeSave(blob, name); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 3000); }
async function shareFile(blob, name) {
  if (CAP) return nativeShare(blob, name);
  const file = new File([blob], name, {type: blob.type});
  if (navigator.canShare && navigator.canShare({files: [file]})) {
    try { await navigator.share({files: [file], title: name}); } catch (e) { if (e.name !== 'AbortError') { toast('No se pudo compartir; se descargará'); download(blob, name); } }
  } else { toast('Este formato no se puede compartir directo; se descargó. Compártelo desde Descargas.', 4500); download(blob, name); }
}
async function openExport() {
  if (!S.features.size) return toast('No hay elementos para exportar');
  const fmts = [['kml', 'KML (Google Earth, Avenza, QGIS)'], ['kmz', 'KMZ (KML comprimido)'], ['gpx', 'GPX (GPS Garmin y apps)'], ['geojson', 'GeoJSON (QGIS)'], ['csv', 'CSV con comas (QGIS)'], ['csvx', 'CSV con punto y coma (Excel en español)'], ...EXPORTERS.map(e => [e.id, e.label])];
  const read = (d, act) => ({scope: d.querySelector('#eS').value, fmt: d.querySelector('#eF').value, act});
  const r = await dialog({
    title: 'Exportar', body: `<label>Qué exportar<select id="eS"><option value="all">Todas las capas</option>${[...S.layers.values()].map(l => `<option value="${l.id}">${esc(l.name)}</option>`).join('')}</select></label><label>Formato<select id="eF">${fmts.map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>`,
    buttons: [{label: 'Cancelar', value: null}, {label: 'Compartir', value: d => read(d, 'share')}, {label: 'Descargar', cls: 'pri', value: d => read(d, 'dl')}]
  });
  if (!r) return;
  const fs = [...S.features.values()].filter(f => r.scope === 'all' || f.layer === r.scope);
  if (!fs.length) return toast('Esa capa está vacía');
  const title = r.scope === 'all' ? 'GeoCampo' : S.layers.get(r.scope).name.replace(/\.[^.]+$/, '');
  let built; try { built = await buildExport(fs, r.fmt, title); } catch (e) { return dialog({title: 'No se pudo exportar', body: `<p>${esc(e.message || e)}</p>`}); }
  if (!built) return;
  const {blob, ext} = built;
  const d = new Date(), p = v => String(v).padStart(2, '0');
  const name = `${title.replace(/[^\w\-áéíóúñÁÉÍÓÚÑ]+/g, '_')}_${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}.${ext}`;
  r.act === 'share' ? shareFile(blob, name) : download(blob, name);
}

/* ---------- Ajustes y menú ---------- */
async function openSettings() {
  const s = S.settings;
  const r = await dialog({
    title: 'Ajustes', body: `
      <label>Precisión máxima aceptada (m)<input id="sA" type="number" min="1" step="1" value="${s.maxAcc}"></label>
      <label>Al grabar automático, tomar un punto según<select id="sB">
        <option value="dist" ${s.captureBy === 'dist' ? 'selected' : ''}>Distancia recorrida</option>
        <option value="time" ${s.captureBy === 'time' ? 'selected' : ''}>Tiempo transcurrido</option>
        <option value="both" ${s.captureBy === 'both' ? 'selected' : ''}>Distancia y tiempo (deben cumplirse ambos)</option></select></label>
      <label>Distancia entre puntos (m)<input id="sD" type="number" min="0" step="0.5" value="${s.minDist}"></label>
      <label>Tiempo entre puntos (segundos)<input id="sT" type="number" min="1" step="1" value="${s.minTime}"></label>
      <p class="mut">Sugerencia para lotes: 2–3 m caminando. Por tiempo, 3–5 s. Valores muy bajos agregan “ruido” del GPS al borde.</p>
      <label>Segundos para promediar<input id="sP" type="number" min="3" step="1" value="${s.avgSecs}"></label>
      <label>Promediar también cada vértice GPS manual<select id="sV"><option value="0">No</option><option value="1" ${s.vtxAvg ? 'selected' : ''}>Sí</option></select></label>
      <label>Escribir fecha, hora y coordenadas sobre las fotos<select id="sF"><option value="1">Sí</option><option value="0" ${s.photoStamp === false ? 'selected' : ''}>No (solo en los datos EXIF)</option></select></label>`,
    buttons: [{label: 'Cancelar', value: null}, {label: 'Guardar', cls: 'pri', value: d => ({maxAcc: Math.max(1, +d.querySelector('#sA').value || 15), minDist: Math.max(0, +d.querySelector('#sD').value || 0), minTime: Math.max(1, +d.querySelector('#sT').value || 5), captureBy: d.querySelector('#sB').value, avgSecs: Math.max(3, +d.querySelector('#sP').value || 10), vtxAvg: d.querySelector('#sV').value === '1', photoStamp: d.querySelector('#sF').value === '1'})}]
  });
  if (r) { Object.assign(S.settings, r); Store.set('settings', S.settings); updateGpsPanel(); toast('Ajustes guardados'); }
}
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; });
const INIT_HOOKS = [];   // módulos: async () => {} al iniciar, después de cargar datos
const MORE_ITEMS = [];   // módulos: {label, run}
function openMore() {
  const sh = openSheet(`<h3>Archivos y ajustes</h3><div class="menu col">
    <button class="btn pri" id="mImp">⬆ Importar datos o mapa (KML, KMZ, GPX, CSV, GeoJSON, Shapefile .zip, PDF/GeoTIFF/imagen georreferenciada)</button>
    <button class="btn" id="mExp">⬇ Exportar datos</button>
    ${MORE_ITEMS.map((m, i) => `<button class="btn" data-mi="${i}">${m.label}</button>`).join('')}
    <button class="btn" id="mSet">⚙ Ajustes (captura y fotos)</button>
    ${installEvt ? '<button class="btn" id="mIns">📲 Instalar como app</button>' : ''}
    <button class="btn" id="mHelp">? Ayuda</button></div>`);
  sh.querySelector('#mImp').onclick = () => $('#file').click();
  sh.querySelectorAll('[data-mi]').forEach(b => b.onclick = () => { closeSheet(); MORE_ITEMS[+b.dataset.mi].run(); });
  sh.querySelector('#mExp').onclick = () => { closeSheet(); openExport(); };
  sh.querySelector('#mSet').onclick = () => { closeSheet(); openSettings(); };
  const ins = sh.querySelector('#mIns'); if (ins) ins.onclick = async () => { closeSheet(); installEvt.prompt(); await installEvt.userChoice; installEvt = null; };
  sh.querySelector('#mHelp').onclick = () => { closeSheet(); dialog({title: 'Ayuda rápida', body: `
    <p><b>Punto:</b> toma la coordenada del GPS, promediando varias lecturas (más preciso) o del centro del mapa (cruz).</p>
    <p><b>Track / Polígono:</b> en modo automático la app agrega un punto cada vez que te mueves la distancia mínima, solo si la precisión está dentro del límite. En modo manual agregas cada vértice. También puedes dibujar sobre el mapa.</p>
    <p><b>Área:</b> se calcula sobre el elipsoide con una proyección local, en hectáreas y m² (descontando huecos).</p>
    <p><b>Foto:</b> queda como punto en la capa activa, con fecha, hora y coordenadas escritas sobre la imagen y en sus datos EXIF (QGIS las ubica con “Importar fotos geoetiquetadas”). En la ficha de cualquier elemento puedes agregarle más fotos.</p>
    <p><b>Ficha de un elemento:</b> Ir aquí (flecha y distancia), Editar vértices, Recortar hueco, Buffer / retiro y Reporte PDF.</p>
    <p><b>Capas:</b> ★ marca la capa activa (donde se guarda lo nuevo); crea una por finca o visita. Con ⚙ eliges etiquetas y colores por atributo.</p>
    <p><b>Sin internet:</b> en Archivos ▸ Mapas sin conexión descarga la zona antes de salir. Puedes cargar mapas propios: PDF georreferenciado, GeoTIFF, JPG/PNG con su .jgw/.pgw (selecciónalos juntos) o KMZ con imagen.</p>
    <p><b>Coordenadas:</b> WGS84 y MAGNA-SIRGAS Origen Nacional (EPSG:9377). Toca el recuadro superior para ver grados-minutos-segundos.</p>
    ${CAP ? '<p><b>Grabar con pantalla apagada:</b> al iniciar un track o polígono con GPS aparece una notificación “GeoCampo está grabando”; mientras esté, puedes apagar la pantalla o guardar el celular. Si el celular tiene ahorro de batería agresivo, excluye a GeoCampo en Ajustes ▸ Batería.</p>' : '<p><b>Importante:</b> en la versión web deja la pantalla encendida mientras grabas; Android pausa el GPS de las páginas web con la pantalla apagada. La app instalada (APK) no tiene esta limitación.</p>'}
    <p class="mut">Tus datos se guardan solo en este celular. Exporta con frecuencia como respaldo.</p>`}); };
}
document.querySelectorAll('#bar button').forEach(b => b.onclick = () => {
  const a = b.dataset.act;
  if (a === 'point') newPoint(); else if (a === 'photo') takePhoto(); else if (a === 'line' || a === 'polygon') startDrawing(a); else if (a === 'layers') openLayers(); else openMore();
});

