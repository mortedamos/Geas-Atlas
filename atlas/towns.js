// Street-level town plans on the flat map. data/towns.json (tools/towns.mjs) holds a compact plan per settlement in feet around its
// position; this turns the plans of the towns in view into GeoJSON, and draws them at their own scale: a house stays 20-40 feet wide at
// every zoom. Plans fade in as you zoom (cities first), after the terrain symbols have faded out.
// Each plan has a style (T.s) for the people who built it: radial (human), grid (Atman, Roman), nile (Egyptian), spiral (elven), fan (dwarven),
// slab (orcish), wander (goblin). The style sets colours here, and shapes: elven houses are ovals, dwarven halls step in.
// A hand-made city map can replace a generated plan: data/town_maps.json lists {key, url, corners: [[lng,lat] x4 clockwise from top-left],
// minzoom}; the plan of that key is then left out and the image is shown instead.
const startTowns = () => {
  const atlas = window.atlas, map = atlas.map;
  const MIN_ZOOM = { 3: 14.2, 2: 15.0, 1: 15.8 }; // a plan fades in over one zoom level starting here
  const FADE = 1.0;
  const SRC = 'towns';
  let data = null, loading = null, images = [];
  const cache = new Map();

  // ---- colours of each people's quarter ----
  const PAL = {
    radial: { house: ['#c9906a', '#bb8159', '#d39d76'], edge: '#4a3220', civic: ['#a8553a', '#8a4a34'], street: '#f6ecca', casing: '#9c7f4d', wall: '#4a3220', tower: '#5b4129', plaza: '#f6ecca' },
    grid: { house: ['#d58f5e', '#c97f4f', '#dd9d6b'], edge: '#5a3a22', civic: ['#e8dfc8', '#cfc2a6'], street: '#f3e9c9', casing: '#a38a5a', wall: '#6b5a44', tower: '#6b5a44', plaza: '#f3e9c9' },
    nile: { house: ['#e0c48e', '#d6b87c', '#e8cf9d'], edge: '#8a6a40', civic: ['#dcb86a', '#c9a24e'], street: '#f1e3b8', casing: '#b09460', wall: '#a58650', tower: '#a58650', plaza: '#f1e3b8' },
    spiral: { house: ['#bccb94', '#b0c186', '#c7d49f'], edge: '#3f5a2c', civic: ['#a9c48a', '#8fb06f'], street: '#fbf5dc', casing: '#a8b08a', wall: '#566f3f', tower: '#6a8a4e', plaza: '#e6efc8' },
    fan: { house: ['#8d867c', '#7d776e', '#9a9388'], edge: '#2e2a26', civic: ['#c9a24a', '#b58f3c'], street: '#efe4c6', casing: '#6e6252', wall: '#3b3631', tower: '#3b3631', plaza: '#e8dcc0' },
    slab: { house: ['#a39f98', '#96928b', '#aeaaa2'], edge: '#2a2724', civic: ['#6f6b66', '#5f5b56'], street: '#e4dccb', casing: '#7a7468', wall: '#4a4742', tower: '#3b3835', plaza: '#d9d2c0' },
    norse: { house: ['#a87c4e', '#97693c', '#8f9a5c'], edge: '#3d2a16', civic: ['#7a4e2b', '#6a4223'], street: '#e8dcb0', casing: '#8a7340', wall: '#5a3d1e', tower: '#5a3d1e', plaza: '#e2d4a6' },
    burrow: { house: ['#c8a974', '#b99a63', '#d3b784'], edge: '#5b4a28', civic: ['#8ea35c', '#7a9150'], street: '#efe3b5', casing: '#a58f5a', wall: '#6b5a30', tower: '#6b5a30', plaza: '#cfe0a0' },
    maze: { house: ['#c9b18a', '#bda47c', '#d4bf9a'], edge: '#4a3826', civic: ['#a8553a', '#8a4a34'], street: '#efe3c4', casing: '#9c8660', wall: '#5a4a38', tower: '#5a4a38', plaza: '#eadfc0' },
    wander: { house: ['#a98b62', '#97794f', '#b79a70'], edge: '#4a3a22', civic: ['#7a5a35', '#6a4c2b'], street: '#d9c79a', casing: '#8c7448', wall: '#5a4326', tower: '#5a4326', plaza: '#cdb985' },
  };
  const byStyle = (fn) => ['match', ['get', 's'], ...Object.keys(PAL).filter((k) => k !== 'radial').flatMap((k) => [k, fn(PAL[k])]), fn(PAL.radial)];

  // pixels per foot at zoom z: a map px is 2^z * 0.02778 screen px, and FT feet make one map px
  let FT = 5280 * 8.724; // data/scale.json has the calibrated value
  const pxPerFt = (z) => (0.027778 * 2 ** z) / FT;
  const widthExpr = (key, extra = 0) => ['interpolate', ['exponential', 2], ['zoom'], 14, ['+', ['*', ['get', key], pxPerFt(14)], extra], 21, ['+', ['*', ['get', key], pxPerFt(21)], extra]];

  async function load() {
    loading ??= Promise.all([
      fetch('data/towns.json').then((r) => r.json()),
      fetch('data/town_maps.json').then((r) => (r.ok ? r.json() : [])).catch(() => []),
    ]).then(([d, imgs]) => { data = d; images = Array.isArray(imgs) ? imgs : []; addImages(); });
    return loading;
  }

  // ---- plan -> GeoJSON ----
  function featuresOf(key) {
    if (cache.has(key)) return cache.get(key);
    const T = data.towns[key], out = [], s = T.s || 'radial', ru = T.ru ? 1 : 0;
    const ll = (x, y) => { const wx = T.x + x / data.ft, wy = T.y - y / data.ft; return [(wx - 512) / 51.2, (512 - wy) / 51.2]; };
    const add = (k, geometry, props = {}) => out.push({ type: 'Feature', properties: { k, t: T.t, s, ru, ...props }, geometry });
    const corners = (x, y, w, d, aDeg, f = 1) => { const a = (aDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a), c = (u, v) => ll(x + u * ca - v * sa, y + u * sa + v * ca); const hw = (w * f) / 2, hd = (d * f) / 2; return [c(-hw, -hd), c(hw, -hd), c(hw, hd), c(-hw, hd), c(-hw, -hd)]; };
    const rect = (x, y, w, d, a, f) => ({ type: 'Polygon', coordinates: [corners(x, y, w, d, a, f)] });
    const oval = (x, y, w, d, aDeg) => { const a = (aDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a), ring = []; for (let i = 0; i < 14; i++) { const t = (i / 14) * 6.2832, u = (Math.cos(t) * w) / 2, v = (Math.sin(t) * d) / 2; ring.push(ll(x + u * ca - v * sa, y + u * sa + v * ca)); } ring.push(ring[0]); return { type: 'Polygon', coordinates: [ring] }; };
    const poly = (flat) => { const ring = []; for (let i = 0; i < flat.length; i += 2) ring.push(ll(flat[i], flat[i + 1])); ring.push(ring[0]); return { type: 'Polygon', coordinates: [ring] }; };
    const line = (flat) => { const pts = []; for (let i = 0; i < flat.length; i += 2) pts.push(ll(flat[i], flat[i + 1])); return { type: 'LineString', coordinates: pts }; };
    const disc = (x, y, r, n = 10) => { const ring = []; for (let i = 0; i < n; i++) ring.push(ll(x + Math.cos((i / n) * 6.2832) * r, y + Math.sin((i / n) * 6.2832) * r)); ring.push(ring[0]); return { type: 'Polygon', coordinates: [ring] }; };
    for (const w of T.wa) add('water', poly(w));
    for (const p of T.pl) add('plaza', poly(p));
    for (const [cls, pts] of T.st) add('street', line(pts), { w: [26, 17, 11][cls], c: cls });
    for (const [x, y, r, kind] of T.tr || []) add('tree', disc(x, y, r, kind === 2 ? 14 : 10), { kind });
    for (const [x, y, w, d, a, kind] of T.dk) add('dock', rect(x, y, w, d, a), { kind });
    for (const [x, y, w, d, a] of T.br) add('bridge', rect(x, y, w, d, a));
    for (const [x, y, w, d, a, c] of T.b) {
      add('house', s === 'spiral' ? oval(x, y, w, d, a) : s === 'burrow' ? oval(x, y, w, w, a) : rect(x, y, w, d, a), { c });
      if (s === 'fan' && w > 30) add('cap', rect(x, y, w, d, a, 0.6)); // dwarven halls step in
    }
    for (const [x, y, w, d, a, kind] of T.civ) {
      add('civic', kind === 2 ? oval(x, y, w, d, a) : rect(x, y, w, d, a), { kind });
      if (s === 'fan' && kind === 3) add('cap', rect(x, y, w, d, a, 0.7));
    }
    for (const [thick, ...pts] of T.wl) add('wall', line(pts), { w: thick || (T.t === 3 ? 11 : 8) });
    for (const [x, y, r] of T.tw) add('tower', disc(x, y, r), {});
    for (const [text, x, y] of T.lb) add('label', { type: 'Point', coordinates: ll(x, y) }, { l: text });
    cache.set(key, out);
    return out;
  }
  const skipKeys = () => new Set(images.map((i) => i.key));

  // ---- which plans are in view ----
  let shown = '';
  function update() {
    if (!data || !map.getSource(SRC)) return;
    const z = map.getZoom(), skip = skipKeys();
    let keys = [];
    if (z >= 13.8) {
      const b = map.getBounds(), w = b.getWest(), e = b.getEast(), s = b.getSouth(), n = b.getNorth();
      for (const [key, T] of Object.entries(data.towns)) {
        if (skip.has(key) || z < MIN_ZOOM[T.t] - 0.2) continue;
        const reach = (T.r * 1.4) / data.ft / 51.2, lng = (T.x - 512) / 51.2, lat = (512 - T.y) / 51.2;
        if (lng + reach >= w && lng - reach <= e && lat + reach >= s && lat - reach <= n) keys.push(key);
      }
      keys = keys.slice(0, 14);
    }
    const sig = keys.join('|');
    if (sig === shown) return;
    shown = sig;
    map.getSource(SRC).setData({ type: 'FeatureCollection', features: keys.flatMap(featuresOf) });
  }

  // ---- layers ----
  const K = (k) => ['==', ['get', 'k'], k];
  function addLayers() {
    if (map.getSource(SRC)) return;
    map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, maxzoom: 20, tolerance: 0.2, buffer: 32 });
    const before = map.getLayer('river-names') ? 'river-names' : undefined;
    const P = atlas.PALETTE;
    for (const tier of [3, 2, 1]) {
      const mz = MIN_ZOOM[tier], T = ['==', ['get', 't'], tier];
      // ruins are drawn fainter
      const fade = (op = 1) => ['interpolate', ['linear'], ['zoom'], mz, 0, mz + FADE, ['case', ['==', ['get', 'ru'], 1], op * 0.55, op]];
      const L = (id, type, filter, layout, paint) => map.addLayer({ id: `town${tier}-${id}`, type, source: SRC, minzoom: mz, filter: ['all', T, filter], layout, paint }, before);
      L('water', 'fill', K('water'), {}, { 'fill-color': P.water, 'fill-opacity': fade() });
      L('plaza', 'fill', K('plaza'), {}, { 'fill-color': byStyle((p) => p.plaza), 'fill-opacity': fade(), 'fill-outline-color': '#b49a63' });
      L('street-casing', 'line', K('street'), { 'line-cap': 'round', 'line-join': 'round' }, { 'line-color': byStyle((p) => p.casing), 'line-opacity': fade(0.85), 'line-width': widthExpr('w', 1.3) });
      L('street', 'line', K('street'), { 'line-cap': 'round', 'line-join': 'round' }, { 'line-color': byStyle((p) => p.street), 'line-opacity': fade(), 'line-width': widthExpr('w') });
      L('tree', 'fill', K('tree'), {}, { 'fill-color': ['match', ['get', 'kind'], 1, '#a3b560', 2, '#4f8a4a', 3, '#b4cd7a', '#7fa06a'], 'fill-opacity': fade(0.82), 'fill-outline-color': '#3d5a30' });
      L('dock', 'fill', K('dock'), {}, { 'fill-color': '#7a5a37', 'fill-opacity': fade(), 'fill-outline-color': '#3a2a1c' });
      L('bridge', 'fill', K('bridge'), {}, { 'fill-color': '#a58656', 'fill-opacity': fade(), 'fill-outline-color': '#3a2a1c' });
      L('house', 'fill', K('house'), {}, { 'fill-color': byStyle((p) => ['match', ['get', 'c'], 0, p.house[0], 1, p.house[1], p.house[2]]), 'fill-opacity': fade(), 'fill-outline-color': byStyle((p) => p.edge) });
      L('cap', 'fill', K('cap'), {}, { 'fill-color': '#c9a24a', 'fill-opacity': fade(), 'fill-outline-color': '#2e2a26' });
      L('civic', 'fill', K('civic'), {}, { 'fill-color': byStyle((p) => ['match', ['get', 'kind'], 1, p.civic[1], p.civic[0]]), 'fill-opacity': fade(), 'fill-outline-color': byStyle((p) => p.edge) });
      L('wall', 'line', K('wall'), { 'line-cap': 'butt', 'line-join': 'round' }, { 'line-color': byStyle((p) => p.wall), 'line-opacity': fade(), 'line-width': widthExpr('w') });
      L('tower', 'fill', K('tower'), {}, { 'fill-color': byStyle((p) => p.tower), 'fill-opacity': fade(), 'fill-outline-color': '#2a1a0c' });
      L('label', 'symbol', K('label'), { 'text-field': ['get', 'l'], 'text-font': ['IM Fell English Italic'], 'text-size': ['interpolate', ['linear'], ['zoom'], 15, 10, 19, 15], 'text-allow-overlap': false }, { 'text-color': '#4a3220', 'text-halo-color': P.halo, 'text-halo-width': 1.3, 'text-opacity': fade() });
    }
  }
  function addImages() {
    for (const [i, im] of images.entries()) {
      const id = `townmap-${i}`;
      if (map.getSource(id)) continue;
      map.addSource(id, { type: 'image', url: im.url, coordinates: im.corners });
      map.addLayer({ id, type: 'raster', source: id, minzoom: im.minzoom ?? 14, paint: { 'raster-opacity': ['interpolate', ['linear'], ['zoom'], im.minzoom ?? 14, 0, (im.minzoom ?? 14) + 1, 1], 'raster-fade-duration': 0 } }, map.getLayer('river-names') ? 'river-names' : undefined);
    }
    shown = '';
    update();
  }

  const go = async () => { if (map.getZoom() >= 13.5 || data) { await load(); addLayers(); update(); } };
  const ready = async () => {
    try { FT = 5280 * (await (await fetch('data/scale.json', { cache: 'no-store' })).json()).milesPerWorldPx; } catch { /* keep the default */ }
    addLayers(); map.on('moveend', go); map.on('zoomend', go); go();
  };
  if (map.loaded()) ready(); else map.once('load', ready);
  atlas.towns = { update, get data() { return data; } };
};
(function wait() { if (window.atlas) startTowns(); else setTimeout(wait, 30); })();
