'use strict';
/* =====================================================================
   Reporte PDF de un elemento (lote, track o punto)
   ===================================================================== */
async function tileBlob(layer, z, x, y) {
  const key = `${layer.options.key}/${z}/${x}/${y}`;
  const b = await Store.getIn('tiles', key).catch(() => null); if (b) return b;
  try { const r = await fetch(tileUrl(layer, {z, x, y}), {mode: 'cors'}); if (r.ok) return await r.blob(); } catch (e) {}
  return null;
}
/* Dibuja un mapa estático (mapa base + elementos) en un canvas */
async function mapSnapshot(fs, W, H, opts = {}) {
  const crs = map.options.crs, b = boundsOf(fs);
  if (!b.isValid()) return null;
  const bb = b.getNorthEast().equals(b.getSouthWest()) ? b.getCenter().toBounds(200) : b.pad(.18);
  let z = 19;
  for (; z > 3; z--) { const p1 = crs.latLngToPoint(bb.getNorthWest(), z), p2 = crs.latLngToPoint(bb.getSouthEast(), z); if (p2.x - p1.x <= W && p2.y - p1.y <= H) break; }
  const ctr = crs.latLngToPoint(bb.getCenter(), z), ox = ctr.x - W / 2, oy = ctr.y - H / 2;
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d'); g.fillStyle = '#e2e8f0'; g.fillRect(0, 0, W, H);
  const base = Object.values(BASES).find(l => map.hasLayer(l)) || BASES['Satélite (Esri)'];
  const tz = Math.min(z, base.options.maxNativeZoom), sc = 2 ** (z - tz), ts = 256 * sc;
  let ok = 0, miss = 0;
  const jobs = [];
  for (let x = Math.floor(ox / ts); x <= Math.floor((ox + W) / ts); x++) for (let y = Math.floor(oy / ts); y <= Math.floor((oy + H) / ts); y++) {
    jobs.push((async () => {
      let bl = await tileBlob(base, tz, x, y), k = 0;
      while (!bl && k < 6 && tz - k > 0) { k++; bl = await Store.getIn('tiles', `${base.options.key}/${tz - k}/${x >> k}/${y >> k}`).catch(() => null); }
      if (!bl) { miss++; return; }
      try { const im = await createImageBitmap(bl), n = 2 ** k, sz = 256 / n; g.drawImage(im, (x % n) * sz, (y % n) * sz, sz, sz, x * ts - ox, y * ts - oy, ts, ts); ok++; } catch (e) { miss++; }
    })());
  }
  await Promise.all(jobs);
  const P = c_ => { const p = crs.latLngToPoint(L.latLng(c_[0], c_[1]), z); return [p.x - ox, p.y - oy]; };
  for (const f of fs) {
    const col = colorOf(f);
    g.lineWidth = Math.max(3, W / 400); g.strokeStyle = col; g.fillStyle = col + '33';
    if (f.type === 'point') { const [x, y] = P(f.coords[0]); g.beginPath(); g.arc(x, y, W / 120, 0, 7); g.fillStyle = col; g.fill(); g.strokeStyle = '#fff'; g.stroke(); continue; }
    g.beginPath();
    [f.coords, ...(f.holes || [])].forEach(r => { r.forEach((cc, i) => { const [x, y] = P(cc); i ? g.lineTo(x, y) : g.moveTo(x, y); }); if (f.type === 'polygon') g.closePath(); });
    if (f.type === 'polygon') g.fill('evenodd'); g.stroke();
    if (opts.numbers && f.type === 'polygon' && f.coords.length <= 80) {
      g.font = `bold ${Math.round(W / 70)}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      f.coords.forEach((cc, i) => { const [x, y] = P(cc); g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, W / 90, 0, 7); g.fill(); g.strokeStyle = col; g.lineWidth = 2; g.stroke(); g.fillStyle = '#1a202c'; g.fillText(String(i + 1), x, y + 1); });
    }
  }
  if (opts.labels) {
    const fz = Math.round(W / 85); g.font = `bold ${fz}px sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
    for (const f of fs) {
      const n = opts.labels.get(f.id); if (n == null) continue;
      const c_ = f.type === 'point' ? f.coords[0] : centroidOf(f); let [x, y] = P(c_);
      if (f.type === 'point') y -= fz * 1.25;
      const t = String(n), w = g.measureText(t).width + fz * .7;
      g.fillStyle = 'rgba(255,255,255,.92)'; g.strokeStyle = '#1a202c'; g.lineWidth = 1.2;
      g.beginPath(); g.rect(x - w / 2, y - fz * .7, w, fz * 1.4); g.fill(); g.stroke();
      g.fillStyle = '#1a202c'; g.fillText(t, x, y + 1);
    }
  }
  // escala gráfica y norte
  const lat = bb.getCenter().lat, mpp = 40075016.686 * Math.cos(lat * Math.PI / 180) / 2 ** (z + 8);
  const target = W / 5 * mpp, pw = 10 ** Math.floor(Math.log10(target)), nice = [1, 2, 5, 10].map(v => v * pw).filter(v => v <= target).pop() || pw, bl = nice / mpp;
  const fs_ = Math.round(W / 55); g.font = `bold ${fs_}px sans-serif`; g.textAlign = 'left'; g.textBaseline = 'alphabetic';
  g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(12, H - fs_ * 2.6 - 12, bl + 24, fs_ * 2.6);
  g.fillStyle = '#1a202c'; g.fillRect(24, H - 24 - fs_ * .4, bl, fs_ * .4); g.fillText(nice >= 1000 ? `${nice / 1000} km` : `${nice} m`, 24, H - 30 - fs_ * .4);
  g.fillStyle = 'rgba(255,255,255,.85)'; g.fillRect(W - fs_ * 3 - 12, 12, fs_ * 3, fs_ * 3.6);
  g.fillStyle = '#1a202c'; g.beginPath(); g.moveTo(W - fs_ * 1.5 - 12, 18); g.lineTo(W - fs_ * 2.4 - 12, fs_ * 2.4 + 12); g.lineTo(W - fs_ * 1.5 - 12, fs_ * 1.9 + 12); g.lineTo(W - fs_ * .6 - 12, fs_ * 2.4 + 12); g.fill();
  g.textAlign = 'center'; g.fillText('N', W - fs_ * 1.5 - 12, fs_ * 3.4 + 12);
  return {canvas: c, missing: miss && !ok};
}

async function reportDlg(f) {
  const s = S.settings;
  const nV = f.type === 'point' ? 0 : f.coords.length;
  const r = await dialog({title: 'Reporte PDF', body: `<p class="mut">Mapa, medidas, coordenadas en Origen Nacional (EPSG:9377), atributos y fotos de “${esc(f.name)}”.</p>
    <label>Elaborado por<input id="rpA" value="${esc(s.reportAuthor || '')}" placeholder="Nombre y entidad"></label>
    ${nV ? `<label>Tabla de vértices<select id="rpV"><option value="1">Incluir (${nV} vértices)</option><option value="0" ${nV > 300 ? 'selected' : ''}>No incluir</option></select></label>` : ''}
    <label>Fotos<select id="rpF"><option value="1">Incluir las del elemento${f.type === 'polygon' ? ' y las tomadas dentro del lote' : ''}</option><option value="0">No incluir</option></select></label>`,
    buttons: [{label: 'Cancelar', value: null}, {label: 'Generar', cls: 'pri', value: d => ({author: d.querySelector('#rpA').value.trim(), vtx: d.querySelector('#rpV')?.value === '1', photos: d.querySelector('#rpF').value === '1'})}]});
  if (!r) return;
  s.reportAuthor = r.author; Store.set('settings', s);
  let blob;
  try { toast('Generando reporte…', 4000); blob = await buildReport(f, r); }
  catch (e) { return dialog({title: 'No se pudo generar', body: `<p>${esc(e.message || e)}</p>`}); }
  const name = `Reporte_${String(f.name).replace(/[^\w\-áéíóúñÁÉÍÓÚÑ]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;
  const a = await dialog({title: 'Reporte listo', body: `<p>${esc(name)}</p>`, buttons: [{label: 'Compartir', value: 'share'}, {label: 'Guardar', value: 'dl', cls: 'pri'}]});
  if (a === 'share') shareFile(blob, name); else if (a === 'dl') download(blob, name);
}

async function buildReport(f, o) {
  const {jsPDF} = window.jspdf, doc = new jsPDF({unit: 'mm', format: 'a4'});
  const PW = 210, M = 14, CW = PW - 2 * M; let y = M;
  const ly = S.layers.get(f.layer), now = new Date();
  const hdr = () => { doc.setFillColor(31, 95, 58); doc.rect(0, 0, PW, 9, 'F'); doc.setTextColor(255); doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.text('GeoCampo — Reporte de campo', M, 6); doc.setFont('helvetica', 'normal'); doc.text(now.toLocaleString('es-CO'), PW - M, 6, {align: 'right'}); doc.setTextColor(26, 32, 44); };
  const need = h => { if (y + h > 283) { doc.addPage(); hdr(); y = 16; } };
  hdr(); y = 18;
  doc.setFontSize(17); doc.setFont('helvetica', 'bold'); doc.text(doc.splitTextToSize(f.name || 'Sin nombre', CW), M, y); y += 7;
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(90, 100, 114);
  doc.text(`${TYPE[f.type]} · Capa: ${ly?.name || ''}${o.author ? ' · Elaborado por: ' + o.author : ''}`, M, y); doc.setTextColor(26, 32, 44); y += 5;
  // mapa
  const snap = await mapSnapshot([f], 1600, 1100, {numbers: o.vtx});
  if (snap) { const h = CW * 1100 / 1600; doc.addImage(snap.canvas.toDataURL('image/jpeg', .85), 'JPEG', M, y, CW, h); doc.setDrawColor(200); doc.rect(M, y, CW, h); y += h + 2; if (snap.missing) { doc.setFontSize(8); doc.text('Sin mapa base: no había internet ni zona descargada.', M, y + 2); y += 3; } }
  // resumen
  const rows = [];
  if (f.type === 'polygon') {
    rows.push(['Área', `${fmt(fArea(f) / 1e4, 4)} ha  (${fmt(fArea(f), 1)} m²)`], ['Perímetro', fmtLen(fPerim(f))], ['Vértices', String(f.coords.length)]);
    if (f.holes?.length) rows.push(['Huecos excluidos', `${f.holes.length} (${fmt(f.holes.reduce((s, h) => s + areaM2(h), 0) / 1e4, 4)} ha)`]);
    const c = centroidOf(f), {e, n} = toCTM(c[0], c[1]); rows.push(['Centroide', `E ${fmt(e, 1)}  N ${fmt(n, 1)}  (${c[0].toFixed(6)}, ${c[1].toFixed(6)})`]);
  } else if (f.type === 'line') rows.push(['Longitud', fmtLen(lengthM(f.coords))], ['Puntos', String(f.coords.length)]);
  else { const [lat, lon, alt] = f.coords[0], {e, n} = toCTM(lat, lon); rows.push(['Origen Nacional', `E ${fmt(e, 2)}  N ${fmt(n, 2)}`], ['Latitud / Longitud', `${lat.toFixed(7)}, ${lon.toFixed(7)}`]); if (alt != null) rows.push(['Altitud GPS', `${fmt(alt, 1)} m`]); if (f.acc) rows.push(['Precisión', `±${fmt(f.acc, 1)} m${f.n ? ` (promedio de ${f.n} lecturas)` : ''}`]); }
  const t0 = f.coords[0][3] || f.created; if (t0) rows.push(['Fecha de levantamiento', new Date(t0).toLocaleString('es-CO')]);
  if (f.desc) rows.push(['Observaciones', f.desc]);
  Object.entries(f.props || {}).forEach(([k, v]) => { if (v != null && v !== '') rows.push([k, String(v)]); });
  y += 3; doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.text('Resumen', M, y); y += 2;
  doc.setFontSize(9.5);
  rows.forEach(([k, v], i) => {
    const lines = doc.splitTextToSize(v, CW - 52), h = Math.max(6.5, lines.length * 4.3 + 2.2); need(h);
    if (i % 2 === 0) { doc.setFillColor(247, 250, 252); doc.rect(M, y, CW, h, 'F'); }
    doc.setFont('helvetica', 'bold'); doc.text(doc.splitTextToSize(k, 48), M + 2, y + 4.4); doc.setFont('helvetica', 'normal'); doc.text(lines, M + 52, y + 4.4); y += h;
  });
  doc.setFontSize(7.5); doc.setTextColor(90, 100, 114); need(6); doc.text('Áreas calculadas sobre el elipsoide (proyección local). Coordenadas planas en MAGNA-SIRGAS Origen Nacional (EPSG:9377).', M, y + 4); doc.setTextColor(26, 32, 44); y += 7;
  // vértices
  if (o.vtx && f.type !== 'point') {
    const rings = [['Borde exterior', f.coords], ...(f.holes || []).map((h, i) => [`Hueco ${i + 1}`, h])];
    for (const [rn, cs] of rings) {
      need(16); doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.text(`Vértices — ${rn}`, M, y + 5); y += 8;
      const head = ['N°', 'Este (m)', 'Norte (m)', 'Latitud', 'Longitud', 'Dist. al sig. (m)'], cw = [12, 32, 32, 34, 34, 38];
      const row = (vals, bold, fill) => { need(5.5); if (fill) { doc.setFillColor(...fill); doc.rect(M, y, CW, 5.5, 'F'); } doc.setFont('helvetica', bold ? 'bold' : 'normal'); doc.setFontSize(8.5); let x = M; vals.forEach((v, i) => { doc.text(String(v), x + cw[i] - 2, y + 3.9, {align: 'right'}); x += cw[i]; }); y += 5.5; };
      row(head, true, [226, 232, 240]);
      cs.forEach((c, i) => { const {e, n} = toCTM(c[0], c[1]); const nx = cs[(i + 1) % cs.length]; const d = (f.type === 'polygon' || i < cs.length - 1) ? fmt(distM(c, nx), 2) : ''; row([i + 1, fmt(e, 2), fmt(n, 2), c[0].toFixed(7), c[1].toFixed(7), d], false, i % 2 ? [247, 250, 252] : null); });
      y += 3;
    }
  }
  // fotos
  if (o.photos) {
    let ids = (f.photos || []).map(id => ({id, f}));
    if (f.type === 'polygon') {
      const poly = toTurf(f);
      for (const g of S.features.values()) if (g !== f && g.type === 'point' && g.photos?.length && turf.booleanPointInPolygon(turf.point([g.coords[0][1], g.coords[0][0]]), poly)) g.photos.forEach(id => ids.push({id, f: g}));
    }
    if (ids.length) {
      need(14); doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.text(`Registro fotográfico (${ids.length})`, M, y + 5); y += 9;
      const w = (CW - 6) / 2;
      for (let i = 0; i < ids.length; i++) {
        const rec = await Store.getIn('photos', ids[i].id).catch(() => null); if (!rec) continue;
        const h = w * rec.h / rec.w, col = i % 2;
        if (col === 0) need(h + 12);
        const x = M + col * (w + 6), url = await blobToDataURL(rec.blob);
        doc.addImage(url, 'JPEG', x, y, w, h);
        const {e, n} = toCTM(rec.lat, rec.lon);
        doc.setFontSize(7.5); doc.setFont('helvetica', 'normal');
        doc.text(doc.splitTextToSize(`${ids[i].f.name} · ${fmtDT(rec.t)} · E ${fmt(e, 1)} N ${fmt(n, 1)}`, w), x, y + h + 3.5);
        if (col === 1 || i === ids.length - 1) y += h + 10;
      }
    }
  }
  const np = doc.getNumberOfPages();
  for (let i = 1; i <= np; i++) { doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(120); doc.text(`Página ${i} de ${np} · Generado con GeoCampo`, PW / 2, 292, {align: 'center'}); }
  return doc.output('blob');
}
function blobToDataURL(b) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(b); }); }
INFO_ACTIONS.push({label: '📄 Reporte PDF', when: () => true, run: reportDlg});

/* =====================================================================
   Reporte PDF de toda una capa (p. ej. todas las trampas de una visita)
   ===================================================================== */
const fTime = f => f.coords?.[0]?.[3] || null;   // fecha y hora de captura en campo
async function layerReportDlg(l) {
  const fs = [...S.features.values()].filter(f => f.layer === l.id);
  if (!fs.length) return toast('La capa está vacía');
  const fields = layerFields(l.id), pre = new Set([l.label, l.styleBy].filter(k => k && fields.includes(k)));
  const nPh = fs.reduce((s, f) => s + (f.photos?.length || 0), 0), noT = fs.filter(f => !fTime(f)).length;
  const r = await dialog({title: 'Reporte PDF de la capa', body: `<p class="mut">“${esc(l.name)}”: ${fs.length} elementos. Incluye mapa general numerado, resumen y una tabla con la fecha y hora en que se tomó cada elemento en campo.</p>
    <label>Elaborado por<input id="lrA" value="${esc(S.settings.reportAuthor || '')}" placeholder="Nombre y entidad"></label>
    <label>Ordenar por<select id="lrO"><option value="time">Fecha y hora de captura</option><option value="name">Nombre</option></select></label>
    ${fields.length ? `<div class="mut" style="margin-top:8px">Columnas de atributos a incluir en la tabla (máx. 4):</div><div style="display:flex;flex-wrap:wrap;gap:4px 14px;margin:4px 0">${fields.map(k => `<label style="margin:2px 0;color:var(--tx);display:flex;gap:6px;align-items:center"><input type="checkbox" class="lrF" value="${esc(k)}" ${pre.has(k) ? 'checked' : ''} style="width:auto;margin:0">${esc(k)}</label>`).join('')}</div>` : ''}
    <label>Coordenadas<select id="lrC"><option value="en">Origen Nacional (Este / Norte)</option><option value="both">Origen Nacional + latitud / longitud</option></select></label>
    <label>Fotos<select id="lrF"><option value="1" ${nPh ? '' : 'disabled'}>Incluir (${nPh})</option><option value="0" ${nPh ? '' : 'selected'}>No incluir</option></select></label>
    ${noT ? `<p class="mut">${noT} elemento(s) no tienen fecha de captura (por ejemplo, los importados de un archivo); aparecerán con “—”.</p>` : ''}`,
    buttons: [{label: 'Cancelar', value: null}, {label: 'Generar', cls: 'pri', value: d => {
      const cols = [...d.querySelectorAll('.lrF:checked')].map(x => x.value);
      if (cols.length > 4) { toast('Elige máximo 4 columnas'); return; }
      return {author: d.querySelector('#lrA').value.trim(), order: d.querySelector('#lrO').value, cols, ll: d.querySelector('#lrC').value === 'both', photos: d.querySelector('#lrF').value === '1'};
    }}]});
  if (!r) return;
  S.settings.reportAuthor = r.author; Store.set('settings', S.settings);
  let blob;
  try { toast('Generando reporte de la capa…', 5000); blob = await buildLayerReport(l, fs, r); }
  catch (e) { return dialog({title: 'No se pudo generar', body: `<p>${esc(e.message || e)}</p>`}); }
  const name = `Reporte_capa_${String(l.name).replace(/\.[^.]+$/, '').replace(/[^\w\-áéíóúñÁÉÍÓÚÑ]+/g, '_')}_${new Date().toISOString().slice(0, 10)}.pdf`;
  const a = await dialog({title: 'Reporte listo', body: `<p>${esc(name)}</p>`, buttons: [{label: 'Compartir', value: 'share'}, {label: 'Guardar', value: 'dl', cls: 'pri'}]});
  if (a === 'share') shareFile(blob, name); else if (a === 'dl') download(blob, name);
}

/* Tabla con ajuste de texto, saltos de página y encabezado repetido */
function pdfTable(doc, ctx, cols, rows) {
  const M = 14, fsz = 7.6, lh = 3.3;
  const drawHead = () => {
    doc.setFont('helvetica', 'bold'); doc.setFontSize(fsz);
    const h = Math.max(...cols.map(c => doc.splitTextToSize(c.h, c.w - 2).length)) * lh + 2.4;
    doc.setFillColor(226, 232, 240); doc.rect(M, ctx.y, cols.reduce((s, c) => s + c.w, 0), h, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(fsz); let x = M;
    cols.forEach(c => { doc.text(doc.splitTextToSize(c.h, c.w - 2), c.al === 'r' ? x + c.w - 1 : x + 1, ctx.y + 3.4, {align: c.al === 'r' ? 'right' : 'left'}); x += c.w; });
    ctx.y += h;
  };
  ctx.need(14); drawHead();
  rows.forEach((row, i) => {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(fsz);
    const lines = row.map((v, j) => doc.splitTextToSize(String(v ?? ''), cols[j].w - 2));
    const h = Math.max(...lines.map(l => l.length)) * lh + 2;
    if (ctx.y + h > ctx.limit) { ctx.need(999); drawHead(); doc.setFont('helvetica', 'normal'); doc.setFontSize(fsz); }
    if (i % 2) { doc.setFillColor(247, 250, 252); doc.rect(M, ctx.y, cols.reduce((s, c) => s + c.w, 0), h, 'F'); }
    let x = M; lines.forEach((ln, j) => { const c = cols[j]; doc.text(ln, c.al === 'r' ? x + c.w - 1 : x + 1, ctx.y + 3.3, {align: c.al === 'r' ? 'right' : 'left'}); x += c.w; });
    ctx.y += h;
  });
  ctx.y += 3;
}
const fmtT = t => t ? fmtDT(t) : '—';
async function buildLayerReport(l, fs, o) {
  // hoja horizontal si la tabla de puntos no cabe a lo alto (lat/lon + varias columnas de atributos)
  const needW = 8 + 22 + 29 + 40 + (o.ll ? 34 : 0) + 11 + o.cols.length * 22;
  const wide = needW > 182;
  const {jsPDF} = window.jspdf, doc = new jsPDF({unit: 'mm', format: 'a4', orientation: wide ? 'landscape' : 'portrait'});
  const PW = wide ? 297 : 210, PH = wide ? 210 : 297, M = 14, CW = PW - 2 * M, now = new Date();
  const hdr = () => { doc.setFillColor(31, 95, 58); doc.rect(0, 0, PW, 9, 'F'); doc.setTextColor(255); doc.setFontSize(8.5); doc.setFont('helvetica', 'bold'); doc.text('GeoCampo — Reporte de capa', M, 6); doc.setFont('helvetica', 'normal'); doc.text(now.toLocaleString('es-CO'), PW - M, 6, {align: 'right'}); doc.setTextColor(26, 32, 44); };
  const ctx = {y: 18, limit: PH - 14}; ctx.need = h => { if (ctx.y + h > ctx.limit) { doc.addPage(); hdr(); ctx.y = 16; } };
  const title = t => { ctx.need(16); doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.text(t, M, ctx.y + 5); ctx.y += 8; };
  // orden y numeración
  const sorted = [...fs].sort(o.order === 'name' ? (a, b) => String(a.name).localeCompare(String(b.name), 'es', {numeric: true}) : (a, b) => (fTime(a) || Infinity) - (fTime(b) || Infinity));
  const num = new Map(sorted.map((f, i) => [f.id, i + 1]));
  hdr();
  doc.setFontSize(17); doc.setFont('helvetica', 'bold'); doc.text(doc.splitTextToSize(l.name, CW), M, ctx.y); ctx.y += 7;
  doc.setFontSize(10); doc.setFont('helvetica', 'normal'); doc.setTextColor(90, 100, 114);
  doc.text(`Reporte de capa${o.author ? ' · Elaborado por: ' + o.author : ''}`, M, ctx.y); doc.setTextColor(26, 32, 44); ctx.y += 5;
  const MH = wide ? 960 : 1150;
  const snap = await mapSnapshot(sorted, 1600, MH, {labels: sorted.length <= 400 ? num : null});
  if (snap) { const h = CW * MH / 1600; doc.addImage(snap.canvas.toDataURL('image/jpeg', .85), 'JPEG', M, ctx.y, CW, h); doc.setDrawColor(200); doc.rect(M, ctx.y, CW, h); ctx.y += h + 2; if (snap.missing) { doc.setFontSize(8); doc.text('Sin mapa base: no había internet ni zona descargada.', M, ctx.y + 2); ctx.y += 3; } }
  // resumen
  const pts = sorted.filter(f => f.type === 'point'), pol = sorted.filter(f => f.type === 'polygon'), lin = sorted.filter(f => f.type === 'line');
  const ts = sorted.map(fTime).filter(Boolean);
  const rows = [['Elementos', [pts.length && `${pts.length} puntos`, pol.length && `${pol.length} polígonos`, lin.length && `${lin.length} líneas/tracks`].filter(Boolean).join(' · ')]];
  if (pol.length) rows.push(['Área total de polígonos', `${fmt(pol.reduce((s, f) => s + fArea(f), 0) / 1e4, 4)} ha`]);
  if (lin.length) rows.push(['Longitud total de líneas', fmtLen(lin.reduce((s, f) => s + lengthM(f.coords), 0))]);
  if (ts.length) rows.push(['Captura en campo', ts.length > 1 ? `desde ${fmtDT(Math.min(...ts))} hasta ${fmtDT(Math.max(...ts))}` : fmtDT(ts[0])]);
  if (ts.length < sorted.length) rows.push(['Sin fecha de captura', `${sorted.length - ts.length} elemento(s) (importados de un archivo)`]);
  const nPh = sorted.reduce((s, f) => s + (f.photos?.length || 0), 0); if (nPh) rows.push(['Fotos', String(nPh)]);
  ctx.need(rows.length * 6.5 + 12); ctx.y += 3; doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.text('Resumen', M, ctx.y); ctx.y += 2; doc.setFontSize(9.5);
  rows.forEach(([k, v], i) => { ctx.need(6.5); if (i % 2 === 0) { doc.setFillColor(247, 250, 252); doc.rect(M, ctx.y, CW, 6.5, 'F'); } doc.setFont('helvetica', 'bold'); doc.text(k, M + 2, ctx.y + 4.4); doc.setFont('helvetica', 'normal'); doc.text(v, M + 52, ctx.y + 4.4); ctx.y += 6.5; });
  ctx.y += 2;
  // columnas de atributos: reparten el ancho sobrante
  const attrCols = (used) => { const w = o.cols.length ? Math.max(16, (CW - used) / o.cols.length) : 0; return o.cols.map(k => ({h: k, w, flex: true})); };
  const attrVals = f => o.cols.map(k => f.props?.[k] ?? '');
  const fitW = cols => {
    const tot = cols.reduce((s, c) => s + c.w, 0); if (tot <= CW) return cols;
    const flex = cols.filter(c => c.flex), fixed = tot - flex.reduce((s, c) => s + c.w, 0), k = Math.max(.4, (CW - fixed) / (tot - fixed));
    flex.forEach(c => c.w *= k);
    const t2 = cols.reduce((s, c) => s + c.w, 0); if (t2 > CW) cols.forEach(c => c.w *= CW / t2);
    return cols;
  };
  if (pts.length) {
    title(`Puntos (${pts.length})`);
    const base = [{h: 'N°', w: 8, al: 'r'}, {h: 'Nombre', w: 30, flex: true}, {h: 'Fecha y hora de captura', w: 29}, {h: 'Este (m)', w: 20, al: 'r'}, {h: 'Norte (m)', w: 20, al: 'r'}];
    if (o.ll) base.push({h: 'Latitud', w: 16, al: 'r'}, {h: 'Longitud', w: 18, al: 'r'});
    base.push({h: 'Prec. (m)', w: 11, al: 'r'});
    const cols = fitW([...base, ...attrCols(base.reduce((s, c) => s + c.w, 0))]);
    pdfTable(doc, ctx, cols, pts.map(f => { const [lat, lon] = f.coords[0], {e, n} = toCTM(lat, lon); return [num.get(f.id), f.name, fmtT(fTime(f)), fmt(e, 2), fmt(n, 2), ...(o.ll ? [lat.toFixed(6), lon.toFixed(6)] : []), f.acc ? fmt(f.acc, 1) : '', ...attrVals(f)]; }));
  }
  if (pol.length) {
    title(`Polígonos (${pol.length})`);
    const base = [{h: 'N°', w: 8, al: 'r'}, {h: 'Nombre', w: 34, flex: true}, {h: 'Fecha y hora de captura', w: 29}, {h: 'Área (ha)', w: 18, al: 'r'}, {h: 'Perímetro (m)', w: 20, al: 'r'}, {h: 'Vértices', w: 13, al: 'r'}];
    const cols = fitW([...base, ...attrCols(base.reduce((s, c) => s + c.w, 0))]);
    pdfTable(doc, ctx, cols, pol.map(f => [num.get(f.id), f.name, fmtT(fTime(f)), fmt(fArea(f) / 1e4, 4), fmt(fPerim(f), 1), f.coords.length, ...attrVals(f)]));
  }
  if (lin.length) {
    title(`Líneas / tracks (${lin.length})`);
    const base = [{h: 'N°', w: 8, al: 'r'}, {h: 'Nombre', w: 34, flex: true}, {h: 'Inicio', w: 29}, {h: 'Fin', w: 29}, {h: 'Longitud (m)', w: 20, al: 'r'}];
    const cols = fitW([...base, ...attrCols(base.reduce((s, c) => s + c.w, 0))]);
    pdfTable(doc, ctx, cols, lin.map(f => [num.get(f.id), f.name, fmtT(fTime(f)), fmtT(f.coords[f.coords.length - 1][3]), fmt(lengthM(f.coords), 1), ...attrVals(f)]));
  }
  doc.setFontSize(7.5); doc.setTextColor(90, 100, 114); ctx.need(6); doc.text('Fecha y hora tomadas del GPS/celular al momento de la captura. Coordenadas planas en MAGNA-SIRGAS Origen Nacional (EPSG:9377).', M, ctx.y + 2); doc.setTextColor(26, 32, 44); ctx.y += 6;
  // fotos
  if (o.photos) {
    const ids = sorted.flatMap(f => (f.photos || []).map(id => ({id, f})));
    if (ids.length) {
      const w = (CW - 6) / 2, r0 = await Store.getIn('photos', ids[0].id).catch(() => null);
      ctx.need(16 + (r0 ? w * r0.h / r0.w + 12 : 0));
      title(`Registro fotográfico (${ids.length})`);
      for (let i = 0; i < ids.length; i++) {
        const rec = await Store.getIn('photos', ids[i].id).catch(() => null); if (!rec) continue;
        const h = w * rec.h / rec.w, col = i % 2;
        if (col === 0) ctx.need(h + 12);
        const x = M + col * (w + 6);
        doc.addImage(await blobToDataURL(rec.blob), 'JPEG', x, ctx.y, w, h);
        const {e, n} = toCTM(rec.lat, rec.lon);
        doc.setFontSize(7.5); doc.setFont('helvetica', 'normal');
        doc.text(doc.splitTextToSize(`N° ${num.get(ids[i].f.id)} · ${ids[i].f.name} · ${fmtDT(rec.t)} · E ${fmt(e, 1)} N ${fmt(n, 1)}`, w), x, ctx.y + h + 3.5);
        if (col === 1 || i === ids.length - 1) ctx.y += h + 10;
      }
    }
  }
  const np = doc.getNumberOfPages();
  for (let i = 1; i <= np; i++) { doc.setPage(i); doc.setFontSize(7.5); doc.setTextColor(120); doc.text(`Página ${i} de ${np} · Generado con GeoCampo`, PW / 2, PH - 5, {align: 'center'}); }
  return doc.output('blob');
}
