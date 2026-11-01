// Fractal coasts on the flat map. The traced coast is straight between points several miles apart; zoomed in, the land is redrawn from
// land.geojson with fractal detail (fractalcoast.js) down to a few pixels per piece, for the part of the coast in view. The detail
// only roughens pieces shorter than a few hundred feet, so the coast stays where it was traced. tools/towns.mjs uses the same
// function, so harbours and quays sit on this shore.
const startCoast = () => {
  const atlas = window.atlas, map = atlas.map, FC = window.FractalCoast;
  const SRC = 'land-detail', FROM = 12.8, SHOW = 13.5, HIDE_BASE = 14; // data from FROM, drawn from SHOW; the traced coast is drawn up to HIDE_BASE
  let FT = 5280 * 8.724, polys = null, last = '';
  const ll = ([x, y]) => [(x - 512) / 51.2, (512 - y) / 51.2];
  const px = ([lng, lat]) => [lng * 51.2 + 512, 512 - lat * 51.2];
  const pxPerFt = (z) => (0.027778 * 2 ** z) / FT;

  async function load() {
    try { FT = 5280 * (await (await fetch('data/scale.json', { cache: 'no-store' })).json()).milesPerWorldPx; } catch { /* default */ }
    const g = (await (await fetch('data/land.geojson')).json()).features[0].geometry;
    polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).map((p) => {
      const rings = p.map((r) => r.map(px)), xs = rings[0].map((c) => c[0]), ys = rings[0].map((c) => c[1]);
      return { rings, bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
    });
  }

  function addLayers() {
    if (map.getSource(SRC)) return;
    map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, maxzoom: 20, tolerance: 0.05, buffer: 64 });
    const P = atlas.PALETTE, first = map.getLayer('terrain-forest') ? 'terrain-forest' : undefined;
    map.addLayer({ id: 'land-detail-shadow', type: 'line', source: SRC, minzoom: SHOW, paint: { 'line-color': '#2a1a0c', 'line-opacity': 0.4, 'line-width': 14, 'line-blur': 6 } }, 'land-fill');
    map.addLayer({ id: 'land-detail-fill', type: 'fill', source: SRC, minzoom: SHOW, paint: { 'fill-color': P.land, 'fill-antialias': true } }, first);
    map.addLayer({ id: 'land-detail-edge', type: 'line', source: SRC, minzoom: SHOW, layout: { 'line-join': 'round' }, paint: { 'line-color': P.landEdge, 'line-width': 2.2 } }, 'land-edge');
    for (const id of ['land-shadow', 'land-fill', 'land-edge']) map.setLayerZoomRange(id, 0, HIDE_BASE);
  }

  function update() {
    if (!polys || !map.getSource(SRC)) return;
    const z = map.getZoom();
    if (z < FROM) { if (last) { map.getSource(SRC).setData({ type: 'FeatureCollection', features: [] }); last = ''; } return; }
    const b = map.getBounds(), [x0, y1] = px([b.getWest(), b.getSouth()]), [x1, y0] = px([b.getEast(), b.getNorth()]);
    const mx = (x1 - x0) * 0.3, my = (y1 - y0) * 0.3, X0 = x0 - mx, X1 = x1 + mx, Y0 = y0 - my, Y1 = y1 + my;
    const minFt = Math.max(12, Math.min(FC.COARSE, 4 / pxPerFt(z))); // a piece is about 4 screen pixels
    const sig = [Math.round(X0 * 20), Math.round(Y0 * 20), Math.round(X1 * 20), Math.round(Y1 * 20), Math.round(minFt)].join(',');
    if (sig === last) return;
    last = sig;
    const near = (a, c) => Math.max(a[0], c[0]) >= X0 && Math.min(a[0], c[0]) <= X1 && Math.max(a[1], c[1]) >= Y0 && Math.min(a[1], c[1]) <= Y1;
    const feats = [];
    for (const P of polys) {
      if (P.bb[2] < X0 || P.bb[0] > X1 || P.bb[3] < Y0 || P.bb[1] > Y1) continue;
      const rings = P.rings.map((r) => FC.refinePolyline(r, FT, minFt, (i) => near(r[i], r[i + 1])).map(ll));
      feats.push({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: rings } });
    }
    map.getSource(SRC).setData({ type: 'FeatureCollection', features: feats });
  }

  const ready = async () => { await load(); addLayers(); update(); map.on('moveend', update); map.on('zoomend', update); };
  if (map.loaded()) ready(); else map.once('load', ready);
  atlas.coast = { update };
};
(function wait() { if (window.atlas && window.FractalCoast) startCoast(); else setTimeout(wait, 30); })();
