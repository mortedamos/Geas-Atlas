// The one visual style for the whole atlas lives here. Source data is plain GeoJSON in ./data.
const PALETTE = {
  deep: '#4d7479',
  coast: '#5e8588',
  shelf: '#7b9c99',
  shallows: '#a6bdaa',
  land: '#efe2bb',
  landEdge: '#3a2a1c',
  ink: '#3a2a1c',
  halo: '#f3e8c8',
  water: '#5e8f95',
};
const TERRAIN_FILL = {
  forest: ['#8c9f68', 0.6],
  newgrowth: ['#b4c684', 0.6],
  mountain: ['#b39c78', 0.5],
  hills: ['#cdb784', 0.55],
  marsh: ['#9dad88', 0.65],
  waste: ['#a39a88', 0.55],
  ruins: ['#a99f94', 0.5],
  ice: ['#e6eeea', 0.85],
  desert: ['#e7c680', 0.85],
  plains: ['#cdd68c', 0.5],
  jungle: ['#5f8d4c', 0.6],
};

// icon-size at SYMBOL_REF_ZOOM (1 = the symbol's natural on-screen size); at other zooms the symbols grow and shrink with the map
const SYMBOL_REF_ZOOM = 8;
const SYMBOL_SCALE = {
  forest: 0.46,
  newgrowth: 0.8,
  ruins: 0.38,
  marsh: 0.55,
  desert: 0.5,
  hills: 0.62,
  mountain: 0.62,
  plains: 0.5,
  jungle: 0.46,
};

// settlement size 1 / 2 / 3 = village (small) / town (medium) / city (large); other kinds of place have none
// The pack's village / town / city pictures are different widths, so scale each to a rendered width at zoom 8 of about 24 / 38 / 58 px.
const SETTLEMENT_SCALE = ['match', ['get', 'icon'], 'village', 0.221, 'town', 0.419, 'city', 0.829, 0.4];
const SETTLEMENT_NAME = { 1: 'Village · small', 2: 'Town · medium', 3: 'City · large' };
const PLACE_TEXT = { 1: [13, 19, 25], 2: [10.5, 14, 18], 3: [9, 12.5, 16] }; // label size at zoom 5 / 8 / 11 by rank

const zoomSize = (a, b, c) => ['interpolate', ['linear'], ['zoom'], 5, a, 8, b, 11, c];

// ---- latitude / longitude grid ----
// The chart is read as Mercator (see proj.js): 1950 px (x -800..1150) is one full turn, Sellador's centre (y 262) is 49 N, and longitude 0
// is the chart's centre line, x 175. So the grid is just real parallels (every 10 degrees) and meridians (every 15), already in world
// coordinates, cut into short pieces so they bend round the globe.
const hemi = (v, pos, neg) => (v === 0 ? '0°' : Math.abs(v) === 180 ? '180°' : `${Math.abs(v)}° ${v > 0 ? pos : neg}`);
function buildGraticule() {
  const features = [], GRID_TOP = 78, GRID_BOTTOM = -84; // the drawn world stops at about these latitudes
  const along = (from, to, at, step) => { const out = []; for (let v = from; v < to; v += step) out.push(at(v)); out.push(at(to)); return out; };
  // A parallel is cut into 30-degree pieces: drawn as one 360-degree line, MapLibre silently dropped every piece east of longitude 0.
  for (let lat = -80; lat <= 80; lat += 10) {
    const eq = lat === 0;
    for (let a = -180; a < 180; a += 30) {
      features.push({ type: 'Feature', properties: { kind: eq ? 'equator' : 'parallel', label: eq ? 'Equator' : hemi(lat, 'N', 'S'), major: lat % 30 === 0 }, geometry: { type: 'LineString', coordinates: along(a, a + 30, (lon) => [lon, lat], 5) } });
    }
  }
  for (let lon = -180; lon <= 180; lon += 15) {
    features.push({ type: 'Feature', properties: { kind: 'meridian', label: hemi(lon, 'E', 'W'), major: lon % 45 === 0 }, geometry: { type: 'LineString', coordinates: along(GRID_BOTTOM, GRID_TOP, (lat) => [lon, lat], 4) } });
  }
  return { type: 'FeatureCollection', features };
}
let gridOn = false;
try { gridOn = localStorage.getItem('atlas-grid') === '1'; } catch { /* storage unavailable */ }
const gridVis = gridOn ? 'visible' : 'none';

// ---- symbols are drawn on demand so every icon in the atlas shares one hand-made look ----
function drawIcon(name) {
  const S = 64, px = 2;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S * px;
  const g = cv.getContext('2d');
  g.scale(px, px);
  g.lineJoin = 'round'; g.lineCap = 'round';
  const [rawKind, vs] = name.split('-');
  const kind = rawKind === 'sapling' || rawKind === 'jungle' ? 'tree' : rawKind; // code-drawn fallback: a sapling or a jungle tree is just a tree
  const v = Number(vs) || 0;
  const ink = PALETTE.ink;

  if (kind === 'tree') {
    g.fillStyle = '#6b4f33'; g.fillRect(30, 46, 4, 10);
    const blobs = [[[22, 38, 11], [42, 38, 11], [32, 25, 12]], [[20, 40, 10], [44, 40, 10], [32, 30, 13], [32, 18, 9]], [[24, 36, 10], [41, 40, 10], [33, 24, 12]]][v % 3];
    for (const [cx, cy, r] of blobs) {
      const grd = g.createRadialGradient(cx - 3, cy - 3, 1, cx, cy, r);
      grd.addColorStop(0, '#86a553'); grd.addColorStop(1, '#4d6b34');
      g.fillStyle = grd; g.beginPath(); g.arc(cx, cy, r, 0, Math.PI * 2); g.fill();
      g.strokeStyle = '#2f4222'; g.lineWidth = 1.6; g.stroke();
    }
  } else if (kind === 'mtn') {
    const peaks = [[[6, 58, 32, 8, 58, 58]], [[4, 58, 22, 20, 36, 58], [24, 58, 44, 6, 62, 58]], [[8, 58, 30, 14, 52, 58], [34, 58, 48, 28, 60, 58]]][v % 3];
    for (const [x0, y0, x1, y1, x2, y2] of peaks) {
      g.fillStyle = '#c4b594'; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.lineTo(x2, y2); g.closePath(); g.fill();
      g.fillStyle = '#8f7e60'; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.lineTo((x1 + x2) / 2 + 2, y2); g.closePath(); g.fill();
      g.fillStyle = '#fbf8ef'; g.beginPath(); g.moveTo(x1, y1); g.lineTo(x1 - (x1 - x0) * 0.24, y1 + (y2 - y1) * 0.24); g.lineTo(x1 - 2, y1 + (y2 - y1) * 0.17); g.lineTo(x1 + 3, y1 + (y2 - y1) * 0.26); g.lineTo(x1 + (x2 - x1) * 0.22, y1 + (y2 - y1) * 0.22); g.closePath(); g.fill();
      g.strokeStyle = ink; g.lineWidth = 1.8; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.lineTo(x2, y2); g.stroke();
    }
  } else if (kind === 'hill') {
    const w = [44, 36, 50][v % 3], h = [20, 24, 18][v % 3];
    g.fillStyle = '#d8cb9d'; g.beginPath(); g.moveTo(32 - w / 2, 52); g.quadraticCurveTo(32, 52 - h * 2, 32 + w / 2, 52); g.closePath(); g.fill();
    g.strokeStyle = ink; g.lineWidth = 1.8; g.beginPath(); g.moveTo(32 - w / 2, 52); g.quadraticCurveTo(32, 52 - h * 2, 32 + w / 2, 52); g.stroke();
  } else if (kind === 'arrow') {
    g.fillStyle = v === 1 ? '#bfe3ef' : '#f6c58f'; g.strokeStyle = v === 1 ? '#1c4a6a' : '#8a4a1c'; g.lineWidth = 3; // arrow-1 is the cold current's
    g.beginPath(); g.moveTo(48, 32); g.lineTo(18, 14); g.lineTo(26, 32); g.lineTo(18, 50); g.closePath(); g.fill(); g.stroke();
  } else if (kind === 'marsh') {
    // reed tufts over a short water dash
    g.strokeStyle = '#4f7a8c'; g.lineWidth = 2; g.beginPath(); g.moveTo(14, 50); g.lineTo(50, 50); g.stroke();
    g.strokeStyle = '#3f5a2c'; g.lineWidth = 2;
    const tufts = [[[20, 48], [32, 48], [44, 48]], [[18, 48], [30, 48], [46, 48]], [[24, 48], [36, 48], [42, 48]]][v % 3];
    for (const [tx, ty] of tufts) for (const dx of [-4, 0, 4]) { g.beginPath(); g.moveTo(tx + dx * 0.4, ty); g.lineTo(tx + dx, ty - (dx === 0 ? 20 : 14)); g.stroke(); }
  } else if (kind === 'grass') {
    // a few blades of grass along a short ground line
    g.strokeStyle = '#5b6b34'; g.lineWidth = 2;
    const tufts = [[[22, 50], [36, 50]], [[18, 50], [32, 50], [46, 50]], [[26, 50], [42, 50]]][v % 3];
    for (const [tx, ty] of tufts) for (const dx of [-5, 0, 5]) { g.beginPath(); g.moveTo(tx + dx * 0.3, ty); g.lineTo(tx + dx, ty - (dx === 0 ? 14 : 10)); g.stroke(); }
  } else if (kind === 'poi') {
    const type = vs;
    g.strokeStyle = ink; g.fillStyle = ink; g.lineWidth = 2.4;
    const c = 32;
    if (type === 'city') { g.beginPath(); g.arc(c, c, 11, 0, 7); g.fillStyle = PALETTE.halo; g.fill(); g.stroke(); g.beginPath(); g.arc(c, c, 5.5, 0, 7); g.fillStyle = ink; g.fill(); }
    else if (type === 'town' || type === 'port') { g.beginPath(); g.arc(c, c, 7, 0, 7); g.fillStyle = ink; g.fill(); if (type === 'port') { g.strokeStyle = '#1f5a85'; g.lineWidth = 2; g.beginPath(); g.arc(c, c, 11, 0, 7); g.stroke(); } }
    else if (type === 'village') { g.beginPath(); g.arc(c, c, 5, 0, 7); g.fillStyle = PALETTE.halo; g.fill(); g.stroke(); }
    else if (type === 'fort') { g.fillStyle = ink; g.fillRect(c - 8, c - 6, 16, 14); g.fillRect(c - 10, c - 10, 5, 6); g.fillRect(c - 2.5, c - 10, 5, 6); g.fillRect(c + 5, c - 10, 5, 6); }
    else if (type === 'mine') { g.lineWidth = 3.2; g.beginPath(); g.moveTo(c - 10, c - 8); g.lineTo(c + 10, c + 10); g.moveTo(c + 10, c - 8); g.lineTo(c - 10, c + 10); g.stroke(); g.beginPath(); g.arc(c, c, 3.5, 0, 7); g.fillStyle = PALETTE.halo; g.fill(); g.stroke(); }
    else if (type === 'tower') { g.fillStyle = ink; g.fillRect(c - 4, c - 12, 8, 24); g.fillRect(c - 7, c - 14, 14, 5); }
    else if (type === 'temple') { g.beginPath(); g.moveTo(c, c - 11); g.lineTo(c + 9, c); g.lineTo(c, c + 11); g.lineTo(c - 9, c); g.closePath(); g.fillStyle = PALETTE.halo; g.fill(); g.stroke(); }
    else { g.beginPath(); g.arc(c, c, 6, 0, 7); g.fill(); }
  }
  return { data: g.getImageData(0, 0, S * px, S * px), pixelRatio: px };
}

const style = {
  version: 8,
  name: 'geas-atlas',
  glyphs: 'glyphs/{fontstack}/{range}.pbf',
  sources: {
    land: { type: 'geojson', data: 'data/land.geojson' },
    bands: { type: 'geojson', data: 'data/water_bands.geojson' },
    terrain: { type: 'geojson', data: 'data/terrain.geojson' },
    icons: { type: 'geojson', data: 'data/icons.geojson' },
    rivers: { type: 'geojson', data: 'data/rivers.geojson' },
    roads: { type: 'geojson', data: 'data/roads.geojson' },
    currents: { type: 'geojson', data: 'data/currents.geojson' },
    lost: { type: 'geojson', data: 'data/lost.geojson' },
    lakes: { type: 'geojson', data: 'data/lakes.geojson' },
    places: { type: 'geojson', data: 'data/places.geojson' },
    regions: { type: 'geojson', data: 'data/regions.geojson' },
    graticule: { type: 'geojson', data: buildGraticule() },
  },
  layers: [
    { id: 'ocean', type: 'background', paint: { 'background-color': PALETTE.deep } },
    ...['coast', 'shelf', 'shallows'].map((band) => ({
      id: `band-${band}`, type: 'fill', source: 'bands', filter: ['==', ['get', 'band'], band],
      paint: { 'fill-color': PALETTE[band], 'fill-antialias': true },
    })),
    { id: 'band-lines', type: 'line', source: 'bands', paint: { 'line-color': '#f3e8c8', 'line-opacity': 0.26, 'line-width': 0.8 } },
    // warm ocean current: a dashed band with arrows and its name running along it
    { id: 'currents-line', type: 'line', source: 'currents', layout: { 'line-cap': 'round' }, paint: { 'line-color': ['case', ['get', 'warm'], '#b8452a', '#2f6f93'], 'line-opacity': 0.5, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 3, 6, 6, 9, 10], 'line-blur': 2.5 } },
    { id: 'currents-dash', type: 'line', source: 'currents', paint: { 'line-color': ['case', ['get', 'warm'], '#e6bd62', '#bfe3ef'], 'line-opacity': 0.85, 'line-dasharray': [3, 3], 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.8, 8, 1.6] } },
    { id: 'currents-arrows', type: 'symbol', source: 'currents', layout: { 'symbol-placement': 'line', 'symbol-spacing': 170, 'icon-image': ['case', ['get', 'warm'], 'arrow-0', 'arrow-1'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 3, 0.45, 8, 0.8], 'icon-rotation-alignment': 'map', 'icon-allow-overlap': true, 'icon-ignore-placement': true } },
    { id: 'currents-name', type: 'symbol', source: 'currents', minzoom: 4.8, layout: { 'symbol-placement': 'line', 'symbol-spacing': 520, 'text-field': ['get', 'name'], 'text-font': ['IM Fell English Italic'], 'text-size': ['interpolate', ['linear'], ['zoom'], 5, 11, 9, 16], 'text-letter-spacing': 0.12, 'text-offset': [0, -1] }, paint: { 'text-color': ['case', ['get', 'warm'], '#f3dca0', '#d6eef7'], 'text-halo-color': ['case', ['get', 'warm'], '#5a1f12', '#12384f'], 'text-halo-width': 1.6 } },
    // lost lands (Enaria): a faint ghost outline inside a swirl of time, never real coast
    { id: 'lost-glow', type: 'fill', source: 'lost', filter: ['==', ['get', 'part'], 'glow'], paint: { 'fill-color': '#b9a8e6', 'fill-opacity': 0.16 } },
    { id: 'lost-glow-edge', type: 'line', source: 'lost', filter: ['==', ['get', 'part'], 'glow'], paint: { 'line-color': '#d8cdf5', 'line-opacity': 0.35, 'line-width': 1.2, 'line-dasharray': [1, 3], 'line-blur': 0.6 } },
    { id: 'lost-swirl', type: 'line', source: 'lost', filter: ['==', ['get', 'part'], 'swirl'], layout: { 'line-cap': 'round' }, paint: { 'line-color': '#e3dafb', 'line-opacity': 0.6, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1, 7, 2.4], 'line-dasharray': [4, 3] } },
    { id: 'lost-island', type: 'fill', source: 'lost', filter: ['==', ['get', 'part'], 'island'], paint: { 'fill-color': '#ddd3f6', 'fill-opacity': 0.3 } },
    { id: 'lost-island-edge', type: 'line', source: 'lost', filter: ['==', ['get', 'part'], 'island'], paint: { 'line-color': '#f1ecff', 'line-opacity': 0.85, 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1, 7, 1.8], 'line-dasharray': [2, 2] } },
    { id: 'land-shadow', type: 'line', source: 'land', paint: { 'line-color': '#2a1a0c', 'line-opacity': 0.4, 'line-width': zoomSize(3, 8, 14), 'line-blur': 6 } },
    { id: 'land-fill', type: 'fill', source: 'land', paint: { 'fill-color': PALETTE.land } },
    ...Object.entries(TERRAIN_FILL).map(([kind, [color, opacity]]) => ({
      id: `terrain-${kind}`, type: 'fill', source: 'terrain', filter: ['==', ['get', 'kind'], kind],
      paint: { 'fill-color': color, 'fill-opacity': opacity, 'fill-antialias': true },
    })),
    { id: 'lakes-fill', type: 'fill', source: 'lakes', paint: { 'fill-color': PALETTE.water } },
    { id: 'lakes-edge', type: 'line', source: 'lakes', paint: { 'line-color': PALETTE.landEdge, 'line-width': 1 } },
    { id: 'rivers', type: 'line', source: 'rivers', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': PALETTE.water, 'line-width': ['interpolate', ['linear'], ['zoom'], 5, ['*', ['coalesce', ['get', 'w'], 1], 0.8], 8, ['*', ['coalesce', ['get', 'w'], 1], 2.2], 11, ['*', ['coalesce', ['get', 'w'], 1], 5]] } },
    { id: 'roads-casing', type: 'line', source: 'roads', layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': PALETTE.halo, 'line-opacity': 0.8, 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 2.4, 10, 6] } },
    { id: 'roads', type: 'line', source: 'roads', layout: { 'line-cap': 'butt', 'line-join': 'round' }, paint: { 'line-color': '#8a3a22', 'line-dasharray': [2, 1.6], 'line-width': ['interpolate', ['linear'], ['zoom'], 6, 1, 10, 2.4] } },
    { id: 'land-edge', type: 'line', source: 'land', layout: { 'line-join': 'round' }, paint: { 'line-color': PALETTE.landEdge, 'line-width': ['interpolate', ['linear'], ['zoom'], 4, 0.8, 10, 2.2] } },

    // latitude / longitude grid (off until switched on in the Layers panel; the globe shares the switch)
    { id: 'grid-lines', type: 'line', source: 'graticule', filter: ['!=', ['get', 'kind'], 'equator'], layout: { visibility: gridVis }, paint: { 'line-color': '#4a2f16', 'line-opacity': 0.42, 'line-width': ['case', ['get', 'major'], 1.3, 0.7] } },
    { id: 'grid-equator', type: 'line', source: 'graticule', filter: ['==', ['get', 'kind'], 'equator'], layout: { visibility: gridVis }, paint: { 'line-color': '#9a2f1c', 'line-opacity': 0.8, 'line-width': 1.5, 'line-dasharray': [5, 3] } },
    // the line under the pointer, with its degrees shown in a tooltip (see the grid hover handler below)
    { id: 'grid-hover', type: 'line', source: 'graticule', filter: ['==', ['get', 'label'], ''], layout: { visibility: gridVis }, paint: { 'line-color': '#9a2f1c', 'line-opacity': 0.9, 'line-width': 2.4 } },

    // symbols: three density tiers fade in as you zoom
    ...[['forest', 'tree'], ['jungle', 'jungle'], ['newgrowth', 'sapling'], ['plains', 'grass'], ['ruins', 'ruinfield'], ['marsh', 'marsh'], ['desert', 'desert'], ['hills', 'hill'], ['mountain', 'mtn']].flatMap(([kind, icon]) =>
      [[0, 5.2], [1, 6.2], [2, 7.0], [3, 9.8], [4, 10.2], [5, 10.6]].map(([tier, minzoom]) => ({
        id: `sym-${kind}-${tier}`, type: 'symbol', source: 'icons', minzoom,
        filter: ['all', ['==', ['get', 'kind'], kind], ['==', ['get', 'tier'], tier]],
        layout: {
          'icon-image': ['concat', icon, '-', ['to-string', ['get', 'v']]],
          // fixed to the map: the size at SYMBOL_REF_ZOOM is SYMBOL_SCALE, and it doubles with every zoom step, like the map itself
          // (exponential base 2 between two stops 6 zooms apart gives exactly size * 2^(zoom - ref))
          'icon-size': ['interpolate', ['exponential', 2], ['zoom'],
            SYMBOL_REF_ZOOM - 3, ['*', ['get', 's'], SYMBOL_SCALE[kind] / 8],
            SYMBOL_REF_ZOOM + 3, ['*', ['get', 's'], SYMBOL_SCALE[kind] * 8]],
          'icon-anchor': 'bottom', 'icon-allow-overlap': true, 'icon-ignore-placement': true,
          'symbol-sort-key': ['get', 'sk'],
        },
        paint: { 'icon-opacity': ['interpolate', ['linear'], ['zoom'], 12.5, kind === 'forest' || kind === 'jungle' ? 0.92 : kind === 'ruins' ? 0.55 : 1, 14, 0] }, // gone before street plans fade in
      })),
    ),

    // names along rivers
    { id: 'river-names', type: 'symbol', source: 'rivers', minzoom: 6.2, layout: { 'symbol-placement': 'line', 'text-field': ['get', 'name'], 'text-font': ['IM Fell English Italic'], 'text-size': ['interpolate', ['linear'], ['zoom'], 6, 11, 10, 17], 'text-letter-spacing': 0.15, 'symbol-spacing': 400 }, paint: { 'text-color': '#254e57', 'text-halo-color': PALETTE.halo, 'text-halo-width': 1.4 } },

    // regions / terrain-feature labels
    // three levels: 1 = major realms / seas / poles, 2 = regions, 3 = sub-regions (tools/source/region_levels.json)
    ...[[1, 3], [2, 4.8], [3, 6.0]].map(([rank, minzoom]) => ({
      id: `regions-${rank}`, type: 'symbol', source: 'regions', minzoom, filter: ['==', ['get', 'rank'], rank],
      layout: {
        'text-field': ['get', 'name'],
        'text-font': [rank === 1 ? 'Cinzel SemiBold' : 'Cinzel Regular'],
        'text-transform': 'uppercase', 'text-letter-spacing': [0.34, 0.2, 0.1][rank - 1], 'text-max-width': 8,
        'text-size': ['interpolate', ['linear'], ['zoom'], 3.4, [8, 6, 5][rank - 1], 4, [14, 10, 8][rank - 1], 8, [27, 17, 12][rank - 1], 11, [36, 24, 17][rank - 1]],
      },
      paint: {
        'text-color': ['match', ['get', 'kind'], ['lake', 'island'], '#254e57', 'forest', '#3b5223', 'mountain', '#5b4a30', rank === 1 ? '#8a2a1a' : '#4a3220'],
        'text-halo-color': PALETTE.halo, 'text-halo-width': 1.4, 'text-opacity': [0.9, 0.9, 0.8][rank - 1],
      },
    })),

    // settlements
    { id: 'poi-icons', type: 'symbol', source: 'places', minzoom: 5.4, layout: {
        'icon-image': ['concat', 'poi-', ['coalesce', ['get', 'icon'], ['get', 'kind']]], 'icon-size': ['interpolate', ['linear'], ['zoom'], 5, ['*', 0.7, SETTLEMENT_SCALE], 8, SETTLEMENT_SCALE, 11, ['*', 1.375, SETTLEMENT_SCALE]],
        'icon-allow-overlap': true },
      paint: { 'icon-opacity': ['interpolate', ['linear'], ['zoom'], 14.5, ['case', ['==', ['get', 'guess'], true], 0.6, 1], 16, ['case', ['has', 'tier'], 0, ['==', ['get', 'guess'], true], 0.6, 1]] } }, // settlements hand over to their street plan
    ...[[1, 5.0], [2, 6.0], [3, 7.0]].map(([rank, minzoom]) => ({
      id: `places-${rank}`, type: 'symbol', source: 'places', minzoom, filter: ['==', ['get', 'rank'], rank],
      layout: {
        'text-field': ['get', 'name'], 'text-font': ['IM Fell English Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 5, PLACE_TEXT[rank][0], 8, PLACE_TEXT[rank][1], 11, PLACE_TEXT[rank][2]],
        'text-anchor': 'top', 'text-offset': [0, 0.7], 'text-max-width': 7,
      },
      paint: { 'text-color': PALETTE.ink, 'text-halo-color': PALETTE.halo, 'text-halo-width': 1.5 },
    })),
  ],
};

// ---- optional generated symbols: atlas/symbols/manifest.json lists transparent PNGs per category ----
const SYMBOLS = { images: {}, categories: {}, bitmaps: {} };
async function loadSymbols() {
  try {
    const res = await fetch('symbols/manifest.json', { cache: 'no-store' });
    if (!res.ok) return;
    const manifest = await res.json();
    SYMBOLS.images = manifest.images || {};
    SYMBOLS.credit = manifest.credit;
    SYMBOLS.categories = manifest.categories || {};
    await Promise.all(Object.entries(SYMBOLS.images).map(async ([name, info]) => {
      const blob = await (await fetch(`symbols/${info.file}`)).blob();
      SYMBOLS.bitmaps[name] = await createImageBitmap(blob);
    }));
  } catch (e) { /* no generated symbols: the code-drawn set is used */ }
}
function symbolFor(id) {
  let name = id;
  if (!SYMBOLS.bitmaps[name]) {
    const dash = id.indexOf('-');
    const list = SYMBOLS.categories[id.slice(0, dash)];
    const n = Number(id.slice(dash + 1));
    name = list && list.length && Number.isInteger(n) ? list[n % list.length] : null;
  }
  return name && SYMBOLS.bitmaps[name] ? { bitmap: SYMBOLS.bitmaps[name], pixelRatio: SYMBOLS.images[name].pr || 2 } : null;
}

// the data files hold the chart's own coordinates; the map is given them placed on the world (proj.js)
const loadGeo = Promise.all(Object.values(style.sources).filter((s) => typeof s.data === 'string').map(async (s) => { s.data = AP.geoToWorld(await (await fetch(s.data)).json()); }));
Promise.all([loadSymbols(), loadGeo]).then(() => {
if (SYMBOLS.credit) {
  const el = document.getElementById('credit');
  el.innerHTML = `<a href="${SYMBOLS.credit.url}" target="_blank" rel="noopener">${SYMBOLS.credit.text}</a>`;
  el.hidden = false;
}
// Later symbol layers win label collisions: region names go last so they are never crowded out by town names.
style.layers = [...style.layers.filter((l) => !l.id.startsWith('regions-')), ...style.layers.filter((l) => l.id.startsWith('regions-'))];
style.layers = style.layers.map(AP.shiftLayer); // the layers' zoom numbers are chart zoom; MapLibre's zoom is Z_OFF lower (proj.js)

// west edge: the far western isles; east edge: past Phocacia; south: below Curmeah; north: halfway into the arctic pole
const WORLD_BOUNDS = [[-24, -16.2], [11, 12.2]]; // chart coordinates
const WORLD_BOUNDS_W = WORLD_BOUNDS.map(AP.aToW);
// The map is one view that changes shape with zoom: flat Mercator when zoomed in, a globe when zoomed far out, and a smooth curl
// between the two (MapLibre blends the projections by zoom). `flatZoom` is the most zoomed-out the flat map goes (a little tighter than the whole
// drawn world fitting the window); the curl runs from there down to the globe.
const CURL = 0.6; // zoom steps from flat to fully round
const FLAT_SLACK = 0.5; // the flat map stops this far in from "the whole drawn world fits", so that the globe it curls into is a good size
const mercYw = (lat) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
const flatZoomFor = (c) => {
  const w1 = ((WORLD_BOUNDS_W[1][0] - WORLD_BOUNDS_W[0][0]) / 360) * 512;
  const h1 = ((mercYw(WORLD_BOUNDS_W[1][1]) - mercYw(WORLD_BOUNDS_W[0][1])) / (2 * Math.PI)) * 512;
  return Math.log2(Math.max(c.clientWidth / w1, c.clientHeight / h1)) + FLAT_SLACK;
};
let flatZoom = flatZoomFor(document.getElementById('map'));
const projectionFor = (zFlat) => ({ type: ['interpolate', ['linear'], ['zoom'], zFlat - CURL, 'vertical-perspective', zFlat, 'mercator'] });
style.projection = projectionFor(flatZoom);
style.sky = { 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, flatZoom - CURL, 0.9, flatZoom, 0], 'sky-color': '#7fa6b8', 'horizon-color': '#d8c58a', 'fog-color': '#c9b98a' }; // a faint glow round the globe
const map = new maplibregl.Map({
  container: 'map',
  style,
  ...AP.cam({ bounds: [[-10.5, -6.5], [7.1, 10.6]] }),
  fitBoundsOptions: { padding: 40 },
  minZoom: 0,
  maxZoom: 20 - AP.Z_OFF, // street plans (towns.js) are drawn at true scale and need the extra zoom
  renderWorldCopies: false,
  attributionControl: false,
  dragRotate: false,
});
// The top of the map is cut through the arctic pole (the pole is stretched across the whole top edge, so only the
// southern half of it is shown). The flat map never goes further out than the whole drawn world.
function fitFlatZoom() {
  const c = map.getContainer();
  if (!c.clientWidth || !c.clientHeight) return; // hidden behind the relief or climate view
  flatZoom = flatZoomFor(c);
  try { map.setProjection(projectionFor(flatZoom)); } catch { /* the style is still loading; it was created with this projection */ }
  map.setMinZoom(flatZoom - CURL - 0.3);
}
fitFlatZoom();
if (map.getZoom() < flatZoom) map.jumpTo({ zoom: flatZoom }); // never open already curling
map.on('resize', fitFlatZoom);
// maxBounds does not work with the curling projection, so the flat map is kept over the drawn world by hand: after a move, if the view
// has slid off the edge of the drawn world, it eases back. (The globe turns freely.)
function clampFlat() {
  if (map.getZoom() < flatZoom - 0.02) return;
  const cv = map.getCanvas(), worldPx = 512 * 2 ** map.getZoom(), c = map.getCenter();
  const halfH = (cv.clientHeight / 2 / worldPx) * 2 * Math.PI, halfW = (cv.clientWidth / 2 / worldPx) * 360;
  const fit = (v, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.min(hi, Math.max(lo, v)));
  const my = fit(mercYw(c.lat), mercYw(WORLD_BOUNDS_W[0][1]) + halfH, mercYw(WORLD_BOUNDS_W[1][1]) - halfH);
  const lng = fit(c.lng, WORLD_BOUNDS_W[0][0] + halfW, WORLD_BOUNDS_W[1][0] - halfW);
  const lat = (2 * Math.atan(Math.exp(my)) - Math.PI / 2) * (180 / Math.PI);
  if (Math.abs(lat - c.lat) > 1e-4 || Math.abs(lng - c.lng) > 1e-4) map.easeTo({ center: [lng, lat], duration: 280 });
}
map.on('moveend', clampFlat);
// MapLibre's minimum zoom is not held while the projection is curling or round, so hold it here: the globe never shrinks past a good size
let holding = false;
map.on('zoom', () => {
  const lowest = flatZoom - CURL - 0.3;
  if (holding || map.getZoom() >= lowest - 1e-3) return;
  holding = true; map.setZoom(lowest); holding = false;
});
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
// Scale bar in miles. The map is flat, so one world pixel (1/51.2 degree of longitude) is the same distance everywhere;
// data/scale.json holds the calibration (tools/calibrate.mjs).
(async () => {
  let milesPerWorldPx = null;
  try { milesPerWorldPx = (await (await fetch('data/scale.json', { cache: 'no-store' })).json()).milesPerWorldPx; } catch { return; }
  if (!milesPerWorldPx) return;
  const el = document.getElementById('scalebar');
  const nice = [0.0095, 0.019, 0.047, 0.095, 0.19, 0.47, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000]; // the small ones are 50, 100, 250, 500, 1000, 2500 feet
  const update = () => {
    const h = map.getContainer().clientHeight / 2;
    // chart pixels across 100 screen pixels (the flat map is the same scale everywhere); only meaningful once the map is flat
    const a = AP.wToPx(map.unproject([0, h]).toArray()), b = AP.wToPx(map.unproject([100, h]).toArray());
    if (!(map.getZoom() >= flatZoom - 0.02)) { el.hidden = true; return; }
    const milesPer100 = Math.abs(b[0] - a[0]) * milesPerWorldPx;
    const m = [...nice].reverse().find((n) => n <= milesPer100) || nice[0];
    el.querySelector('i').style.width = `${Math.max(8, (m / milesPer100) * 100)}px`;
    el.querySelector('span').textContent = m < 1 ? `${Math.round((m * 5280) / 50) * 50} ft` : `${m} mi`;
    el.hidden = false;
  };
  map.on('move', update); update();
})();

function bitmapPixels(bm) {
  const c = document.createElement('canvas');
  c.width = bm.width; c.height = bm.height;
  const g = c.getContext('2d');
  g.drawImage(bm, 0, 0);
  return g.getImageData(0, 0, c.width, c.height);
}
map.on('styleimagemissing', (e) => {
  if (map.hasImage(e.id)) return;
  const sym = symbolFor(e.id);
  if (sym) { map.addImage(e.id, bitmapPixels(sym.bitmap), { pixelRatio: sym.pixelRatio }); return; } // raw pixels: MapLibre 5 darkens a transparent ImageBitmap
  const { data, pixelRatio } = drawIcon(e.id);
  map.addImage(e.id, data, { pixelRatio });
});

// Clicking an entry (on the map or the globe) shows its card in the side pane.
const paneBody = document.getElementById('pane-body');
const paneClose = document.getElementById('pane-close');
const EMPTY = paneBody.innerHTML;
let notesPromise;
const loadNotes = () => (notesPromise ??= fetch('data/notes.json').then((r) => (r.ok ? r.json() : {})).catch(() => ({})));
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const paragraphs = (t) => t.split(/\n{2,}/).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('');

let placing = null; // set by placement mode while an entry is waiting to be dropped on the map
const dataListeners = new Set(); // the globe re-reads its labels when pins change
let editing = false; // true when the local dev server's editing API is reachable

// ring on the map marking the entry shown in the pane (the globe draws its own)
const selMarker = new maplibregl.Marker({ element: Object.assign(document.createElement('div'), { className: 'sel-ring' }) });
const selectionListeners = new Set();
let selected = null;
function clearPane() {
  selected = null;
  selMarker.remove();
  paneBody.innerHTML = EMPTY;
  paneClose.hidden = true;
  for (const fn of selectionListeners) fn(null);
}
paneClose.addEventListener('click', clearPane);

async function showCard(feature) {
  if (placing) return;
  if (window.atlas.cardHook && window.atlas.cardHook(feature)) return; // the journey planner takes clicks on places while it is open
  const p = feature.properties;
  const notes = p.dbId ? (await loadNotes())[p.dbId] : null;
  let html = `<strong class="card-title">${esc(p.name)}</strong>`;
  if (p.tier) html += `<div class="meta size">${p.kind === 'port' ? 'Port · medium' : SETTLEMENT_NAME[p.tier]}</div>`;
  if (notes) {
    const trail = notes.path && notes.path.length ? notes.path.join(' › ') : '';
    if (p.aka) html += `<div class="meta">Recorded in the old notes as “${esc(p.aka)}”</div>`;
    html += `<div class="meta">${esc(notes.type)}${trail ? ' · ' + esc(trail) : ''}</div>`;
    if (notes.summary) html += `<p class="summary">${esc(notes.summary)}</p>`;
    if (notes.text) html += `<details open><summary>Read more</summary>${paragraphs(notes.text)}</details>`;
    if (notes.within && notes.within.length) html += `<div class="meta people">Includes: ${notes.within.map((x) => esc(x.name)).join(', ')}</div>`;
    if (notes.people && notes.people.length) html += `<div class="meta people">Connected: ${notes.people.map((x) => esc(x.name)).join(', ')}</div>`;
  } else if (p.dbId) {
    html += `<div class="meta">${esc(p.kind || '')}</div><p class="meta"><em>Notes for this place are still under review.</em></p>`;
  } else if (p.note) {
    html += `<p class="summary">${esc(p.note)}</p>`;
  } else {
    html += `<div class="meta">${esc(p.kind || '')} · from the ${esc(String(p.source).replace('-', ' '))} map</div><p class="meta"><em>No notes linked yet.</em></p>`;
  }
  if (p.magicKind) {
    // tracked in tools/source/climate_magic.json: climate shaped by magic, not latitude or currents
    html = html.replace('</strong>', `</strong><div class="magic magic-${esc(p.magicKind)}"><b>${esc(p.magicIcon || '')} ${esc(p.magicLabel)}</b>${p.magicFrom ? ` <span class="meta">(applies across ${esc(p.magicFrom)})</span>` : ''}<div>${esc(p.magicNote)}</div></div>`);
  }
  if (p.magicMore) { // further climate tags on the same place: shown under the first
    const more = (typeof p.magicMore === 'string' ? JSON.parse(p.magicMore) : p.magicMore).map((x) => `<div class="magic magic-${esc(x.kind)}"><b>${esc(x.icon || '')} ${esc(x.label)}</b><div>${esc(x.note)}</div></div>`).join('');
    html = html.replace(/(<div class="magic magic-[^>]*>[\s\S]*?<\/div><\/div>)/, `$1${more}`);
  }

  if (p.guess) html += `<p class="guess">Position is a first-pass guess${p.basis ? `: ${esc(p.basis)}` : ''}.</p>`;
  if (p.editNote) html += `<div class="editnote"><b>Note</b><p>${esc(p.editNote)}</p></div>`;
  const group = p.editKey ? p.editKey.split(':')[1] : null;
  if (editing && p.dbId) html += articleEditorHtml(p, notes);
  if (editing && group) html += editorHtml(p, group);
  paneBody.innerHTML = html;
  document.body.classList.remove('pane-closed'); // a click on an entry opens the pane if it was slid shut
  paneBody.scrollTop = 0;
  paneClose.hidden = false;
  selected = feature;
  selMarker.setLngLat(AP.aToW(feature.geometry.coordinates)).addTo(map);
  for (const fn of selectionListeners) fn(feature);
  if (editing && p.dbId) bindArticleEditor(feature, notes);
  if (editing && group) bindEditor(feature, group);
}

// ---- article editor (local dev server only): the summary and long text shown on a card ----
// Saved by old-notes id in tools/source/article_edits.json; the old-notes text is never overwritten, so "Restore original" is exact.
let articleOpen = false;
function articleEditorHtml(p, notes) {
  const n = notes || { summary: '', text: '' };
  return `<details class="editor article-editor"${articleOpen ? ' open' : ''}><summary>Edit article${notes && notes.edited ? ' (edited)' : ''}</summary>`
    + `<div class="ed-col"><label>Summary</label><textarea class="ar-summary" rows="3" placeholder="A line or two, shown in italics under the title">${esc(n.summary || '')}</textarea></div>`
    + `<div class="ed-col"><label>Article</label><textarea class="ar-text" rows="16" placeholder="Write the full entry here. A blank line starts a new paragraph.">${esc(n.text || '')}</textarea></div>`
    + `<div class="ed-actions"><button type="button" class="ar-save">Save article</button>${notes && notes.edited ? '<button type="button" class="ar-reset">Restore original</button>' : ''}</div>`
    + '<div class="ed-status ar-status" aria-live="polite"></div></details>';
}
function bindArticleEditor(feature, notes) {
  const p = feature.properties, root = paneBody.querySelector('.article-editor');
  if (!root) return;
  const $ = (sel) => root.querySelector(sel);
  const status = (t) => { $('.ar-status').textContent = t; };
  root.addEventListener('toggle', () => { articleOpen = root.open; });
  const save = async (body, msg) => {
    status('Saving…');
    root.querySelectorAll('button, textarea').forEach((e) => (e.disabled = true));
    try {
      const res = await api('/api/edit-article', { id: Number(p.dbId), ...body });
      if (res.error) throw new Error(res.error);
      const data = await refreshData();
      const fresh = ['places', 'regions'].flatMap((g) => data[g].features).find((f) => f.properties.editKey === p.editKey) || feature;
      await showCard(fresh);
      const st = paneBody.querySelector('.ar-status');
      if (st) st.textContent = res.ok ? msg : 'Saved, but the rebuild reported a problem.';
    } catch (err) {
      root.querySelectorAll('button, textarea').forEach((e) => (e.disabled = false));
      status(`Could not save: ${err.message}`);
    }
  };
  $('.ar-save').addEventListener('click', () => save({ summary: $('.ar-summary').value, text: $('.ar-text').value }, 'Article saved.'));
  const reset = $('.ar-reset');
  if (reset) reset.addEventListener('click', () => save({ reset: true }, 'Original text restored.'));
}

// ---- side-pane editor (local dev server only): rename, resize, retype, note, move, remove ----
const PLACE_KINDS = ['village', 'town', 'city', 'port', 'fort', 'tower', 'temple', 'mine', 'ruin'];
const REGION_KIND_LIST = ['region', 'forest', 'mountain', 'lake', 'island', 'marsh'];
const SETTLEMENTS = new Set(['village', 'town', 'city', 'port']);
let editorOpen = false;
const editApi = (key, body) => api('/api/edit-place', { key, ...body });
function editorHtml(p, group) {
  const kinds = group === 'region' ? REGION_KIND_LIST : PLACE_KINDS;
  const kindList = kinds.includes(p.kind) ? kinds : [p.kind, ...kinds];
  const seg = (attr, labels, cur) => `<span class="seg">${labels.map(([v, l]) => `<button type="button" ${attr}="${v}" class="${cur === v ? 'on' : ''}">${l}</button>`).join('')}</span>`;
  let h = `<details class="editor"${editorOpen ? ' open' : ''}><summary>Edit this ${group === 'region' ? 'label' : 'place'}</summary>`;
  h += `<div class="ed-row"><label>Name</label><input class="ed-name" value="${esc(p.name)}" maxlength="120"><button type="button" class="ed-name-save">Save</button></div>`;
  h += `<div class="ed-row"><label>Type</label><select class="ed-kind">${kindList.map((k) => `<option${k === p.kind ? ' selected' : ''}>${esc(k)}</option>`).join('')}</select></div>`;
  if (group === 'place' && SETTLEMENTS.has(p.kind)) h += `<div class="ed-row"><label>Size</label>${seg('data-tier', [[1, 'Village'], [2, 'Town'], [3, 'City']], p.tier)}</div>`;
  if (group === 'region') h += `<div class="ed-row"><label>Level</label>${seg('data-rank', [[1, 'Major'], [2, 'Region'], [3, 'Sub-region']], p.rank)}</div>`;
  h += `<div class="ed-col"><label>Note</label><textarea class="ed-note" rows="3" placeholder="Your own note, shown under the name">${esc(p.editNote || '')}</textarea><button type="button" class="ed-note-save">Save note</button></div>`;
  h += `<div class="ed-actions">${p.placed && p.dbId && p.guess ? '<button type="button" class="ed-confirm">Confirm position</button>' : ''}<button type="button" class="ed-move">Move</button><button type="button" class="ed-remove">Remove</button>${p.edited ? '<button type="button" class="ed-reset">Undo my edits</button>' : ''}</div>`;
  return h + '<div class="ed-status" aria-live="polite"></div></details>';
}
function bindEditor(feature, group) {
  const p = feature.properties, root = paneBody.querySelector('.editor:not(.article-editor)');
  if (!root) return;
  const $ = (sel) => root.querySelector(sel);
  const status = (t) => { $('.ed-status').textContent = t; };
  root.addEventListener('toggle', () => { editorOpen = root.open; });
  // save, rebuild, then show the entry again from the fresh data
  const save = async (body, msg) => {
    status('Saving…');
    root.querySelectorAll('button, input, select, textarea').forEach((e) => (e.disabled = true));
    const res = await editApi(p.editKey, body);
    const data = await refreshData();
    const fresh = data[group === 'region' ? 'regions' : 'places'].features.find((f) => f.properties.editKey === p.editKey);
    if (fresh) { await showCard(fresh); paneBody.querySelector('.editor:not(.article-editor) .ed-status').textContent = res.ok ? msg : 'Saved, but the rebuild reported a problem.'; }
    else { clearPane(); }
    await refreshUnplaced(); await refreshRemoved();
  };
  $('.ed-name-save').addEventListener('click', () => { const v = $('.ed-name').value.trim(); if (v && v !== p.name) save({ set: { name: v } }, 'Name saved.'); });
  $('.ed-name').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('.ed-name-save').click(); });
  $('.ed-note-save').addEventListener('click', () => save({ set: { note: $('.ed-note').value } }, 'Note saved.'));
  $('.ed-kind').addEventListener('change', (e) => save({ set: { kind: e.target.value }, unset: ['tier'] }, 'Type changed.'));
  root.querySelectorAll('[data-tier]').forEach((b) => b.addEventListener('click', () => {
    const t = Number(b.dataset.tier), k = ['', 'village', 'town', 'city'][t];
    save({ set: { tier: t, ...(p.kind !== 'port' ? { kind: k } : {}) } }, 'Size changed.');
  }));
  root.querySelectorAll('[data-rank]').forEach((b) => b.addEventListener('click', () => save({ set: { rank: Number(b.dataset.rank) } }, 'Level changed.')));
  const confirmBtn = $('.ed-confirm');
  if (confirmBtn) confirmBtn.addEventListener('click', async () => {
    const [lng, lat] = feature.geometry.coordinates;
    status('Saving…'); await api('/api/place', { dbId: Number(p.dbId), lng, lat, kind: p.kind, name: p.name });
    clearPane(); await refreshData();
  });
  $('.ed-move').addEventListener('click', () => {
    clearPane();
    // pins placed from the old notes keep using the placement store, so a manual move also settles their guess
    startPlacing(p.placed && p.dbId ? { id: Number(p.dbId), name: p.name, kind: p.kind } : { key: p.editKey, name: p.name });
  });
  // Two clicks, no browser dialog (window.confirm is blocked in some embedded browsers, which made Remove do nothing).
  const removeBtn = $('.ed-remove');
  let armed = null;
  removeBtn.addEventListener('click', async () => {
    if (!armed) {
      removeBtn.textContent = 'Click again to remove';
      removeBtn.classList.add('armed');
      status(`This takes “${p.name}” off the map; you can bring it back from the Place entries panel.`);
      armed = setTimeout(() => { armed = null; removeBtn.textContent = 'Remove'; removeBtn.classList.remove('armed'); status(''); }, 5000);
      return;
    }
    clearTimeout(armed);
    status('Removing…');
    root.querySelectorAll('button, input, select, textarea').forEach((e) => (e.disabled = true));
    try {
      const res = await editApi(p.editKey, { set: { hidden: true } });
      if (res.error) throw new Error(res.error);
      clearPane(); await refreshData(); await refreshUnplaced(); await refreshRemoved();
    } catch (err) {
      root.querySelectorAll('button, input, select, textarea').forEach((e) => (e.disabled = false));
      status(`Could not remove it: ${err.message}`);
    }
  });
  const reset = $('.ed-reset');
  if (reset) reset.addEventListener('click', () => save({ reset: true }, 'Edits undone.'));
}

// shared with the globe module (loaded on demand)
window.atlas = { cardHook: null, hiddenKinds: new Set(), isGridOn: () => gridOn, dataListeners, map, showCard, clearPane, selectionListeners, getSelected: () => selected, esc, PALETTE, TERRAIN_FILL, SYMBOL_SCALE, symbolFor, drawIcon };

// Map | Globe | Relief | Climate. Map and Globe are the same MapLibre view: zooming out curls the flat map into a globe and zooming in
// flattens it again (see `projectionFor` above), so the two buttons simply zoom to where each looks right. Relief and Climate are
// three.js views built the first time they are asked for.
(() => {
  const modeButtons = () => [...document.querySelectorAll('.modes button')];
  const loading = document.getElementById('globe-loading');
  const LOADING = { relief: 'Raising the land…', climate: 'Reading the weather…' };
  const loaded = {};
  let current = 'map'; // 'map' covers both the flat map and the globe
  const shape = () => (map.getZoom() < flatZoom - 0.05 ? 'globe' : 'map');
  function syncShape() {
    if (current !== 'map') return;
    const s = shape();
    document.body.classList.toggle('globe', s === 'globe');
    for (const b of modeButtons()) b.classList.toggle('on', b.dataset.mode === (map.getZoom() < flatZoom - CURL * 0.5 ? 'globe' : 'map'));
  }
  map.on('zoom', syncShape);
  map.on('resize', syncShape);
  syncShape();

  const setMode = async (mode) => {
    if (mode === 'map' || mode === 'globe') {
      if (current !== 'map') { // leaving relief / climate
        document.body.classList.remove('relief', 'climate');
        if (current in loaded) loaded[current].leave();
        current = 'map';
        map.resize();
      }
      // fly to a view that is flat, or round, keeping the middle of the view where it is
      const target = mode === 'globe' ? flatZoom - CURL - 0.05 : Math.max(map.getZoom(), flatZoom + 0.35);
      map.easeTo({ zoom: target, duration: Math.min(3200, 1100 + 260 * Math.abs(target - map.getZoom())), easing: (t) => (t < 0.5 ? 2 * t * t : 1 - ((-2 * t + 2) ** 2) / 2) });
      syncShape();
      return;
    }
    if (mode === current) return;
    for (const b of modeButtons()) b.classList.toggle('on', b.dataset.mode === mode);
    loading.textContent = LOADING[mode];
    loading.style.display = 'grid';
    try {
      loaded[mode] ??= await import(`./${mode}.js`);
      await loaded[mode].enter();
      if (current in loaded) loaded[current].leave();
      document.body.classList.remove('globe', 'relief', 'climate');
      document.body.classList.add(mode);
      current = mode;
      if (placing) placing = null;
    } catch (e) {
      console.error(`${mode} failed`, e);
      syncShape();
    }
    loading.style.display = 'none';
  };
  document.addEventListener('click', (e) => { const b = e.target.closest('.modes button'); if (b) setMode(b.dataset.mode); });
})();
;
let startPlacing = () => {};

// ---- helpers for the editing API (present only on the local dev server) ----
async function api(url, body) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return r.json();
}
async function refreshData() {
  notesPromise = undefined;
  const out = {};
  for (const name of ['places', 'regions']) {
    out[name] = await (await fetch(`data/${name}.geojson?${Date.now()}`)).json();
    map.getSource(name).setData(out[name]);
  }
  for (const fn of dataListeners) fn(out);
  return out;
}
let refreshUnplaced = async () => {};
let refreshRemoved = async () => {};
for (const layer of ['poi-icons', 'places-1', 'places-2', 'places-3', 'regions-1', 'regions-2', 'regions-3']) {
  map.on('click', layer, (e) => { if (window.atlas.painting) return; showCard(AP.featureBack(e.features[0])); });
  map.on('mouseenter', layer, () => (map.getCanvas().style.cursor = 'pointer'));
  map.on('mouseleave', layer, () => (map.getCanvas().style.cursor = ''));
}

// Layer toggles
const groups = {
  'Terrain symbols': (id) => id.startsWith('sym-'),
  'Rivers': (id) => id === 'rivers' || id === 'river-names',
  'Ocean currents': (id) => id.startsWith('currents'),
  'Lost lands': (id) => id.startsWith('lost-'),
  'Roads': (id) => id.startsWith('roads'),
  'Settlements': (id) => id.startsWith('places-') || id === 'poi-icons',
  'Region names': (id) => id.startsWith('regions-'),
  'Latitude & longitude grid': (id) => id.startsWith('grid-'),
};
const panel = document.getElementById('layers');
// the panel's title folds the rest of it away, like "Show by kind"; the choice is remembered
{
  const title = panel.querySelector('strong');
  const set = (shut) => {
    panel.classList.toggle('collapsed', shut);
    title.setAttribute('aria-expanded', String(!shut));
    try { localStorage.setItem('atlas-layers-collapsed', shut ? '1' : '0'); } catch { /* ignore */ }
  };
  title.setAttribute('role', 'button');
  title.tabIndex = 0;
  title.addEventListener('click', () => set(!panel.classList.contains('collapsed')));
  title.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); title.click(); } });
  let shut = false;
  try { shut = localStorage.getItem('atlas-layers-collapsed') === '1'; } catch { /* ignore */ }
  set(shut);
}
for (const [label, test] of Object.entries(groups)) {
  const isGrid = label.startsWith('Latitude');
  const row = document.createElement('label');
  if (isGrid) row.className = 'grid-row';
  row.innerHTML = `<input type="checkbox" ${isGrid && !gridOn ? '' : 'checked'}> ${label.replace('&', '&amp;')}`;
  row.querySelector('input').addEventListener('change', (ev) => {
    for (const l of map.getStyle().layers) if (test(l.id)) map.setLayoutProperty(l.id, 'visibility', ev.target.checked ? 'visible' : 'none');
    if (isGrid) {
      gridOn = ev.target.checked;
      try { localStorage.setItem('atlas-grid', gridOn ? '1' : '0'); } catch { /* ignore */ }
      window.dispatchEvent(new Event('atlas-grid')); // the globe listens
    }
  });
  panel.appendChild(row);
}

// Readout in source-image pixel coordinates (1024px wide world map), handy while aligning other maps.
const readout = document.getElementById('coords');
map.on('mousemove', (e) => {
  const [x, y] = AP.wToPx(e.lngLat.toArray());
  readout.hidden = false;
  readout.textContent = `x ${x.toFixed(0)}  y ${y.toFixed(0)}`;
});
// Grid degrees appear only for the line under the pointer.
const gridTip = document.createElement('div');
gridTip.className = 'grid-tip'; gridTip.hidden = true;
document.getElementById('stage').appendChild(gridTip);
map.on('mousemove', (e) => {
  if (!map.style || !map.style._loaded || !map.getLayer('grid-hover')) return; // the style may still be loading on the first moves
  let hit = null;
  if (gridOn && !document.body.classList.contains('globe')) {
    const r = 5, box = [[e.point.x - r, e.point.y - r], [e.point.x + r, e.point.y + r]];
    hit = map.queryRenderedFeatures(box, { layers: ['grid-lines', 'grid-equator'] })[0] || null;
  }
  map.setFilter('grid-hover', ['==', ['get', 'label'], hit ? hit.properties.label : '']);
  gridTip.hidden = !hit;
  if (hit) { gridTip.textContent = hit.properties.label; gridTip.style.transform = `translate(${e.point.x + 14}px, ${e.point.y + 14}px)`; }
});
map.on('mouseout', () => { gridTip.hidden = true; });
window.__map = map;

// ---- placement mode: drop written-up places that aren't on the map yet ----
(async () => {
  let unplaced = [];
  try { const r = await fetch('/api/unplaced'); if (!r.ok) return; unplaced = await r.json(); } catch { return; }
  editing = true;
  const KINDS = ['town', 'city', 'village', 'port', 'fort', 'tower', 'temple', 'mine', 'ruin', 'region', 'forest', 'mountain', 'lake', 'island'];

  const panel = document.createElement('div');
  panel.className = 'placer docked'; panel.hidden = true;
  // like Paint terrain, the panel takes the details pane's place while open (index.html), so the map stays clear
  new MutationObserver(() => document.body.classList.toggle('placing-tool', !panel.hidden)).observe(panel, { attributes: true, attributeFilter: ['hidden'] });
  panel.innerHTML = `<div class="placer-head"><strong>Place entries</strong><button class="placer-close" title="Close">×</button></div>
    <div class="placer-hint">Pick an entry, then click the map where it belongs.</div>
    <div class="placer-row"><label>Symbol <select class="placer-kind">${KINDS.map((k) => `<option>${k}</option>`).join('')}</select></label></div>
    <input class="placer-search" type="search" placeholder="Search ${unplaced.length} entries">
    <details class="placer-removed"><summary>Removed from the map (<span class="n">0</span>)</summary><div class="removed-list"></div></details>
    <div class="placer-list"></div>`;
  document.body.appendChild(panel);
  const toggle = document.createElement('button');
  toggle.className = 'placer-toggle'; toggle.dataset.menu = 'place';
  const listEl = panel.querySelector('.placer-list'), searchEl = panel.querySelector('.placer-search'), kindEl = panel.querySelector('.placer-kind'), hintEl = panel.querySelector('.placer-hint');

  function render() {
    const q = searchEl.value.trim().toLowerCase();
    const rows = unplaced.filter((u) => !q || `${u.name} ${u.realm} ${u.sub}`.toLowerCase().includes(q)).slice(0, 300);
    let realm = null, html = '';
    for (const u of rows) {
      if (u.realm !== realm) { realm = u.realm; html += `<div class="placer-realm">${esc(realm)}</div>`; }
      html += `<div class="placer-item${placing && placing.id === u.id ? ' active' : ''}" data-id="${u.id}"><b>${esc(u.name)}</b>${u.sub ? `<span> ${esc(u.sub)}</span>` : ''}${u.blurb ? `<i>${esc(u.blurb)}</i>` : ''}</div>`;
    }
    listEl.innerHTML = html || '<div class="placer-hint">Nothing matches.</div>';
    searchEl.placeholder = `Search ${unplaced.length} entries`;
    toggle.textContent = `Place entries (${unplaced.length})`;
  }
  const removedListEl = panel.querySelector('.removed-list'), removedBox = panel.querySelector('.placer-removed');
  refreshRemoved = async () => {
    let edits = {};
    try { edits = (await (await fetch('/api/place-edits')).json()).edits || {}; } catch { /* ignore */ }
    const gone = Object.entries(edits).filter(([, e]) => e.hidden);
    removedBox.hidden = !gone.length;
    removedBox.querySelector('.n').textContent = gone.length;
    removedListEl.innerHTML = gone.map(([k]) => `<div class="removed-item"><span>${esc(k.split(':').slice(2).join(':'))}</span><button type="button" data-key="${esc(k)}">Restore</button></div>`).join('');
  };
  removedListEl.addEventListener('click', async (e) => {
    const b = e.target.closest('button[data-key]'); if (!b) return;
    b.disabled = true;
    await editApi(b.dataset.key, { unset: ['hidden'] });
    await refreshData(); await refreshUnplaced(); await refreshRemoved();
  });
  refreshUnplaced = async () => { unplaced = await (await fetch('/api/unplaced')).json(); render(); };
  startPlacing = (entry) => {
    placing = entry;
    panel.hidden = false;
    clearPane(); map.getCanvas().style.cursor = 'crosshair';
    hintEl.textContent = `Click the map to ${placing.key ? 'move' : 'place'} “${placing.name}”. Esc cancels.`;
    render();
  };
  listEl.addEventListener('click', (e) => {
    const item = e.target.closest('.placer-item'); if (!item) return;
    startPlacing(unplaced.find((u) => u.id === Number(item.dataset.id)));
  });
  const stop = () => { placing = null; map.getCanvas().style.cursor = ''; hintEl.textContent = 'Pick an entry, then click the map where it belongs.'; render(); };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && placing) stop(); });
  searchEl.addEventListener('input', render);
  map.on('click', async (e) => {
    if (!placing) return;
    const entry = placing; stop();
    hintEl.textContent = `Saving “${entry.name}”…`;
    const [lng, lat] = AP.wToA(e.lngLat.toArray()); // the data keeps chart coordinates
    const res = entry.key
      ? await editApi(entry.key, { set: { lng, lat } }) // a map-drawn pin or label: stored as a hand edit
      : await api('/api/place', { dbId: entry.id, lng, lat, kind: entry.kind || kindEl.value, name: entry.name });
    await refreshData(); await refreshUnplaced();
    await refreshRemoved();
    hintEl.textContent = res.ok ? (entry.key || entry.kind ? `Moved “${entry.name}”.` : `Placed “${entry.name}”. Pick the next one.`) : 'Saved, but the rebuild reported a problem.';
  });

  refreshRemoved();
  toggle.addEventListener('click', () => { panel.hidden = !panel.hidden; if (!panel.hidden) { render(); refreshRemoved(); } });
  panel.querySelector('.placer-close').addEventListener('click', () => { panel.hidden = true; if (placing) stop(); });
  document.getElementById('layers').appendChild(toggle);
  render();
})();
});
