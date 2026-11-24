'use strict';
/* =====================================================================
   Mapas georreferenciados (PDF, GeoTIFF, imagen + world file, KMZ)
   y Shapefile (importar / exportar)
   ===================================================================== */
const MAX_PX = IOS ? 3600 : 4096;   // iOS limita el tamaño de los lienzos (canvas)
const OV_CRS = {'EPSG:9377': 'MAGNA-SIRGAS Origen-Nacional (9377)', 'EPSG:3116': 'MAGNA-SIRGAS Bogotá (3116)', 'EPSG:3115': 'MAGNA-SIRGAS Oeste (3115)', 'EPSG:3117': 'MAGNA-SIRGAS Este Central (3117)', 'EPSG:3118': 'MAGNA-SIRGAS Este (3118)', 'EPSG:3114': 'MAGNA-SIRGAS Oeste-Oeste (3114)', 'EPSG:4326': 'WGS84 grados (4326)', 'EPSG:3857': 'Web Mercator (3857)', 'EPSG:32618': 'UTM 18N (32618)', 'EPSG:32617': 'UTM 17N (32617)', 'EPSG:32619': 'UTM 19N (32619)'};

/* ---- Homografía (proyección de 4 puntos) ---- */
function adj(m) { return [m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4], m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5], m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3]]; }
function mmul(a, b) { const c = Array(9); for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) { let s = 0; for (let k = 0; k < 3; k++) s += a[3 * i + k] * b[3 * k + j]; c[3 * i + j] = s; } return c; }
function mvec(m, v) { return [m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2]]; }
function basis(p) { const m = [p[0][0], p[1][0], p[2][0], p[0][1], p[1][1], p[2][1], 1, 1, 1]; const v = mvec(adj(m), [p[3][0], p[3][1], 1]); return mmul(m, [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2]]); }
function homography(src, dst) { return mmul(basis(dst), adj(basis(src))); }
function applyH(H, x, y) { const v = mvec(H, [x, y, 1]); return [v[0] / v[2], v[1] / v[2]]; }

/* ---- Capa de imagen deformada a 4 esquinas ---- */
const WarpLayer = L.Layer.extend({
  initialize(url, corners, w, h, opacity) { this._url = url; this._c = corners; this._w = w; this._h = h; this._op = opacity ?? .8; },
  onAdd(m) {
    const img = this._img = L.DomUtil.create('img', 'leaflet-zoom-hide');
    img.src = this._url; img.style.cssText = `position:absolute;left:0;top:0;width:${this._w}px;height:${this._h}px;transform-origin:0 0;pointer-events:none;opacity:${this._op};max-width:none`;
    this.getPane('overlayPane').appendChild(img);
    m.on('zoomend viewreset', this._upd, this); this._upd();
  },
  onRemove(m) { m.off('zoomend viewreset', this._upd, this); this._img.remove(); },
  setOpacity(o) { this._op = o; if (this._img) this._img.style.opacity = o; },
  _upd() {
    const p = this._c.map(c => this._map.latLngToLayerPoint(c)), w = this._w, h = this._h;
    const t = homography([[0, 0], [w, 0], [w, h], [0, h]], p.map(q => [q.x, q.y])).map(x => x / 1);
    const n = t.map(x => x / t[8]);
    this._img.style.transform = `matrix3d(${n[0]},${n[3]},0,${n[6]},${n[1]},${n[4]},0,${n[7]},0,0,1,0,${n[2]},${n[5]},0,${n[8]})`;
  }
});
const OVS = new Map();   // id -> {rec, layer, url}
function showOverlay(rec) {
  hideOverlay(rec.id);
  const url = URL.createObjectURL(rec.blob), layer = new WarpLayer(url, rec.corners, rec.w, rec.h, rec.opacity);
  if (rec.visible !== false) layer.addTo(map);
  OVS.set(rec.id, {rec, layer, url});
}
function hideOverlay(id) { const o = OVS.get(id); if (o) { o.layer.remove(); URL.revokeObjectURL(o.url); OVS.delete(id); } }
INIT_HOOKS.push(async () => { ((await Store.all('overlays').catch(() => [])) || []).sort((a, b) => a.created - b.created).forEach(showOverlay); });

/* Guarda una imagen georreferenciada: canvas + 4 puntos de control (píxel ↔ lat/lon) */
async function saveOverlay(name, canvas, ctrlPx, ctrlLL) {
  // homografía píxel → Web Mercator (la proyección del mapa) para obtener las 4 esquinas
  const merc = ctrlLL.map(([lat, lon]) => proj4('EPSG:4326', 'EPSG:3857', [lon, lat]));
  const H = homography(ctrlPx, merc), w = canvas.width, h = canvas.height;
  const corners = [[0, 0], [w, 0], [w, h], [0, h]].map(([x, y]) => { const [mx, my] = applyH(H, x, y); const [lon, lat] = proj4('EPSG:3857', 'EPSG:4326', [mx, my]); return [lat, lon]; });
  const alpha = hasAlpha(canvas);
  const blob = await new Promise(r => canvas.toBlob(r, alpha ? 'image/png' : 'image/jpeg', .85));
  const rec = {id: uid(), name, blob, w, h, corners, opacity: .85, visible: true, created: Date.now()};
  await Store.put('overlays', rec); showOverlay(rec);
  setFollow(false); map.fitBounds(L.latLngBounds(corners), {padding: [20, 20]});
  toast(`Mapa “${name}” cargado. Ajusta su transparencia en Capas.`, 4500);
  return rec;
}
function hasAlpha(c) { try { const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data; for (let i = 3; i < d.length; i += 4 * 97) if (d[i] < 250) return true; } catch (e) {} return false; }
function scaledCanvas(src, w, h) { const k = Math.min(1, MAX_PX / Math.max(w, h)); const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k); c.getContext('2d').drawImage(src, 0, 0, c.width, c.height); return {c, k}; }
async function askCRS(name, guess, note) {
  return dialog({title: 'Sistema de coordenadas', body: `<p>No pude identificar el sistema de coordenadas de <b>${esc(name)}</b>.${note ? ` ${note}` : ''}</p><label>Elige el sistema<select id="crsS">${Object.entries(OV_CRS).map(([k, v]) => `<option value="${k}" ${k === guess ? 'selected' : ''}>${v}</option>`).join('')}</select></label>`,
    buttons: [{label: 'Cancelar', value: null}, {label: 'Usar', cls: 'pri', value: d => d.querySelector('#crsS').value}]});
}
function guessByX(x) { const a = Math.abs(x); return a <= 180 ? 'EPSG:4326' : a > 3.5e6 && a < 6.5e6 ? 'EPSG:9377' : a > 6.5e6 ? 'EPSG:3857' : a > 1.5e5 && a < 9e5 ? 'EPSG:32618' : 'EPSG:3116'; }
function prjToProj(text) { try { const t = text.trim(); proj4(t, 'EPSG:4326', [0, 0]); return t; } catch (e) { return null; } }
const toLL = (crs, x, y) => { const [lon, lat] = proj4(crs, 'EPSG:4326', [x, y]); return [lat, lon]; };

/* ---- Imagen + world file (.jgw/.pgw/.tfw/.wld) ---- */
const WORLD_EXT = {jpg: ['jgw', 'jpgw', 'wld'], jpeg: ['jgw', 'jpgw', 'wld'], png: ['pgw', 'pngw', 'wld'], tif: ['tfw', 'tifw', 'wld'], tiff: ['tfw', 'tifw', 'wld']};
const baseOf = n => n.replace(/\.[^.]+$/, '').toLowerCase();
const companion = (file, all, exts) => all.find(f => f !== file && baseOf(f.name) === baseOf(file.name) && exts.includes(f.name.split('.').pop().toLowerCase()));
async function importWorldImage(file, all) {
  const ext = file.name.split('.').pop().toLowerCase(), wf = companion(file, all, WORLD_EXT[ext] || []);
  const prj = companion(file, all, ['prj']);
  const v = (await wf.text()).trim().split(/\s+/).map(Number);
  if (v.length < 6 || v.some(x => !isFinite(x))) throw new Error('El archivo de georreferencia (' + wf.name + ') no es válido.');
  const [A, D, B, E, C, F] = v;
  const url = URL.createObjectURL(file); const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('No se pudo leer la imagen')); i.src = url; });
  let crs = prj ? prjToProj(await prj.text()) : null;
  if (!crs) { crs = await askCRS(file.name, guessByX(C), prj ? 'El .prj no se pudo interpretar.' : 'No se seleccionó un archivo .prj junto a la imagen.'); if (!crs) { URL.revokeObjectURL(url); return null; } }
  const {c, k} = scaledCanvas(img, img.naturalWidth, img.naturalHeight); URL.revokeObjectURL(url);
  const W = img.naturalWidth, Hh = img.naturalHeight;
  const geo = (col, row) => toLL(crs, A * col + B * row + C, D * col + E * row + F);
  const px = [[0, 0], [W, 0], [W, Hh], [0, Hh]];
  await saveOverlay(file.name, c, px.map(([x, y]) => [x * k, y * k]), px.map(([x, y]) => geo(x - .5, y - .5)));
  return null;
}
IMPORTERS.push({match: (ext, file, all) => WORLD_EXT[ext] && !!companion(file, all, WORLD_EXT[ext]), run: importWorldImage});

/* ---- GeoTIFF ---- */
async function importGeoTIFF(file) {
  const tiff = await GeoTIFF.fromBlob(file), main = await tiff.getImage(0);
  const W = main.getWidth(), Hh = main.getHeight();
  const keys = main.getGeoKeys() || {};
  let code = keys.ProjectedCSTypeGeoKey || keys.GeographicTypeGeoKey;
  let crs = code && code !== 32767 ? 'EPSG:' + code : null;
  if (crs && !proj4.defs(crs)) crs = null;
  const bb = main.getBoundingBox();
  if (!crs) { crs = await askCRS(file.name, guessByX(bb[0]), code ? `(código EPSG ${code} no incluido)` : ''); if (!crs) return null; }
  // elige la vista reducida (overview) más pequeña que siga siendo ≥ MAX_PX
  const n = await tiff.getImageCount(); let pick = main;
  for (let i = 1; i < n; i++) { const im = await tiff.getImage(i); if (Math.max(im.getWidth(), im.getHeight()) >= Math.min(MAX_PX, Math.max(W, Hh))) pick = im; }
  const k = Math.min(1, MAX_PX / Math.max(W, Hh)), tw = Math.round(W * k), th = Math.round(Hh * k);
  toast('Leyendo GeoTIFF…', 3000);
  const rgb = await pick.readRGB({width: tw, height: th, interleave: true, enableAlpha: true});
  const bands = rgb.length / (tw * th), c = document.createElement('canvas'); c.width = tw; c.height = th;
  const g = c.getContext('2d'), id = g.createImageData(tw, th);
  const nd = main.getGDALNoData();
  for (let i = 0, j = 0; i < tw * th; i++, j += bands) {
    id.data[i * 4] = rgb[j]; id.data[i * 4 + 1] = rgb[j + 1]; id.data[i * 4 + 2] = rgb[j + 2];
    id.data[i * 4 + 3] = bands === 4 ? rgb[j + 3] : (nd != null && rgb[j] === nd && rgb[j + 1] === nd && rgb[j + 2] === nd ? 0 : 255);
  }
  g.putImageData(id, 0, 0);
  const [x0, y0, x1, y1] = bb;
  await saveOverlay(file.name, c, [[0, 0], [tw, 0], [tw, th], [0, th]], [toLL(crs, x0, y1), toLL(crs, x1, y1), toLL(crs, x1, y0), toLL(crs, x0, y0)]);
  return null;
}
IMPORTERS.push({match: (ext, file, all) => (ext === 'tif' || ext === 'tiff') && !companion(file, all, WORLD_EXT.tif), run: async f => {
  try { return await importGeoTIFF(f); } catch (e) { throw new Error('No se pudo leer el GeoTIFF: ' + (e.message || e) + '. Si es muy grande, expórtalo desde QGIS con menor resolución o en JPG con world file.'); }
}});

/* ---- PDF georreferenciado (GeoPDF ISO 32000 / OGC, como los de QGIS, ArcGIS y Avenza) ---- */
if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'vendor/pdf.worker.min.js';
async function inflate(bytes) {
  // lee por partes: los PDF suelen traer bytes sobrantes después del flujo comprimido
  const parts = []; let n = 0;
  try {
    const rd = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate')).getReader();
    for (;;) { const {done, value} = await rd.read(); if (done) break; parts.push(value); n += value.length; }
  } catch (e) { if (!n) return null; }
  const out = new Uint8Array(n); let o = 0; parts.forEach(p => { out.set(p, o); o += p.length; }); return out;
}
async function pdfGeoText(buf) {
  const u8 = new Uint8Array(buf), dec = new TextDecoder('latin1'), raw = dec.decode(u8);
  let txt = raw.includes('/GPTS') ? raw : '';
  const re = /stream\r?\n/g; let m;
  while ((m = re.exec(raw))) {
    const s = m.index + m[0].length, e = raw.indexOf('endstream', s); if (e < 0) break;
    const ob = raw.lastIndexOf(' obj', m.index), head = raw.slice(ob >= 0 && m.index - ob < 2000 ? ob : Math.max(0, m.index - 400), m.index);
    if (e - s < 4e6 && /FlateDecode/.test(head) && !/\/Subtype\s*\/Image/.test(head)) { const out = await inflate(u8.subarray(s, e)); if (out) { const t = dec.decode(out); if (t.includes('/GPTS') || t.includes('/Viewport')) txt += '\n' + t; } }
    re.lastIndex = e;
  }
  return txt;
}
const nums = s => s.trim().split(/\s+/).map(Number);
function parseGeoVP(txt) {
  const out = [], re = /\/GPTS\s*\[([^\]]+)\]/g; let m;
  while ((m = re.exec(txt))) {
    const g = nums(m[1]); const win = txt.slice(Math.max(0, m.index - 4000), m.index + 4000);
    const lp = /\/LPTS\s*\[([^\]]+)\]/.exec(txt.slice(m.index - 2000 < 0 ? 0 : m.index - 2000, m.index + 2000));
    // BBox del Viewport que contiene esta medida (si la medida está dentro del mismo diccionario)
    const before = txt.slice(Math.max(0, m.index - 4000), m.index), vpAt = Math.max(before.lastIndexOf('/Viewport'), before.lastIndexOf('/VP'));
    let bb = null;
    if (vpAt >= 0) { const bm = /\/BBox\s*\[([^\]]+)\]/.exec(before.slice(vpAt)) || /\/BBox\s*\[([^\]]+)\]/.exec(before.slice(Math.max(0, vpAt - 300))); if (bm) bb = nums(bm[1]); }
    if (!bb) { const all = [...txt.matchAll(/\/Type\s*\/Viewport[\s\S]{0,400}?\/BBox\s*\[([^\]]+)\]|\/BBox\s*\[([^\]]+)\][\s\S]{0,200}?\/Type\s*\/Viewport/g)]; if (all.length === 1) bb = nums(all[0][1] || all[0][2]); }
    out.push({gpts: g, lpts: lp ? nums(lp[1]) : [0, 1, 0, 0, 1, 0, 1, 1], bbox: bb, win});
  }
  return out;
}
async function importGeoPDF(file) {
  const buf = await file.arrayBuffer();
  const vps = parseGeoVP(await pdfGeoText(buf.slice(0)));
  if (!vps.length) throw new Error('El PDF no tiene georreferencia. En QGIS expórtalo con “Exportar como PDF” marcando “Crear PDF georreferenciado (GeoPDF)”.');
  // el visor principal: el de BBox más grande
  const vp = vps.sort((a, b) => (b.bbox ? Math.abs((b.bbox[2] - b.bbox[0]) * (b.bbox[3] - b.bbox[1])) : 0) - (a.bbox ? Math.abs((a.bbox[2] - a.bbox[0]) * (a.bbox[3] - a.bbox[1])) : 0))[0];
  const pdf = await pdfjsLib.getDocument({data: new Uint8Array(buf)}).promise, page = await pdf.getPage(1);
  const v1 = page.getViewport({scale: 1}), scale = Math.min(4, MAX_PX / Math.max(v1.width, v1.height));
  const vw = page.getViewport({scale});
  const c = document.createElement('canvas'); c.width = Math.floor(vw.width); c.height = Math.floor(vw.height);
  toast('Dibujando el PDF…', 3000);
  await page.render({canvasContext: c.getContext('2d'), viewport: vw}).promise;
  const [mx0, my0, mx1, my1] = page.view, bb = vp.bbox || [mx0, my0, mx1, my1];
  const n = Math.min(vp.gpts.length / 2, vp.lpts.length / 2);
  if (n < 3) throw new Error('La georreferencia del PDF está incompleta.');
  const px = [], ll = [];
  for (let i = 0; i < n; i++) {
    const X = bb[0] + vp.lpts[2 * i] * (bb[2] - bb[0]), Y = bb[1] + vp.lpts[2 * i + 1] * (bb[3] - bb[1]);
    px.push(vw.convertToViewportPoint(X, Y)); ll.push([vp.gpts[2 * i], vp.gpts[2 * i + 1]]);
  }
  while (px.length < 4) { px.push(px[px.length - 1].map((v, i) => v + (px[0][i] - px[1][i]))); ll.push(ll[ll.length - 1].map((v, i) => v + (ll[0][i] - ll[1][i]))); }
  // recorta al marco del mapa (quita márgenes, leyenda y rótulo)
  const xs = px.slice(0, 4).map(p => p[0]), ys = px.slice(0, 4).map(p => p[1]);
  const cx0 = Math.max(0, Math.floor(Math.min(...xs))), cy0 = Math.max(0, Math.floor(Math.min(...ys))), cx1 = Math.min(c.width, Math.ceil(Math.max(...xs))), cy1 = Math.min(c.height, Math.ceil(Math.max(...ys)));
  const cc = document.createElement('canvas'); cc.width = cx1 - cx0; cc.height = cy1 - cy0; cc.getContext('2d').drawImage(c, cx0, cy0, cc.width, cc.height, 0, 0, cc.width, cc.height);
  await saveOverlay(file.name, cc, px.slice(0, 4).map(([x, y]) => [x - cx0, y - cy0]), ll.slice(0, 4));
  return null;
}
IMPORTERS.push({match: ext => ext === 'pdf', run: async f => { try { return await importGeoPDF(f); } catch (e) { throw new Error(e.message || String(e)); } }});

/* ---- KMZ: elementos + imágenes superpuestas (GroundOverlay) ---- */
async function importKMZ(file) {
  const zip = await JSZip.loadAsync(file);
  const k = Object.keys(zip.files).find(n => n.toLowerCase().endsWith('.kml'));
  if (!k) throw new Error('El KMZ no contiene un archivo .kml');
  const text = await zip.file(k).async('string'), doc = xmlDoc(text);
  let nOv = 0;
  for (const go of T(doc, 'GroundOverlay')) {
    const href = T(go, 'href')[0]?.textContent.trim(); if (!href) continue;
    const zf = zip.file(href) || zip.file(decodeURIComponent(href)) || zip.file(Object.keys(zip.files).find(n => n.endsWith(href.split('/').pop())) || '');
    if (!zf) continue;
    const blob = await zf.async('blob'), url = URL.createObjectURL(blob);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }).catch(() => null); URL.revokeObjectURL(url);
    if (!img) continue;
    let ll;
    const quad = T(go, 'LatLonQuad')[0];
    if (quad) { const c = kmlCoords(T(quad, 'coordinates')[0].textContent); ll = [c[3], c[2], c[1], c[0]].map(p => [p[0], p[1]]); }   // KML: inf-izq, inf-der, sup-der, sup-izq
    else {
      const box = T(go, 'LatLonBox')[0]; if (!box) continue;
      const g = nm => parseFloat(child(box, nm)), N = g('north'), Sx = g('south'), Ex = g('east'), Wx = g('west'), rot = (g('rotation') || 0) * Math.PI / 180;
      const cy = (N + Sx) / 2, cx = (Ex + Wx) / 2, kx = Math.cos(cy * Math.PI / 180);
      const R = ([la, lo]) => { const dx = (lo - cx) * kx, dy = la - cy; return [cy + dx * Math.sin(rot) + dy * Math.cos(rot), cx + (dx * Math.cos(rot) - dy * Math.sin(rot)) / kx]; };
      ll = [[N, Wx], [N, Ex], [Sx, Ex], [Sx, Wx]].map(R);
    }
    const {c} = scaledCanvas(img, img.naturalWidth, img.naturalHeight);
    await saveOverlay(child(go, 'name') || file.name, c, [[0, 0], [c.width, 0], [c.width, c.height], [0, c.height]], ll); nOv++;
  }
  const feats = parseKML(text);
  if (!feats.length && nOv) return null;
  return feats;
}
IMPORTERS.push({match: ext => ext === 'kmz', run: importKMZ});

/* ---- Shapefile: importar (.zip, o .shp + .dbf + .prj juntos) ---- */
async function importShapefile(file, all) {
  const ext = file.name.split('.').pop().toLowerCase();
  let res;
  if (ext === 'zip') res = await shp(await file.arrayBuffer());
  else {
    const o = {shp: await file.arrayBuffer()}, dbf = companion(file, all, ['dbf']), prj = companion(file, all, ['prj']), cpg = companion(file, all, ['cpg']);
    if (dbf) o.dbf = await dbf.arrayBuffer(); if (prj) o.prj = await prj.text(); if (cpg) o.cpg = await cpg.text();
    if (!prj) toast('Sin archivo .prj: se asume que las coordenadas están en grados WGS84', 4000);
    res = await shp(o);
  }
  const list = Array.isArray(res) ? res : [res];
  let n = 0;
  for (const gj of list) {
    let feats = parseGeoJSON(gj);
    const first = feats.find(f => f.coords && f.coords.length)?.coords[0];
    if (first && (Math.abs(first[0]) > 90 || Math.abs(first[1]) > 180)) {   // sin .prj y en coordenadas planas
      const crs = await askCRS(gj.fileName || file.name, guessByX(first[1]), 'Las coordenadas están en metros.'); if (!crs) continue;
      feats = parseGeoJSON(gj, crs);
    }
    if (await addImportedLayer((gj.fileName || baseOf(file.name)) + '.shp', feats, list.length > 1)) n++;
  }
  if (!n) toast('No se encontraron elementos en el shapefile', 4000);
  return null;
}
IMPORTERS.push({match: (ext, file, all) => ext === 'zip' || (ext === 'shp'), run: async (f, all) => {
  try { return await importShapefile(f, all); } catch (e) { throw new Error('No se pudo leer el shapefile: ' + (e.message || e) + '. Si es un .zip, verifica que contenga .shp, .shx, .dbf y .prj.'); }
}});

/* ---- Shapefile: exportar ---- */
const PRJ_4326 = 'GEOGCS["GCS_WGS_1984",DATUM["D_WGS_1984",SPHEROID["WGS_1984",6378137.0,298.257223563]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]]';
const PRJ_9377 = 'PROJCS["MAGNA-SIRGAS_Origen-Nacional",GEOGCS["GCS_MAGNA",DATUM["D_MAGNA",SPHEROID["GRS_1980",6378137.0,298.257222101]],PRIMEM["Greenwich",0.0],UNIT["Degree",0.0174532925199433]],PROJECTION["Transverse_Mercator"],PARAMETER["False_Easting",5000000.0],PARAMETER["False_Northing",2000000.0],PARAMETER["Central_Meridian",-73.0],PARAMETER["Scale_Factor",0.9992],PARAMETER["Latitude_Of_Origin",4.0],UNIT["Meter",1.0]]';
async function buildShp(fs, title, crs) {
  const gj = geoJSONObj(fs, false);
  gj.features = gj.features.map(f => {
    const p = {};   // nombres de campo DBF: máx. 10 caracteres, sin repetir
    Object.entries(f.properties).forEach(([k, v]) => { let n = norm(k).slice(0, 10) || 'campo'; let i = 1; while (n in p) n = n.slice(0, 8) + '_' + i++; p[n] = v == null ? '' : typeof v === 'number' ? v : String(v).slice(0, 254); });
    let g = f.geometry;
    if (g.type === 'Polygon') g = turf.rewind(turf.feature(g), {reverse: true}).geometry;
    if (crs) g = turf.coordEach ? (() => { const ft = turf.feature(JSON.parse(JSON.stringify(g))); turf.coordEach(ft, c => { const [x, y] = proj4('EPSG:4326', crs, [c[0], c[1]]); c[0] = +x.toFixed(3); c[1] = +y.toFixed(3); }); return ft.geometry; })() : g;
    return {type: 'Feature', properties: p, geometry: g};
  });
  const safe = title.replace(/[^\w\-]+/g, '_');
  const blob = await shpwrite.zip(gj, {outputType: 'blob', compression: 'DEFLATE', folder: safe, filename: safe, prj: crs ? PRJ_9377 : PRJ_4326, types: {point: safe + '_puntos', polygon: safe + '_poligonos', polyline: safe + '_lineas'}});
  return {blob, ext: 'zip'};
}
EXPORTERS.push({id: 'shp9377', label: 'Shapefile .zip — MAGNA-SIRGAS Origen Nacional (9377)', build: (fs, t) => buildShp(fs, t, 'EPSG:9377')});
EXPORTERS.push({id: 'shp', label: 'Shapefile .zip — WGS84 (4326)', build: (fs, t) => buildShp(fs, t, null)});

/* ---- Panel de capas: mapas georreferenciados ---- */
LAYER_TOOLS.push({
  html: () => OVS.size ? `<h3 style="margin-top:16px">Mapas georreferenciados</h3>${[...OVS.values()].map(({rec}) => `<div class="lyr" data-ov="${rec.id}"><div class="lyr-h"><input type="checkbox" class="ovv" ${rec.visible !== false ? 'checked' : ''}><div class="grow"><b>${esc(rec.name)}</b><input type="range" class="ovo" min="0.1" max="1" step="0.05" value="${rec.opacity}" style="padding:0;margin:4px 0 0;border:0"></div><button class="ib ovz">⤢</button><button class="ib ovd">🗑</button></div></div>`).join('')}` : '<p class="mut" style="margin-top:12px">Puedes cargar mapas propios (PDF georreferenciado de QGIS/ArcGIS, GeoTIFF, JPG/PNG con su archivo .jgw/.pgw, o KMZ con imagen) desde “Importar archivo”.</p>',
  bind(sh) {
    sh.querySelectorAll('[data-ov]').forEach(el => {
      const o = OVS.get(el.dataset.ov), rec = o.rec;
      el.querySelector('.ovv').onchange = e => { rec.visible = e.target.checked; rec.visible ? o.layer.addTo(map) : o.layer.remove(); Store.put('overlays', rec); };
      el.querySelector('.ovo').oninput = e => { rec.opacity = +e.target.value; o.layer.setOpacity(rec.opacity); };
      el.querySelector('.ovo').onchange = () => Store.put('overlays', rec);
      el.querySelector('.ovz').onclick = () => { closeSheet(); setFollow(false); map.fitBounds(L.latLngBounds(rec.corners)); };
      el.querySelector('.ovd').onclick = async () => { if (await confirmDlg('Quitar mapa', `¿Quitar “${esc(rec.name)}” del celular?`, 'Quitar', 'dan')) { hideOverlay(rec.id); await Store.del('overlays', rec.id).catch(() => {}); openLayers(); } };
    });
  }
});
