'use strict';
/* =====================================================================
   Navegación: ir a un punto (distancia y rumbo), ir a una coordenada,
   medición rápida
   ===================================================================== */
function bearing(a, b) {
  const r = Math.PI / 180, y = Math.sin((b[1] - a[1]) * r) * Math.cos(b[0] * r);
  const x = Math.cos(a[0] * r) * Math.sin(b[0] * r) - Math.sin(a[0] * r) * Math.cos(b[0] * r) * Math.cos((b[1] - a[1]) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
const CARD = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSO', 'SO', 'OSO', 'O', 'ONO', 'NO', 'NNO'];
const cardinal = d => CARD[Math.round(d / 22.5) % 16];
function centroidOf(f) {
  if (f.type === 'point') return f.coords[0];
  if (f.type === 'line') return f.coords[0];
  try { const c = turf.centerOfMass(turf.polygon([[...f.coords, f.coords[0]].map(p => [p[1], p[0]])])).geometry.coordinates; return [c[1], c[0]]; }
  catch (e) { const b = boundsOf([f]).getCenter(); return [b.lat, b.lng]; }
}

/* ---- Brújula del celular ---- */
let heading = null, headingSrc = null, lastPosForCourse = null;
function onOrient(e) {
  let h = null;
  if (e.webkitCompassHeading != null) h = e.webkitCompassHeading;
  else if (e.absolute && e.alpha != null) h = (360 - e.alpha) % 360;
  if (h != null) { const so = (screen.orientation && screen.orientation.angle) || 0; heading = (h + so) % 360; headingSrc = 'brújula'; NAV && navUpdate(); }
}
let orientOn = false;
function startCompass() {
  if (orientOn) return; orientOn = true;
  if ('ondeviceorientationabsolute' in window) window.addEventListener('deviceorientationabsolute', onOrient);
  else window.addEventListener('deviceorientation', onOrient);
}
S.listeners.add(p => {   // rumbo por movimiento si no hay brújula
  if (lastPosForCourse && headingSrc !== 'brújula') { const d = distM([lastPosForCourse.lat, lastPosForCourse.lon], [p.lat, p.lon]); if (d > 3 && p.acc < 20) { heading = bearing([lastPosForCourse.lat, lastPosForCourse.lon], [p.lat, p.lon]); headingSrc = 'movimiento'; } }
  if (!lastPosForCourse || distM([lastPosForCourse.lat, lastPosForCourse.lon], [p.lat, p.lon]) > 3) lastPosForCourse = p;
  if (NAV) navUpdate();
});

/* ---- Ir a un punto ---- */
let NAV = null;
function navigateTo(target, name) {
  stopNav(); closeSheet(); startCompass();
  NAV = {target, name, line: L.polyline([], {color: '#2b6cb0', weight: 3, dashArray: '8 6', interactive: false}).addTo(map), pin: L.circleMarker(target, {radius: 10, color: '#2b6cb0', weight: 3, fill: false, interactive: false}).addTo(map), arrived: false};
  const el = document.createElement('div'); el.id = 'navp'; el.className = 'card';
  el.style.cssText = 'position:fixed;left:8px;right:62px;top:calc(66px + var(--st));z-index:940;padding:8px 10px;display:flex;gap:10px;align-items:center';
  el.innerHTML = `<svg class="arrow" viewBox="0 0 64 64"><circle cx="32" cy="32" r="30" fill="#ebf4ff" stroke="#2b6cb0" stroke-width="2"/><path d="M32 6 L46 46 L32 38 L18 46 Z" fill="#2b6cb0"/></svg><div class="grow"><div class="mut">Hacia: <b>${esc(name)}</b></div><div class="big" id="navD">—</div><div class="mut" id="navB"></div></div><button class="btn dan" id="navX">✕</button>`;
  document.body.appendChild(el); el.querySelector('#navX').onclick = stopNav;
  if (S.pos) { setFollow(false); map.fitBounds(L.latLngBounds([target, [S.pos.lat, S.pos.lon]]), {padding: [80, 80], maxZoom: 18}); } else map.setView(target, Math.max(map.getZoom(), 16));
  navUpdate();
}
function navUpdate() {
  if (!NAV || !document.getElementById('navp')) return;
  if (!S.pos) { $('#navD').textContent = 'Sin GPS'; return; }
  const me_ = [S.pos.lat, S.pos.lon], d = distM(me_, NAV.target), b = bearing(me_, NAV.target);
  NAV.line.setLatLngs([me_, NAV.target]);
  $('#navD').textContent = fmtLen(d);
  const rel = heading != null ? (b - heading + 360) % 360 : b;
  $('#navB').innerHTML = `Rumbo ${fmt(b, 0)}° (${cardinal(b)})${heading != null ? ` · flecha según ${headingSrc}` : ' · flecha respecto al norte (sin brújula)'}${S.pos.acc > 10 ? ` · GPS ±${fmt(S.pos.acc, 0)} m` : ''}`;
  document.querySelector('#navp .arrow').style.transform = `rotate(${rel}deg)`;
  if (!NAV.arrived && d <= Math.max(5, S.pos.acc)) { NAV.arrived = true; if (navigator.vibrate) navigator.vibrate([200, 100, 200]); toast(`Llegaste a ${NAV.name}`, 4000); }
}
function stopNav() { if (!NAV) return; NAV.line.remove(); NAV.pin.remove(); document.getElementById('navp')?.remove(); NAV = null; }
INFO_ACTIONS.push({label: '🧭 Ir aquí', when: () => true, run: f => navigateTo(centroidOf(f).slice(0, 2), f.name || 'destino')});

/* ---- Ir a una coordenada ---- */
let gotoPin = null;
async function gotoCoord() {
  const last = S.settings.gotoCRS || 'EPSG:9377';
  const r = await dialog({
    title: 'Ir a una coordenada', body: `
      <label>Sistema<select id="gC">${Object.entries(CRS).map(([k, v]) => `<option value="${k}" ${k === last ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
      <label id="gXL">Este (X)<input id="gX" inputmode="decimal" placeholder=""></label>
      <label id="gYL">Norte (Y)<input id="gY" inputmode="decimal"></label>
      <p class="mut">Acepta coma o punto decimal y grados-minutos-segundos (p. ej. 4°35'12"N). En WGS84 también puedes pegar “lat, lon” en el primer campo.</p>`,
    buttons: [{label: 'Cancelar', value: null}, {label: 'Ir', cls: 'pri', value: d => {
      const crs = d.querySelector('#gC').value; let a = d.querySelector('#gX').value.trim(), b = d.querySelector('#gY').value.trim();
      if (crs === 'EPSG:4326' && !b && /[,;\s]/.test(a)) { const m = a.split(/\s*[;]\s*|\s*,\s+|\s+/); if (m.length >= 2) { a = m[0]; b = m[1]; } }
      let x = parseNum(a), y = parseNum(b); if (!isFinite(x) || !isFinite(y)) { toast('Revisa los valores'); return; }
      let lat, lon;
      if (crs === 'EPSG:4326') { lat = x; lon = y; if (Math.abs(lat) > 90 && Math.abs(lon) <= 90) [lat, lon] = [lon, lat]; }
      else [lon, lat] = proj4(crs, 'EPSG:4326', [x, y]);
      if (!isFinite(lat) || Math.abs(lat) > 90 || Math.abs(lon) > 180) { toast('Coordenada fuera de rango'); return; }
      return {lat, lon, crs};
    }}],
    onOpen: d => { const upd = () => { const g = d.querySelector('#gC').value === 'EPSG:4326'; d.querySelector('#gXL').firstChild.textContent = g ? 'Latitud' : 'Este (X)'; d.querySelector('#gYL').firstChild.textContent = g ? 'Longitud' : 'Norte (Y)'; }; d.querySelector('#gC').onchange = upd; upd(); }
  });
  if (!r) return;
  S.settings.gotoCRS = r.crs; Store.set('settings', S.settings);
  if (gotoPin) gotoPin.remove();
  gotoPin = L.marker([r.lat, r.lon], {icon: L.divIcon({className: '', html: '<div style="font-size:30px;line-height:30px;transform:translate(-3px,-26px)">📍</div>', iconSize: [24, 24]})}).addTo(map);
  setFollow(false); map.setView([r.lat, r.lon], Math.max(map.getZoom(), 17));
  const {e, n} = toCTM(r.lat, r.lon);
  const a = await dialog({title: 'Coordenada ubicada', body: `<table class="kv"><tr><td>Lat / Lon</td><td>${r.lat.toFixed(7)}, ${r.lon.toFixed(7)}</td></tr><tr><td>Origen Nacional</td><td>E ${fmt(e, 2)} · N ${fmt(n, 2)}</td></tr>${S.pos ? `<tr><td>Desde tu posición</td><td>${fmtLen(distM([S.pos.lat, S.pos.lon], [r.lat, r.lon]))} al ${cardinal(bearing([S.pos.lat, S.pos.lon], [r.lat, r.lon]))}</td></tr>` : ''}</table>`,
    stack: true, buttons: [{label: '🧭 Navegar hasta allí', value: 'nav', cls: 'pri'}, {label: 'Guardar como punto', value: 'save'}, {label: 'Cerrar', value: null}]});
  if (a === 'nav') navigateTo([r.lat, r.lon], 'coordenada');
  else if (a === 'save') {
    const d = await editDialog({title: 'Guardar punto', name: `Punto ${countType('point') + 1}`});
    if (d) { await saveFeature({id: uid(), layer: activeLayerId(), type: 'point', name: d.name, desc: d.desc, coords: [[r.lat, r.lon, null, Date.now()]], created: Date.now(), src: 'coordenada'}); gotoPin.remove(); gotoPin = null; toast('Punto guardado'); }
  }
}
MORE_ITEMS.push({label: '📍 Ir a una coordenada (WGS84 / Origen Nacional)', run: gotoCoord});

/* ---- Medición rápida ---- */
let MEAS = null;
function startMeasure() {
  if (S.rec) return toast('Termina primero el registro en curso');
  stopMeasure(); closeSheet();
  MEAS = {pts: [], line: L.polyline([], {color: '#d69e2e', weight: 3, interactive: false}).addTo(map), poly: L.polygon([], {color: '#d69e2e', weight: 0, fillOpacity: .15, interactive: false}).addTo(map), vtx: L.layerGroup().addTo(map)};
  S.tapHook = ll => { MEAS.pts.push([ll.lat, ll.lng]); measUpdate(); };
  S.backHook = stopMeasure;
  const el = document.createElement('div'); el.id = 'measp'; el.className = 'card panel';
  el.innerHTML = `<div style="display:flex;justify-content:space-between"><b>Medir</b><span class="mut">Toca el mapa para agregar puntos</span></div><div id="mS"></div><div class="row" style="margin-top:6px"><button class="btn" id="mC">+ En la cruz</button>${S.pos ? '<button class="btn" id="mG">+ GPS</button>' : ''}<button class="btn" id="mU">↶</button><button class="btn" id="mSv">Guardar</button><button class="btn dan" id="mX">✕</button></div>`;
  document.body.appendChild(el);
  el.querySelector('#mC').onclick = () => { const c = map.getCenter(); MEAS.pts.push([c.lat, c.lng]); measUpdate(); };
  const g = el.querySelector('#mG'); if (g) g.onclick = () => { if (!S.pos) return toast('Sin GPS'); MEAS.pts.push([S.pos.lat, S.pos.lon]); measUpdate(); };
  el.querySelector('#mU').onclick = () => { MEAS.pts.pop(); measUpdate(); };
  el.querySelector('#mX').onclick = stopMeasure;
  el.querySelector('#mSv').onclick = async () => {
    const n = MEAS.pts.length; if (n < 2) return toast('Agrega al menos 2 puntos');
    const as = n >= 3 ? await dialog({title: 'Guardar medición como…', stack: true, buttons: [{label: 'Polígono', value: 'polygon', cls: 'pri'}, {label: 'Línea', value: 'line'}, {label: 'Cancelar', value: null}]}) : 'line';
    if (!as) return;
    const d = await editDialog({title: 'Guardar', name: `${as === 'polygon' ? 'Polígono' : 'Línea'} ${countType(as) + 1}`}); if (!d) return;
    await saveFeature({id: uid(), layer: activeLayerId(), type: as, name: d.name, desc: d.desc, coords: MEAS.pts.map(p => [p[0], p[1], null, Date.now()]), created: Date.now()});
    stopMeasure(); toast('Guardado');
  };
  measUpdate();
}
function measUpdate() {
  const p = MEAS.pts; MEAS.line.setLatLngs(p); MEAS.poly.setLatLngs(p.length >= 3 ? p : []);
  MEAS.vtx.clearLayers(); p.forEach(x => L.circleMarker(x, {radius: 4, color: '#fff', weight: 1.5, fillColor: '#d69e2e', fillOpacity: 1, interactive: false}).addTo(MEAS.vtx));
  const last = p.length >= 2 ? distM(p[p.length - 2], p[p.length - 1]) : 0;
  $('#mS').innerHTML = `<span class="big">${fmtLen(lengthM(p))}</span>${p.length >= 2 ? ` <span class="mut">· último tramo ${fmtLen(last)} · rumbo ${fmt(bearing(p[p.length - 2], p[p.length - 1]), 0)}°</span>` : ''}${p.length >= 3 ? `<div class="mut">Área si se cierra: <b>${fmt(areaM2(p) / 1e4, 4)} ha</b> (${fmt(areaM2(p), 0)} m²) · perímetro ${fmtLen(perimM(p))}</div>` : ''}`;
}
function stopMeasure() { if (!MEAS) return; MEAS.line.remove(); MEAS.poly.remove(); MEAS.vtx.remove(); document.getElementById('measp')?.remove(); MEAS = null; S.tapHook = null; S.backHook = null; }
MORE_ITEMS.push({label: '📏 Medir distancia o área (sin guardar)', run: startMeasure});
/* botón flotante de medir */
(() => { const b = document.createElement('button'); b.title = 'Medir'; b.innerHTML = '<svg viewBox="0 0 24 24"><path d="M3 17L17 3l4 4L7 21z"/><path d="M7 13l2 2M10 10l2 2M13 7l2 2"/></svg>'; b.onclick = () => MEAS ? stopMeasure() : startMeasure(); $('#fab').appendChild(b); })();
