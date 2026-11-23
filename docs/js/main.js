/* ---------- Inicio ---------- */
(async () => {
  await Store.init();
  const st = await Store.get('settings').catch(() => null); if (st) Object.assign(S.settings, st);
  const ls = (await Store.all('layers').catch(() => [])) || [];
  if (!ls.find(l => l.id === 'mis-datos')) { const d = {id: 'mis-datos', name: 'Mis datos', color: '#e8590c', visible: true, order: 0}; ls.push(d); Store.put('layers', d).catch(() => {}); }
  ls.sort((a, b) => a.order - b.order).forEach(l => S.layers.set(l.id, l));
  S.activeLayer = (await Store.get('activeLayer').catch(() => null)) || 'mis-datos';
  ((await Store.all('features').catch(() => [])) || []).forEach(f => { S.features.set(f.id, f); renderFeature(f); });
  const base = await Store.get('base').catch(() => null);
  (BASES[base] || BASES['Satélite (Esri)']).addTo(map);
  map.on('baselayerchange', e => Store.set('base', e.name));
  const view = await Store.get('view').catch(() => null);
  if (view && view.c) map.setView(view.c, view.z);
  map.on('moveend', () => Store.set('view', {c: map.getCenter(), z: map.getZoom()}));
  for (const h of INIT_HOOKS) { try { await h(); } catch (e) { console.error(e); } }
  updLblZoom();
  startGPS();
  const draft = await Store.get('rec').catch(() => null);
  if (draft && draft.coords && draft.coords.length) {
    const go = await confirmDlg('Registro sin terminar', `Hay un ${draft.type === 'polygon' ? 'polígono' : 'track'} sin guardar con ${draft.coords.length} puntos. ¿Continuarlo?`, 'Continuar');
    if (go) beginRec(draft); else Store.rm('rec');
  }
  if (!CAP && 'serviceWorker' in navigator && window.isSecureContext) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (CAP) APPN.addListener('backButton', () => {
    if (dlgFinish) dlgFinish(null);
    else if (S.backHook) S.backHook();
    else if (!$('#sheetWrap').classList.contains('hidden')) closeSheet();
    else APPN.minimizeApp();
  });
})();
