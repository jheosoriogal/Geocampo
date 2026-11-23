'use strict';
/* =====================================================================
   Fotos con coordenadas, fecha y hora (sello visible + EXIF GPS)
   ===================================================================== */
const CAM = plug('Camera');
if (S.settings.photoStamp === undefined) S.settings.photoStamp = true;
const pad2 = v => String(v).padStart(2, '0');
const fmtDT = t => { const d = new Date(t); return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}/${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`; };

async function captureImage() {
  if (CAP) {
    try {
      const p = await CAM.getPhoto({quality: 88, resultType: 'dataUrl', source: 'CAMERA', saveToGallery: false, correctOrientation: true, width: 2400});
      return p.dataUrl;
    } catch (e) { if (!/cancel/i.test(e.message || '')) toast('No se pudo usar la cámara: ' + (e.message || e), 4000); return null; }
  }
  return new Promise(res => {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/*'; inp.capture = 'environment';
    inp.onchange = () => { const f = inp.files[0]; if (!f) return res(null); const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => res(null); r.readAsDataURL(f); };
    inp.click();
  });
}
const loadImg = src => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
function rat(v) { const d = Math.floor(v), m = Math.floor((v - d) * 60), s = Math.round(((v - d) * 60 - m) * 60 * 100); return [[d, 1], [m, 1], [s, 100]]; }

/* Procesa la imagen: reduce a 2400 px, pone el sello y escribe EXIF con GPS */
async function processPhoto(dataUrl, pos, label) {
  const img = await loadImg(dataUrl);
  const k = Math.min(1, 2400 / Math.max(img.width, img.height));
  const w = Math.round(img.width * k), h = Math.round(img.height * k);
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
  if (S.settings.photoStamp) {
    const {e, n} = toCTM(pos.lat, pos.lon);
    const lines = [fmtDT(pos.t), `Lat ${pos.lat.toFixed(6)}  Lon ${pos.lon.toFixed(6)}${pos.acc ? `  ±${pos.acc.toFixed(1)} m` : ''}`, `Origen Nacional (9377)  E ${e.toFixed(1)}  N ${n.toFixed(1)}${pos.alt != null ? `  Alt ${pos.alt.toFixed(0)} m` : ''}`];
    if (label) lines.push(label);
    const fs = Math.max(14, Math.round(Math.min(w, h) / 34)), lh = fs * 1.3, bh = lines.length * lh + fs * .8;
    g.fillStyle = 'rgba(0,0,0,.55)'; g.fillRect(0, h - bh, w, bh);
    g.fillStyle = '#fff'; g.font = `600 ${fs}px system-ui, sans-serif`; g.textBaseline = 'top';
    lines.forEach((t, i) => g.fillText(t, fs * .6, h - bh + fs * .4 + i * lh));
  }
  let out = c.toDataURL('image/jpeg', .86);
  try {
    const d = new Date(pos.t), dt = `${d.getFullYear()}:${pad2(d.getMonth() + 1)}:${pad2(d.getDate())} ${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    const u = new Date(pos.t);
    const gps = {
      [piexif.GPSIFD.GPSVersionID]: [2, 3, 0, 0],
      [piexif.GPSIFD.GPSLatitudeRef]: pos.lat >= 0 ? 'N' : 'S', [piexif.GPSIFD.GPSLatitude]: rat(Math.abs(pos.lat)),
      [piexif.GPSIFD.GPSLongitudeRef]: pos.lon >= 0 ? 'E' : 'W', [piexif.GPSIFD.GPSLongitude]: rat(Math.abs(pos.lon)),
      [piexif.GPSIFD.GPSDateStamp]: `${u.getUTCFullYear()}:${pad2(u.getUTCMonth() + 1)}:${pad2(u.getUTCDate())}`,
      [piexif.GPSIFD.GPSTimeStamp]: [[u.getUTCHours(), 1], [u.getUTCMinutes(), 1], [u.getUTCSeconds(), 1]]
    };
    if (pos.alt != null) { gps[piexif.GPSIFD.GPSAltitudeRef] = pos.alt < 0 ? 1 : 0; gps[piexif.GPSIFD.GPSAltitude] = [Math.round(Math.abs(pos.alt) * 100), 100]; }
    if (pos.acc) gps[piexif.GPSIFD.GPSHPositioningError] = [Math.round(pos.acc * 100), 100];
    const exif = {'0th': {[piexif.ImageIFD.Make]: 'GeoCampo', [piexif.ImageIFD.Software]: 'GeoCampo', [piexif.ImageIFD.DateTime]: dt, [piexif.ImageIFD.ImageDescription]: label || ''},
      Exif: {[piexif.ExifIFD.DateTimeOriginal]: dt, [piexif.ExifIFD.DateTimeDigitized]: dt}, GPS: gps};
    out = piexif.insert(piexif.dump(exif), out);
  } catch (e) { console.warn('EXIF', e); }
  const blob = await (await fetch(out)).blob();
  const tk = 260 / Math.max(w, h), tc = document.createElement('canvas'); tc.width = Math.round(w * tk); tc.height = Math.round(h * tk);
  tc.getContext('2d').drawImage(c, 0, 0, tc.width, tc.height);
  return {blob, thumb: tc.toDataURL('image/jpeg', .7), w, h};
}
async function photoPosition() {
  if (S.pos && Date.now() - S.pos.t < 30000) {
    if (S.pos.acc > S.settings.maxAcc && !await confirmDlg('Precisión baja', `La precisión del GPS es ±${fmt(S.pos.acc, 1)} m. ¿Tomar la foto con esta ubicación?`, 'Tomar foto')) return null;
    return {...S.pos, t: Date.now()};
  }
  const r = await dialog({title: 'Sin señal GPS', body: '<p>No hay una ubicación GPS reciente. ¿Qué ubicación usar para la foto?</p>', stack: true, buttons: [{label: 'Centro del mapa (cruz)', value: 'cross', cls: 'pri'}, {label: 'Cancelar', value: null}]});
  if (!r) return null;
  const m = map.getCenter(); return {lat: m.lat, lon: m.lng, alt: null, acc: null, t: Date.now(), src: 'mapa'};
}
async function newPhotoRecord(label) {
  const pos = await photoPosition(); if (!pos) return null;
  const raw = await captureImage(); if (!raw) return null;
  toast('Procesando foto…', 1500);
  const p = await processPhoto(raw, pos, label);
  const rec = {id: uid(), ...p, lat: pos.lat, lon: pos.lon, alt: pos.alt, acc: pos.acc, t: pos.t, src: pos.src};
  await Store.put('photos', rec);
  return rec;
}
/* Botón “Foto”: crea un punto con la foto en la capa activa */
async function takePhoto() {
  const n = [...S.features.values()].filter(f => f.photos && f.type === 'point' && f.layer === activeLayerId()).length + 1;
  const rec = await newPhotoRecord(`Foto ${n} · ${S.layers.get(activeLayerId())?.name || ''}`); if (!rec) return;
  const r = await editDialog({title: 'Guardar foto', name: `Foto ${n}`, info: `<img src="${rec.thumb}" style="max-width:100%;border-radius:8px"><br>${fmtDT(rec.t)} · ${rec.lat.toFixed(6)}, ${rec.lon.toFixed(6)}${rec.acc ? ` · ±${fmt(rec.acc, 1)} m` : ''}`});
  if (!r) { await Store.del('photos', rec.id).catch(() => {}); return; }
  const f = {id: uid(), layer: activeLayerId(), type: 'point', name: r.name, desc: r.desc, coords: [[rec.lat, rec.lon, rec.alt, rec.t]], created: Date.now(), photos: [rec.id], ...(rec.acc ? {acc: rec.acc} : {}), ...(rec.src ? {src: rec.src} : {})};
  await saveFeature(f); toast('Foto guardada');
}
async function attachPhoto(f) {
  const rec = await newPhotoRecord(f.name); if (!rec) return;
  (f.photos = f.photos || []).push(rec.id); await saveFeature(f); toast('Foto agregada'); showInfo(f.id);
}
async function viewPhoto(f, id) {
  const rec = await Store.getIn('photos', id); if (!rec) return toast('No se encontró la foto');
  const url = URL.createObjectURL(rec.blob), {e, n} = toCTM(rec.lat, rec.lon), i = f.photos.indexOf(id);
  const name = photoFile(f, i, id);
  const r = await dialog({title: f.name, body: `<img src="${url}" style="width:100%;border-radius:8px"><table class="kv"><tr><td>Fecha y hora</td><td>${fmtDT(rec.t)}</td></tr><tr><td>Lat / Lon</td><td>${rec.lat.toFixed(6)}, ${rec.lon.toFixed(6)}</td></tr><tr><td>Origen Nacional</td><td>E ${fmt(e, 1)} · N ${fmt(n, 1)}</td></tr>${rec.acc ? `<tr><td>Precisión</td><td>±${fmt(rec.acc, 1)} m</td></tr>` : ''}<tr><td>Archivo</td><td>${esc(name)}</td></tr></table>`,
    buttons: [{label: 'Eliminar', value: 'del', cls: 'dan'}, {label: 'Compartir', value: 'share'}, {label: 'Guardar', value: 'save'}, {label: 'Cerrar', value: null, cls: 'pri'}]});
  URL.revokeObjectURL(url);
  if (r === 'share') shareFile(rec.blob, name);
  else if (r === 'save') download(rec.blob, name);
  else if (r === 'del' && await confirmDlg('Eliminar foto', '¿Eliminar esta foto?', 'Eliminar', 'dan')) { f.photos = f.photos.filter(x => x !== id); await Store.del('photos', id).catch(() => {}); await saveFeature(f); showInfo(f.id); }
}
INFO_ACTIONS.push({label: '📷 Agregar foto', when: () => true, run: attachPhoto});
INFO_EXTRA.push(async (f, sh) => {
  if (!f.photos || !f.photos.length) return '';
  const recs = await Promise.all(f.photos.map(id => Store.getIn('photos', id).catch(() => null)));
  setTimeout(() => sh.querySelectorAll('.thumbs img').forEach(im => im.onclick = () => viewPhoto(f, im.dataset.p)), 0);
  return `<div class="mut" style="margin-top:8px">Fotos (${f.photos.length}) — toca para ampliar</div><div class="thumbs">${recs.map((r, i) => r ? `<img src="${r.thumb}" data-p="${f.photos[i]}">` : '').join('')}</div>`;
});

/* Exportación con fotos */
async function photoEntries(fs) {
  const out = [];
  for (const f of fs) for (const [i, id] of (f.photos || []).entries()) { const r = await Store.getIn('photos', id).catch(() => null); if (r) out.push({f, r, name: photoFile(f, i, id)}); }
  return out;
}
EXPORTERS.push({id: 'kmzf', label: 'KMZ con fotos (Google Earth)', async build(fs, title) {
  const ph = await photoEntries(fs), map_ = new Map(ph.map(p => [p.r.id, p.name]));
  KML_EXTRA.push(f => (f.photos || []).filter(id => map_.has(id)).map(id => `<br><img src="files/${map_.get(id)}" width="480">`).join(''));
  let kml; try { kml = toKML(fs, title); } finally { KML_EXTRA.pop(); }
  const z = new JSZip(); z.file('doc.kml', kml); ph.forEach(p => z.file('files/' + p.name, p.r.blob));
  return {blob: await z.generateAsync({type: 'blob', mimeType: 'application/vnd.google-earth.kmz'}), ext: 'kmz'};
}});
EXPORTERS.push({id: 'fotos', label: 'Fotos (ZIP de JPG con GPS + índice CSV)', async build(fs) {
  const ph = await photoEntries(fs); if (!ph.length) throw new Error('No hay fotos en lo que elegiste exportar.');
  const z = new JSZip(), rows = ['archivo;elemento;capa;fecha_hora;latitud;longitud;este_9377;norte_9377;precision_m'];
  ph.forEach(p => { z.file(p.name, p.r.blob); const {e, n} = toCTM(p.r.lat, p.r.lon); rows.push([p.name, `"${(p.f.name || '').replace(/"/g, '""')}"`, `"${(S.layers.get(p.f.layer)?.name || '').replace(/"/g, '""')}"`, fmtDT(p.r.t), p.r.lat.toFixed(7).replace('.', ','), p.r.lon.toFixed(7).replace('.', ','), e.toFixed(2).replace('.', ','), n.toFixed(2).replace('.', ','), p.r.acc ? p.r.acc.toFixed(1).replace('.', ',') : ''].join(';')); });
  z.file('indice_fotos.csv', '﻿' + rows.join('\r\n'));
  return {blob: await z.generateAsync({type: 'blob'}), ext: 'zip'};
}});
