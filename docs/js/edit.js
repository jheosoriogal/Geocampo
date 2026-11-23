'use strict';
/* =====================================================================
   Edición de geometrías (vértices), huecos y zonas de amortiguamiento
   ===================================================================== */
let ED = null;
const clone = x => JSON.parse(JSON.stringify(x));
function editGeometry(f) {
  if (S.rec) return toast('Termina primero el registro en curso');
  if (typeof stopMeasure === 'function') stopMeasure();
  closeSheet(); unrender(f.id);
  ED = {f, rings: [clone(f.coords), ...clone(f.holes || [])], undo: [], sel: null, closed: f.type === 'polygon',
    geom: null, marks: L.layerGroup().addTo(map)};
  ED.geom = (ED.closed ? L.polygon([], {color: '#d53f8c', weight: 3, dashArray: '6 6', fillOpacity: .12, interactive: false}) : L.polyline([], {color: '#d53f8c', weight: 4, interactive: false})).addTo(map);
  S.backHook = cancelEdit;
  const el = document.createElement('div'); el.id = 'edp'; el.className = 'card panel';
  el.innerHTML = `<div style="display:flex;justify-content:space-between;gap:8px"><b>Editar: ${esc(f.name)}</b><span class="mut">Arrastra los vértices · toca uno para elegirlo · ○ inserta</span></div><div id="edS"></div>
    <div class="row" style="margin-top:6px"><button class="btn" id="edDel">Borrar vértice</button><button class="btn" id="edGps">Vértice → GPS</button><button class="btn" id="edSimp">Simplificar</button><button class="btn" id="edU">↶</button><button class="btn pri" id="edOk">Guardar</button><button class="btn dan" id="edX">✕</button></div>`;
  document.body.appendChild(el);
  el.querySelector('#edDel').onclick = () => { if (!ED.sel) return toast('Toca primero un vértice'); const [r, i] = ED.sel, min = ED.closed ? 3 : 2;
    if (r === 0 && ED.rings[0].length <= min) return toast(`El borde necesita al menos ${min} vértices`);
    snap(); ED.rings[r].splice(i, 1); if (ED.rings[r].length < 3) { ED.rings.splice(r, 1); toast('Hueco eliminado'); } ED.sel = null; edDraw(); };
  el.querySelector('#edGps').onclick = () => { if (!ED.sel) return toast('Toca primero un vértice'); if (!S.pos) return toast('Sin GPS'); snap(); ED.rings[ED.sel[0]][ED.sel[1]] = [S.pos.lat, S.pos.lon, S.pos.alt, S.pos.t]; edDraw(); toast(`Vértice movido a tu posición (±${fmt(S.pos.acc, 1)} m)`); };
  el.querySelector('#edSimp').onclick = simplifyDlg;
  el.querySelector('#edU').onclick = () => { if (!ED.undo.length) return; ED.rings = ED.undo.pop(); ED.sel = null; edDraw(); };
  el.querySelector('#edOk').onclick = saveEdit;
  el.querySelector('#edX').onclick = cancelEdit;
  map.on('moveend', edDraw);
  zoomTo([f]); edDraw();
}
function snap() { ED.undo.push(clone(ED.rings)); if (ED.undo.length > 50) ED.undo.shift(); }
function edDraw() {
  if (!ED) return;
  const ll = r => r.map(c => [c[0], c[1]]);
  ED.geom.setLatLngs(ED.closed ? ED.rings.map(ll) : ll(ED.rings[0]));
  ED.marks.clearLayers();
  const vb = map.getBounds().pad(0.1), vis = [];
  ED.rings.forEach((r, ri) => r.forEach((c, i) => { if (vb.contains([c[0], c[1]])) vis.push([ri, i]); }));
  const tot = ED.rings.reduce((s, r) => s + r.length, 0);
  if (vis.length > 350) { $('#edS').innerHTML = statsEd() + `<div class="bad">Hay ${vis.length} vértices a la vista: acércate más para editarlos (o usa Simplificar).</div>`; return; }
  vis.forEach(([ri, i]) => {
    const c = ED.rings[ri][i], sel = ED.sel && ED.sel[0] === ri && ED.sel[1] === i;
    const m = L.marker([c[0], c[1]], {draggable: true, icon: L.divIcon({className: '', html: `<div class="vh${sel ? ' sel' : ''}"></div>`, iconSize: [22, 22], iconAnchor: [11, 11]})});
    m.on('dragstart', () => snap());
    m.on('drag', e => { const p = e.target.getLatLng(); ED.rings[ri][i] = [p.lat, p.lng, null, Date.now()]; ED.geom.setLatLngs(ED.closed ? ED.rings.map(ll) : ll(ED.rings[0])); $('#edS').innerHTML = statsEd(); });
    m.on('dragend', () => { ED.sel = [ri, i]; edDraw(); });
    m.on('click', () => { ED.sel = [ri, i]; edDraw(); });
    ED.marks.addLayer(m);
    // punto medio para insertar
    const nx = i + 1 < ED.rings[ri].length ? i + 1 : (ED.closed ? 0 : -1);
    if (nx >= 0) {
      const d = ED.rings[ri][nx], mid = [(c[0] + d[0]) / 2, (c[1] + d[1]) / 2];
      const mm = L.marker(mid, {draggable: true, icon: L.divIcon({className: '', html: '<div class="vh mid"></div>', iconSize: [16, 16], iconAnchor: [8, 8]})});
      const ins = p => { snap(); ED.rings[ri].splice(i + 1, 0, [p.lat, p.lng, null, Date.now()]); ED.sel = [ri, i + 1]; edDraw(); };
      mm.on('click', () => ins(L.latLng(mid)));
      mm.on('dragend', e => ins(e.target.getLatLng()));
      ED.marks.addLayer(mm);
    }
  });
  $('#edS').innerHTML = statsEd() + `<div class="mut">${tot} vértices${ED.rings.length > 1 ? ` · ${ED.rings.length - 1} hueco(s)` : ''}${ED.sel ? ' · 1 seleccionado' : ''}</div>`;
}
function statsEd() {
  const tmp = {type: ED.closed ? 'polygon' : 'line', coords: ED.rings[0], holes: ED.rings.slice(1)};
  return ED.closed ? `<span class="big">${fmt(fArea(tmp) / 1e4, 4)} ha</span> <span class="mut">· perímetro ${fmtLen(fPerim(tmp))}</span>` : `<span class="big">${fmtLen(lengthM(ED.rings[0]))}</span>`;
}
async function simplifyDlg() {
  const r = await dialog({title: 'Simplificar', body: '<p class="mut">Quita vértices que se desvían menos de la tolerancia (elimina el “zigzag” del GPS al caminar el borde).</p><label>Tolerancia (m)<input id="smT" type="number" min="0.1" step="0.1" value="1"></label>',
    buttons: [{label: 'Cancelar', value: null}, {label: 'Aplicar', cls: 'pri', value: d => +d.querySelector('#smT').value || 1}]});
  if (!r) return;
  const before = ED.rings.reduce((s, x) => s + x.length, 0); snap();
  const tol = r / 111320;
  ED.rings = ED.rings.map((ring, k) => {
    const cs = ring.map(c => [c[1], c[0]]);
    const g = ED.closed ? turf.polygon([[...cs, cs[0]]]) : turf.lineString(cs);
    const out = turf.simplify(g, {tolerance: tol, highQuality: true}).geometry.coordinates;
    let res = (ED.closed ? out[0].slice(0, -1) : out).map(c => [c[1], c[0], null, null]);
    if (res.length < (ED.closed ? 3 : 2)) res = ring;
    return res;
  });
  ED.sel = null; edDraw();
  toast(`${before} → ${ED.rings.reduce((s, x) => s + x.length, 0)} vértices`);
}
async function saveEdit() { const f = ED.f; f.coords = ED.rings[0]; if (ED.closed) { f.holes = ED.rings.slice(1); if (!f.holes.length) delete f.holes; } closeEdit(); await saveFeature(f); styleCache.delete(f.layer); toast('Geometría guardada'); showInfo(f.id); }
async function cancelEdit() { if (ED && ED.undo.length && !await confirmDlg('Descartar cambios', '¿Salir sin guardar los cambios de la geometría?', 'Descartar', 'dan')) return; const f = ED.f; closeEdit(); renderFeature(f); }
function closeEdit() { map.off('moveend', edDraw); ED.geom.remove(); ED.marks.remove(); document.getElementById('edp')?.remove(); ED = null; S.backHook = null; }
INFO_ACTIONS.push({label: '✏ Editar vértices', when: f => f.type !== 'point', run: editGeometry});
INFO_ACTIONS.push({label: '◌ Recortar hueco', when: f => f.type === 'polygon', run: f => { closeSheet(); startDrawing('hole', f.id); }});

/* ---- Zona de amortiguamiento (buffer) ---- */
const toTurf = f => f.type === 'point' ? turf.point([f.coords[0][1], f.coords[0][0]]) : f.type === 'line' ? turf.lineString(f.coords.map(c => [c[1], c[0]])) : turf.polygon([[...f.coords, f.coords[0]], ...(f.holes || []).map(h => [...h, h[0]])].map(r => r.map(c => [c[1], c[0]])));
function fromTurfPolys(g) {
  const polys = g.geometry.type === 'Polygon' ? [g.geometry.coordinates] : g.geometry.type === 'MultiPolygon' ? g.geometry.coordinates : [];
  const ring = r => r.slice(0, -1).map(c => [c[1], c[0], null, null]);
  return polys.map(p => ({coords: ring(p[0]), holes: p.slice(1).map(ring)}));
}
async function bufferDlg(f) {
  const poly = f.type === 'polygon';
  const r = await dialog({title: 'Zona de amortiguamiento', body: `<p class="mut">Crea un polígono a una distancia fija alrededor de “${esc(f.name)}”.</p>
    <label>Distancia (m)<input id="bfD" type="number" step="1" value="50"></label>
    ${poly ? '<label>Tipo<select id="bfT"><option value="full">Polígono completo (incluye el lote)</option><option value="ring">Solo el anillo alrededor (excluye el lote)</option><option value="in">Hacia adentro (distancia negativa: retiro interno)</option></select></label>' : ''}`,
    buttons: [{label: 'Cancelar', value: null}, {label: 'Crear', cls: 'pri', value: d => ({m: Math.abs(+d.querySelector('#bfD').value || 0), t: d.querySelector('#bfT')?.value || 'full'})}]});
  if (!r || !r.m) return;
  let g;
  try {
    const src = toTurf(f);
    g = turf.buffer(src, r.t === 'in' ? -r.m : r.m, {units: 'meters', steps: 16});
    if (!g) throw new Error('La zona resultante quedó vacía (¿retiro mayor que el lote?)');
    if (r.t === 'ring') g = turf.difference(turf.featureCollection([g, src]));
  } catch (e) { return dialog({title: 'No se pudo crear', body: `<p>${esc(e.message || e)}</p>`}); }
  const parts = fromTurfPolys(g); if (!parts.length) return toast('La zona resultante quedó vacía');
  const label = r.t === 'in' ? `Retiro ${r.m} m` : `Buffer ${r.m} m${r.t === 'ring' ? ' (anillo)' : ''}`;
  const fs = parts.map((p, i) => ({id: uid() + i, layer: activeLayerId(), type: 'polygon', name: `${label} – ${f.name}${parts.length > 1 ? ` (${i + 1})` : ''}`, desc: '', coords: p.coords, ...(p.holes.length ? {holes: p.holes} : {}), created: Date.now(), props: {origen: f.name, distancia_m: r.t === 'in' ? -r.m : r.m}}));
  await addFeatures(fs); closeSheet(); zoomTo(fs);
  toast(`${label}: ${fmt(fs.reduce((s, x) => s + fArea(x), 0) / 1e4, 4)} ha`, 4000);
}
INFO_ACTIONS.push({label: '⊙ Buffer / retiro', when: () => true, run: bufferDlg});
