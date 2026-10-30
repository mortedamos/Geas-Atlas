// Street-level town plans on the flat map. data/towns.json (tools/towns.mjs) holds a compact plan per settlement in feet around its
// position; this turns the plans of the towns in view into GeoJSON, and draws them at their own scale: a house stays 20-40 feet wide at
// every zoom. Plans fade in as you zoom (cities first), after the terrain symbols have faded out.
// A hand-made city map can replace a generated plan: data/town_maps.json lists {key, url, corners: [[lng,lat] x4 clockwise from top-left],
// minzoom}; the plan of that key is then left out and the image is shown instead.
const startTowns = () => {
  const atlas = window.atlas, map = atlas.map;
  const MIN_ZOOM = { 3: 14.2, 2: 15.0, 1: 15.8 }; // a plan fades in over one zoom level starting here
  const FADE = 1.0;
  const SRC = 'towns';
  let data = null, loading = null, images = [];
  const cache = new Map();

  // pixels per foot at zoom z: the world is 46,000-odd feet per map px (data.ft), and a map px is 2^z * 0.02778 screen px
  let FT = 5280 * 8.724; // feet per map px; data/scale.json has the calibrated value
  const pxPerFt = (z) => (0.027778 * 2 ** z) / FT;
  const widthAt = (ft, extra = 0) => ['interpolate', ['exponential', 2], ['zoom'], 14, ['+', ['*', ft, pxPerFt(14)], extra], 21, ['+', ['*', ft, pxPerFt(21)], extra]];
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
    const T = data.towns[key], out = [];
    const ll = (x, y) => { const wx = T.x + x / data.ft, wy = T.y - y / data.ft; return [(wx - 512) / 51.2, (512 - wy) / 51.2]; };
    const add = (k, geometry, props = {}) => out.push({ type: 'Feature', properties: { k, t: T.t, ...props }, geometry });
    const rect = (x, y, w, d, aDeg) => { const a = (aDeg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a); const c = (u, v) => ll(x + u * ca - v * sa, y + u * sa + v * ca); return { type: 'Polygon', coordinates: [[c(-w / 2, -d / 2), c(w / 2, -d / 2), c(w / 2, d / 2), c(-w / 2, d / 2), c(-w / 2, -d / 2)]] }; };
    const poly = (flat) => { const ring = []; for (let i = 0; i < flat.length; i += 2) ring.push(ll(flat[i], flat[i + 1])); ring.push(ring[0]); return { type: 'Polygon', coordinates: [ring] }; };
    const line = (flat) => { const pts = []; for (let i = 0; i < flat.length; i += 2) pts.push(ll(flat[i], flat[i + 1])); return { type: 'LineString', coordinates: pts }; };
    for (const w of T.wa) add('water', poly(w));
    for (const p of T.pl) add('plaza', poly(p));
    for (const [cls, pts] of T.st) add('street', line(pts), { w: [26, 17, 11][cls], c: cls });
    for (const [x, y, w, d, a, kind] of T.dk) add('dock', rect(x, y, w, d, a), { kind });
    for (const [x, y, w, d, a] of T.br) add('bridge', rect(x, y, w, d, a));
    for (const [x, y, w, d, a, c] of T.b) add('house', rect(x, y, w, d, a), { c });
    for (const [x, y, w, d, a, kind] of T.civ) add('civic', rect(x, y, w, d, a), { kind });
    for (const w of T.wl) add('wall', line(w), { w: T.t === 3 ? 11 : 8 });
    for (const [x, y, r] of T.tw) { const ring = []; for (let i = 0; i < 10; i++) ring.push(ll(x + Math.cos((i / 10) * 6.2832) * r, y + Math.sin((i / 10) * 6.2832) * r)); ring.push(ring[0]); add('tower', { type: 'Polygon', coordinates: [ring] }); }
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
      const fade = (op = 1) => ['interpolate', ['linear'], ['zoom'], mz, 0, mz + FADE, op];
      const L = (id, type, filter, layout, paint) => map.addLayer({ id: `town${tier}-${id}`, type, source: SRC, minzoom: mz, filter: ['all', T, filter], layout, paint }, before);
      L('water', 'fill', K('water'), {}, { 'fill-color': P.water, 'fill-opacity': fade() });
      L('plaza', 'fill', K('plaza'), {}, { 'fill-color': '#f6ecca', 'fill-opacity': fade(), 'fill-outline-color': '#b49a63' });
      L('street-casing', 'line', K('street'), { 'line-cap': 'round', 'line-join': 'round' }, { 'line-color': '#9c7f4d', 'line-opacity': fade(0.85), 'line-width': widthExpr('w', 1.3) });
      L('street', 'line', K('street'), { 'line-cap': 'round', 'line-join': 'round' }, { 'line-color': '#f6ecca', 'line-opacity': fade(), 'line-width': widthExpr('w') });
      L('dock', 'fill', K('dock'), {}, { 'fill-color': '#7a5a37', 'fill-opacity': fade(), 'fill-outline-color': '#3a2a1c' });
      L('bridge', 'fill', K('bridge'), {}, { 'fill-color': '#a58656', 'fill-opacity': fade(), 'fill-outline-color': '#3a2a1c' });
      L('house', 'fill', K('house'), {}, { 'fill-color': ['match', ['get', 'c'], 0, '#c9906a', 1, '#bb8159', '#d39d76'], 'fill-opacity': fade(), 'fill-outline-color': '#4a3220' });
      L('civic', 'fill', K('civic'), {}, { 'fill-color': ['match', ['get', 'kind'], 1, '#8a4a34', '#a8553a'], 'fill-opacity': fade(), 'fill-outline-color': '#3a2a1c' });
      L('wall', 'line', K('wall'), { 'line-cap': 'butt', 'line-join': 'round' }, { 'line-color': '#4a3220', 'line-opacity': fade(), 'line-width': widthExpr('w') });
      L('tower', 'fill', K('tower'), {}, { 'fill-color': '#5b4129', 'fill-opacity': fade(), 'fill-outline-color': '#2a1a0c' });
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
