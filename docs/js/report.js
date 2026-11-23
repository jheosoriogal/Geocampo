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
