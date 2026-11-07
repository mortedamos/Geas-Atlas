// Where the chart sits on the world, for the flat map and the globe alike.
//
// The atlas data (and every tool that writes it) keeps the chart's own coordinates: "longitude / latitude" that are really world pixels,
// x = lng * 51.2 + 512, y = 512 - lat * 51.2, and the viewer's zoom numbers count from that. The chart is read as a Mercator map of a whole
// planet: 1950 px (x -800 .. 1150) is one full turn of longitude, Sellador's centre (y 262) is 49 N, and longitude 0 is the chart's centre
// line, x 175 (the same reading the grid and the old three.js globe used). MapLibre's globe needs real longitudes and latitudes, so this
// file converts at the edge of MapLibre and nowhere else:
//   chart coordinates / chart zoom  <->  world longitude / latitude / MapLibre zoom
// Because the chart is Mercator, the conversion is the same scale everywhere, so the flat map looks as it did and the globe is the same
// picture wrapped round a sphere. Zoom: a chart pixel is 512/1950 screen pixels at MapLibre zoom 0 but 360/(51.2*512) at chart zoom 0,
// so MapLibre zoom = chart zoom - Z_OFF (about 3.24).
(() => {
  const X0 = -800, W = 1950, Y49 = 262, DEG = 180 / Math.PI;
  const R = W / (2 * Math.PI);                       // chart px per radian
  const XC = X0 + W / 2;                              // chart x of longitude 0
  const M49 = Math.log(Math.tan(Math.PI / 4 + (49 * Math.PI) / 360));
  const Z_OFF = Math.log2((51.2 * 360) / W);          // 3.24: chart zoom minus MapLibre zoom

  const pxToW = (x, y) => [((x - XC) / R) * DEG, (2 * Math.atan(Math.exp(M49 + (Y49 - y) / R)) - Math.PI / 2) * DEG];
  const wToPx = ([lon, lat]) => {
    const m = Math.log(Math.tan(Math.PI / 4 + (lat / DEG) / 2));
    return [XC + (lon / DEG) * R, Y49 - (m - M49) * R];
  };
  const aToPx = ([lng, lat]) => [lng * 51.2 + 512, 512 - lat * 51.2];
  const pxToA = ([x, y]) => [(x - 512) / 51.2, (512 - y) / 51.2];
  const aToW = (c) => { const [x, y] = aToPx(c); return pxToW(x, y); };
  const wToA = (c) => pxToA(wToPx(c));

  // deep copy of a GeoJSON object with every coordinate sent through f
  const mapCoords = (c, f) => (typeof c[0] === 'number' ? f(c) : c.map((d) => mapCoords(d, f)));
  const geoMap = (g, f) => {
    if (!g) return g;
    if (g.type === 'FeatureCollection') return { ...g, features: g.features.map((x) => geoMap(x, f)) };
    if (g.type === 'Feature') return { ...g, geometry: geoMap(g.geometry, f) };
    if (g.type === 'GeometryCollection') return { ...g, geometries: g.geometries.map((x) => geoMap(x, f)) };
    return g.coordinates ? { ...g, coordinates: mapCoords(g.coordinates, f) } : g;
  };

  // zoom numbers inside style expressions: only the stops of interpolate / step on ['zoom'] move
  const isZoom = (e) => Array.isArray(e) && e[0] === 'zoom';
  function shiftExpr(e) {
    if (!Array.isArray(e)) return e;
    if (/^interpolate/.test(e[0]) && isZoom(e[2])) return [...e.slice(0, 3), ...e.slice(3).map((v, i) => (i % 2 === 0 ? v - Z_OFF : shiftExpr(v)))];
    if (e[0] === 'step' && isZoom(e[1])) return ['step', e[1], shiftExpr(e[2]), ...e.slice(3).map((v, i) => (i % 2 === 0 ? v - Z_OFF : shiftExpr(v)))];
    return e.map(shiftExpr);
  }
  const shiftProps = (o) => (o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, shiftExpr(v)])) : o);
  function shiftLayer(l) {
    const out = { ...l };
    if (typeof l.minzoom === 'number') out.minzoom = Math.max(0, l.minzoom - Z_OFF);
    if (typeof l.maxzoom === 'number') out.maxzoom = l.maxzoom - Z_OFF;
    if (l.paint) out.paint = shiftProps(l.paint);
    if (l.layout) out.layout = shiftProps(l.layout);
    if (l.filter) out.filter = shiftExpr(l.filter);
    return out;
  }

  // ---- the map, told in chart terms ----
  // Everything the viewer's own code says to MapLibre (new sources, layers, paint properties) is in chart terms; these wrappers translate it.
  // The style handed to `new Map` is translated by map.js with the same helpers; features it returns to us come back through fromWorld*.
  const P = maplibregl.Map.prototype;
  const wrap = (name, fn) => { const orig = P[name]; P[name] = function (...a) { return fn.call(this, orig.bind(this), ...a); }; };
  wrap('addSource', (orig, id, spec) => {
    if (spec && spec.type === 'geojson' && spec.data && typeof spec.data === 'object') spec = { ...spec, data: geoMap(spec.data, aToW) };
    else if (spec && (spec.type === 'image' || spec.type === 'video') && spec.coordinates) spec = { ...spec, coordinates: spec.coordinates.map(aToW) };
    if (spec && typeof spec.maxzoom === 'number') spec = { ...spec, maxzoom: spec.maxzoom - Z_OFF };
    return orig(id, spec);
  });
  wrap('addLayer', (orig, layer, before) => orig(shiftLayer(layer), before));
  wrap('setLayerZoomRange', (orig, id, min, max) => orig(id, Math.max(0, min - Z_OFF), max - Z_OFF));
  wrap('setPaintProperty', (orig, id, name, value, o) => orig(id, name, shiftExpr(value), o));
  wrap('setLayoutProperty', (orig, id, name, value, o) => orig(id, name, shiftExpr(value), o));
  wrap('getSource', (orig, id) => {
    const s = orig(id);
    if (s && s.type === 'geojson' && !s.__ap) {
      const setData = s.setData.bind(s);
      s.setData = (d, ...r) => setData(d && typeof d === 'object' ? geoMap(d, aToW) : d, ...r);
      s.__ap = true;
    }
    return s;
  });

  window.AP = {
    Z_OFF, R, XC, Y49, M49, X0, W,
    pxToW, wToPx, aToPx, pxToA, aToW, wToA, geoMap, shiftExpr, shiftLayer,
    geoToWorld: (g) => geoMap(g, aToW),
    // a point feature queried back from the map: its position in chart coordinates again
    featureBack: (f) => (f && f.geometry && f.geometry.type === 'Point' ? { type: 'Feature', properties: f.properties, geometry: { type: 'Point', coordinates: wToA(f.geometry.coordinates) } } : f),
    zoomOf: (map) => map.getZoom() + Z_OFF,
    // camera options in chart terms -> MapLibre's (center, bounds, zoom)
    cam: (o) => {
      const r = { ...o };
      if (r.center) r.center = aToW(r.center);
      if (typeof r.zoom === 'number') r.zoom -= Z_OFF;
      if (r.bounds) r.bounds = r.bounds.map(aToW);
      return r;
    },
  };
})();
