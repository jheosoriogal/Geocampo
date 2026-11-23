'use strict';
/* =====================================================================
   Mapas sin conexión: descarga los mosaicos del mapa base de una zona
   ===================================================================== */
const MAX_TILES = 30000;
const t2x = (lon, z) => Math.floor((lon + 180) / 360 * 2 ** z);
const t2y = (lat, z) => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * 2 ** z); };
function tileRange(b, z) { return {x0: t2x(b.w, z), x1: t2x(b.e, z), y0: t2y(b.n, z), y1: t2y(b.s, z)}; }
function countTiles(b, z0, z1) { let n = 0; for (let z = z0; z <= z1; z++) { const r = tileRange(b, z); n += (r.x1 - r.x0 + 1) * (r.y1 - r.y0 + 1); } return n; }
function* tileKeys(a) {
  const layer = baseByKey(a.base), nat = layer.options.maxNativeZoom;
  for (let z = a.zmin; z <= Math.min(a.zmax, nat); z++) { const r = tileRange(a.b, z); for (let x = r.x0; x <= r.x1; x++) for (let y = r.y0; y <= r.y1; y++) yield {z, x, y, key: `${a.base}/${z}/${x}/${y}`}; }
}
const baseByKey = k => Object.values(BASES).find(l => l.options.key === k);
const baseName = k => Object.keys(BASES).find(n => BASES[n].options.key === k);
function tileUrl(layer, t) { const sd = layer.options.subdomains; return L.Util.template(layer._url, {z: t.z, x: t.x, y: t.y, s: sd[Math.abs(t.x + t.y) % sd.length], r: ''}); }
async function getAreas() { return (await Store.get('offAreas').catch(() => null)) || []; }
const fmtMB = b => b >= 1e9 ? fmt(b / 1e9, 2) + ' GB' : fmt(b / 1e6, 1) + ' MB';
let areaRects = null;

async function openOffline() {
  const areas = await getAreas();
  let usage = '';
  try { const e = await navigator.storage.estimate(); usage = `Espacio usado por la app: ${fmtMB(e.usage || 0)}${e.quota ? ` de ${fmtMB(e.quota)} disponibles` : ''}`; } catch (e) {}
  const sh = openSheet(`<h3>Mapas sin conexión</h3>
    <p class="mut" style="margin:0 0 8px">Descarga el mapa base de tu zona de trabajo cuando tengas internet; en campo se verá aunque no haya señal.</p>
    ${areas.map(a => `<div class="lyr" data-a="${a.id}"><div class="lyr-h"><div class="grow"><b>${esc(a.name)}</b><div class="mut">${esc(baseName(a.base) || a.base)} · zoom ${a.zmin}–${a.zmax} · ${fmt(a.count, 0)} mosaicos · ${fmtMB(a.bytes)} · ${new Date(a.date).toLocaleDateString('es-CO')}${a.failed ? ` · ⚠ ${a.failed} fallidos` : ''}</div></div><button class="ib zm">⤢</button><button class="ib del">🗑</button></div></div>`).join('') || '<p class="mut">Aún no has descargado zonas.</p>'}
    <div class="mut" style="margin:6px 0">${usage}</div>
    <div class="row"><button class="btn pri grow" id="oNew">+ Descargar una zona</button>${areas.length ? '<button class="btn" id="oShow">Ver zonas en el mapa</button>' : ''}</div>`);
  sh.querySelector('#oNew').onclick = () => { closeSheet(); newOfflineArea(); };
  const so = sh.querySelector('#oShow'); if (so) so.onclick = () => { closeSheet(); showAreas(areas); };
  sh.querySelectorAll('[data-a]').forEach(el => {
    const a = areas.find(x => x.id === el.dataset.a);
    el.querySelector('.zm').onclick = () => { closeSheet(); showAreas([a]); };
    el.querySelector('.del').onclick = async () => { if (await confirmDlg('Eliminar zona', `¿Borrar la zona “${esc(a.name)}” (${fmtMB(a.bytes)}) del celular?`, 'Eliminar', 'dan')) { await deleteArea(a); openOffline(); } };
  });
}
function showAreas(as) {
  if (areaRects) areaRects.remove();
  areaRects = L.featureGroup(as.map(a => L.rectangle([[a.b.s, a.b.w], [a.b.n, a.b.e]], {color: '#2b6cb0', weight: 2, dashArray: '6 4', fill: false, interactive: false}).bindTooltip(esc(a.name), {permanent: true, className: 'lbl'}))).addTo(map);
  setFollow(false); map.fitBounds(areaRects.getBounds(), {padding: [30, 30]});
  setTimeout(() => { areaRects && areaRects.remove(); areaRects = null; }, 15000);
}
async function newOfflineArea() {
  const cur = Object.keys(BASES).find(n => map.hasLayer(BASES[n])) || 'Satélite (Esri)';
  const lyrs = [...S.layers.values()].filter(l => [...S.features.values()].some(f => f.layer === l.id));
  const z = map.getZoom();
  const est = d => {
    const b = areaBounds(d); if (!b) return 'Elige una capa con elementos';
    const z0 = +d.querySelector('#oZ0').value, z1 = +d.querySelector('#oZ1').value, key = BASES[d.querySelector('#oB').value].options.key;
    const nat = baseByKey(key).options.maxNativeZoom, n = countTiles(b, z0, Math.min(z1, nat));
    const kb = key === 'esri' ? 22 : 14;
    return `${fmt(n, 0)} mosaicos ≈ ${fmtMB(n * kb * 1024)}${n > MAX_TILES ? ` <b class="bad">— supera el máximo (${fmt(MAX_TILES, 0)}); reduce el zoom máximo o el área</b>` : ''}${z1 > nat ? `<br>Este mapa llega hasta zoom ${nat}; más cerca se ampliará el último nivel.` : ''}`;
  };
  const areaBounds = d => {
    const src = d.querySelector('#oA').value;
    let bb;
    if (src === 'view') bb = map.getBounds();
    else { const fs = [...S.features.values()].filter(f => f.layer === src); if (!fs.length) return null; bb = boundsOf(fs); const m = +d.querySelector('#oM').value || 0; bb = L.latLngBounds(L.latLng(bb.getSouth(), bb.getWest()).toBounds(m * 2).getSouthWest(), L.latLng(bb.getNorth(), bb.getEast()).toBounds(m * 2).getNorthEast()); }
    return {s: bb.getSouth(), w: bb.getWest(), n: bb.getNorth(), e: bb.getEast()};
  };
  const zs = (sel) => Array.from({length: 21}, (_, i) => i).filter(i => i >= 8).map(i => `<option value="${i}" ${i === sel ? 'selected' : ''}>${i}</option>`).join('');
  const r = await dialog({
    title: 'Descargar zona', body: `
      <label>Zona<select id="oA"><option value="view">Lo que se ve ahora en el mapa</option>${lyrs.map(l => `<option value="${l.id}">Alrededor de la capa: ${esc(l.name)}</option>`).join('')}</select></label>
      <label id="oML" class="hidden">Margen alrededor (m)<input id="oM" type="number" min="0" step="50" value="300"></label>
      <label>Mapa base<select id="oB">${Object.keys(BASES).map(n => `<option ${n === cur ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
      <div class="row" style="margin-top:0"><label class="grow">Desde zoom<select id="oZ0">${zs(Math.max(10, Math.min(z, 13)))}</select></label><label class="grow">Hasta zoom<select id="oZ1">${zs(18)}</select></label></div>
      <p class="mut">Zoom 16 ≈ ver fincas; 18 ≈ ver árboles; 19 ≈ máximo detalle (pesa 4 veces más que el 18).</p>
      <label>Nombre<input id="oN" value="Zona ${new Date().toLocaleDateString('es-CO')}"></label>
      <div class="info" id="oE"></div>`,
    buttons: [{label: 'Cancelar', value: null}, {label: 'Descargar', cls: 'pri', value: d => {
      const b = areaBounds(d); if (!b) { toast('Esa capa no tiene elementos'); return; }
      const z0 = +d.querySelector('#oZ0').value, z1 = +d.querySelector('#oZ1').value;
      if (z1 < z0) { toast('El zoom máximo debe ser mayor o igual al mínimo'); return; }
      const key = BASES[d.querySelector('#oB').value].options.key;
      if (countTiles(b, z0, Math.min(z1, baseByKey(key).options.maxNativeZoom)) > MAX_TILES) { toast('Demasiados mosaicos: reduce el zoom máximo o el área', 4000); return; }
      return {b, zmin: z0, zmax: z1, base: key, name: d.querySelector('#oN').value.trim() || 'Zona'};
    }}],
    onOpen: d => {
      const upd = () => { d.querySelector('#oML').classList.toggle('hidden', d.querySelector('#oA').value === 'view'); d.querySelector('#oE').innerHTML = est(d); };
      d.querySelectorAll('select,input').forEach(x => x.addEventListener('input', upd)); upd();
    }
  });
  if (r) downloadArea({id: uid(), ...r, date: Date.now()});
}
async function downloadArea(a) {
  const layer = baseByKey(a.base), list = [...tileKeys(a)];
  let done = 0, bytes = 0, failed = 0, skipped = 0, cancel = false, dEl = null;
  const upd = () => { if (dEl) { dEl.querySelector('progress').value = done / list.length; dEl.querySelector('.st').textContent = `${fmt(done, 0)} de ${fmt(list.length, 0)} · ${fmtMB(bytes)}${failed ? ` · ${failed} fallidos` : ''}`; } };
  const dl = dialog({title: 'Descargando ' + a.name, body: '<progress max="1" value="0"></progress><p class="st mut"></p><p class="mut">Mantén la app abierta y con internet.</p>', buttons: [{label: 'Cancelar', value: 'cancel', cls: 'dan'}], onOpen: d => { dEl = d; upd(); }});
  dl.then(v => { if (v === 'cancel') cancel = true; });
  keepAwake(true);
  let i = 0;
  const worker = async () => {
    while (!cancel && i < list.length) {
      const t = list[i++];
      try {
        if (await Store.getIn('tiles', t.key)) { skipped++; }
        else {
          let ok = false;
          for (let k = 0; k < 3 && !ok; k++) {
            try { const res = await fetch(tileUrl(layer, t), {mode: 'cors'}); if (res.ok) { const b = await res.blob(); await Store.putIn('tiles', t.key, b); bytes += b.size; ok = true; } else if (res.status === 404) { ok = true; } }
            catch (e) { await new Promise(r => setTimeout(r, 600)); }
          }
          if (!ok) failed++;
        }
      } catch (e) { failed++; }
      done++; if (done % 10 === 0 || done === list.length) upd();
    }
  };
  await Promise.all(Array.from({length: 6}, worker));
  keepAwake(!!S.rec);
  if (cancel) { toast('Descarga cancelada. Lo ya descargado se conserva.', 4000); a.name += ' (incompleta)'; } else if (dlgFinish) dlgFinish('ok');
  a.count = list.length; a.bytes = bytes + skipped * (a.base === 'esri' ? 22000 : 14000); a.failed = failed;
  const areas = await getAreas(); areas.push(a); await Store.set('offAreas', areas);
  if (!cancel) dialog({title: 'Zona descargada', body: `<p><b>${esc(a.name)}</b>: ${fmt(done - failed, 0)} mosaicos guardados (${fmtMB(a.bytes)}).</p>${failed ? `<p class="bad">${failed} mosaicos no se pudieron descargar; puedes repetir la descarga para completarlos.</p>` : ''}<p class="mut">Ya puedes usar esta zona sin internet con el mapa “${esc(baseName(a.base))}”.</p>`});
}
async function deleteArea(a) {
  const areas = await getAreas(), others = areas.filter(x => x.id !== a.id);
  const keep = new Set(); others.filter(o => o.base === a.base).forEach(o => { for (const t of tileKeys(o)) keep.add(t.key); });
  const del = []; for (const t of tileKeys(a)) if (!keep.has(t.key)) del.push(t.key);
  for (let i = 0; i < del.length; i += 2000) await Store.delMany('tiles', del.slice(i, i + 2000)).catch(() => {});
  await Store.set('offAreas', others); toast('Zona eliminada');
}
MORE_ITEMS.push({label: '🗺 Mapas sin conexión (descargar zona)', run: openOffline});
