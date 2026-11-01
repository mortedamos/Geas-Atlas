// Interior detail for the rebuilt regions: terrain polygons (forest / mountain / hills / desert), scattered
// symbols, rivers, lakes, settlements and labels. Everything ends up as GeoJSON in lon/lat in ../atlas/data.
// usage: node interior.mjs <atlasDataDir>
import fs from 'node:fs';
import path from 'node:path';
import { contours } from 'd3-contour';
import * as turf from '@turf/turf';
import { boxBlur, loadJpeg } from './lib.mjs';
import { regionalLandMask } from './regional_mask.mjs';
import { classifySellador } from './sellador_biomes.mjs';
import { loadIslands } from './lib_islands.mjs';

const dataDir = path.resolve(process.argv[2]);
const MAPS = path.resolve('..', 'original_data/web/img/gallery/maps');
const SRC = path.resolve('source');
const SPAN = 20, WORLD = 1024;
const DEG_PER_WORLD_PX = SPAN / WORLD;
const world = loadJpeg(path.join(MAPS, 'geas_worldmap_big.jpg'));

const tt = JSON.parse(fs.readFileSync(path.join(SRC, 'tel-tenauril.json'), 'utf8'));
const sel = JSON.parse(fs.readFileSync(path.join(SRC, 'sellador.json'), 'utf8'));
const arg = JSON.parse(fs.readFileSync(path.join(SRC, 'argusund.json'), 'utf8'));
const adj = JSON.parse(fs.readFileSync(path.join(SRC, 'adjustments.json'), 'utf8'));
const { islands: islandDefs } = loadIslands();
const cur = JSON.parse(fs.readFileSync(path.join(SRC, 'curmeah.json'), 'utf8'));
const loc = JSON.parse(fs.readFileSync(path.join(SRC, 'lochlainn.json'), 'utf8'));
const fnData = JSON.parse(fs.readFileSync(path.join(SRC, 'free-nations.json'), 'utf8'));
const fn = { ...fnData, ...fnData.transform }; // scale, rot, ox, oy at the top level like the other maps
const keData = JSON.parse(fs.readFileSync(path.join(SRC, 'kharse_ertrugol.json'), 'utf8')); // the drawing of eastern Kharse / Ertrugol / western Boddendell
const ke = { ...keData, ...keData.transform };
const bhData = JSON.parse(fs.readFileSync(path.join(SRC, 'berhagen.json'), 'utf8')); // the Wonderdraft map of the Berhagen coast
const bh = { ...bhData, ...bhData.transform };

// source px -> lon/lat (maps may be rotated: world = origin + scale * R(rot) * px)
const lonlat = (m) => ([x, y]) => {
  const c = Math.cos(m.rot || 0), s = Math.sin(m.rot || 0);
  const u = m.ox + m.scale * (c * x - s * y), v = m.oy + m.scale * (s * x + c * y);
  return [(u - WORLD / 2) * DEG_PER_WORLD_PX, -(v - WORLD / 2) * DEG_PER_WORLD_PX];
};
// the part of the Free Nations photo that is real map; it replaces whatever the rendered Sellador map shows there
const paperLL = turf.polygon([[...fn.paper, fn.paper[0]].map(lonlat(fn))]);
const paperKE = turf.polygon([[...ke.paper, ke.paper[0]].map(lonlat(ke))]); // likewise for the Ertrugol drawing
const paperBH = turf.polygon([[...bh.paper, bh.paper[0]].map(lonlat(bh))]); // and the Berhagen map
const inBH = (f) => turf.booleanPointInPolygon(f.geometry.coordinates, paperBH);

function rng(seed) { let a = seed >>> 0; return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const ringArea = (r) => { let a = 0; for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return Math.abs(a) / 2; };

function maskToPolys(mask, w, h, { blur = 3, minArea = 400, minHole = 300, tol = 1.2 } = {}) {
  const f = boxBlur({ w, h, v: Float32Array.from(mask) }, blur);
  const PAD = 2, pw = w + PAD * 2, ph = h + PAD * 2, padded = new Float32Array(pw * ph);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) padded[(y + PAD) * pw + x + PAD] = f.v[y * w + x];
  const multi = contours().size([pw, ph]).thresholds([0.5])(padded)[0];
  const out = [];
  for (const poly of multi.coordinates) {
    if (ringArea(poly[0]) < minArea) continue;
    const rings = poly.filter((r, i) => i === 0 || ringArea(r) >= minHole).map((r) => r.map(([x, y]) => [x - PAD, y - PAD]));
    let feat = turf.polygon(rings);
    feat = turf.simplify(feat, { tolerance: tol, highQuality: true });
    out.push(feat.geometry.coordinates);
  }
  return out;
}

const landFC = JSON.parse(fs.readFileSync(path.join(dataDir, 'land.geojson'), 'utf8'));
const landFeat = landFC.features[0];

function clipToLand(polyCoords) {
  try {
    const r = turf.intersect(turf.featureCollection([turf.polygon(polyCoords), landFeat]));
    return r ? (r.geometry.type === 'Polygon' ? [r.geometry.coordinates] : r.geometry.coordinates) : [];
  } catch (e) {
    return [polyCoords];
  }
}

// `mode`: 'outside' removes the Free Nations and Ertrugol footprints (for the Sellador render), 'inside' keeps only the Free Nations
// one, 'insideKE' only the Ertrugol one, 'outsideKE' removes just the Ertrugol one.
function limitToPaper(coords, mode) {
  if (!mode) return [coords];
  try {
    const poly = turf.polygon(coords);
    let r;
    if (mode === 'inside') r = turf.intersect(turf.featureCollection([poly, paperLL]));
    else if (mode === 'insideKE') r = turf.intersect(turf.featureCollection([poly, paperKE]));
    else if (mode === 'outsideKE') r = turf.difference(turf.featureCollection([poly, paperKE]));
    else if (mode === 'outsideFN') r = turf.difference(turf.featureCollection([poly, paperLL]));
    else if (mode === 'outsideBH') r = turf.difference(turf.featureCollection([poly, paperBH]));
    else if (mode === 'insideBH') r = turf.intersect(turf.featureCollection([poly, paperBH]));
    else if (mode === 'insideFNoutBH') { r = turf.intersect(turf.featureCollection([poly, paperLL])); if (r) r = turf.difference(turf.featureCollection([r, paperBH])); }
    else { r = turf.difference(turf.featureCollection([poly, paperLL])); if (r) r = turf.difference(turf.featureCollection([r, paperKE])); if (r) r = turf.difference(turf.featureCollection([r, paperBH])); }
    return r ? (r.geometry.type === 'Polygon' ? [r.geometry.coordinates] : r.geometry.coordinates) : [];
  } catch (e) { return [coords]; }
}
const terrain = []; // {kind, source, coords}
function addTerrain(kind, source, mapDef, polysSrcPx, clip = true, paperMode = null) {
  const proj = lonlat(mapDef);
  for (const poly of polysSrcPx) {
    const ll = poly.map((r) => r.map(proj));
    for (const c of clip ? clipToLand(ll) : [ll]) for (const d of limitToPaper(c, paperMode)) terrain.push({ kind, source, coords: d });
  }
}

// ---------------- Sellador: biomes from colour ----------------
{
  const { w, h, cls } = classifySellador();
  for (const [k, kind, minArea] of [[2, 'forest', 2500], [3, 'mountain', 1500], [4, 'desert', 3000]]) {
    const mask = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) mask[i] = cls[i] === k ? 1 : 0;
    const polys = maskToPolys(mask, w, h, { blur: 6, minArea, minHole: 600, tol: 2 });
    addTerrain(kind, 'sellador', sel, polys, true, 'outside');
    console.log('sellador', kind, polys.length);
  }
}

// ---------------- Tel-Tenauril: forests by flood fill inside drawn outlines ----------------
{
  const reg = { scale: tt.scale, ox: tt.ox, oy: tt.oy };
  const m = regionalLandMask(path.join(MAPS, tt.map), world, reg, { openSea: 3 });
  const { w, h, ink } = m;
  for (const s of tt.forestSeeds) {
    // nudge the seed to the nearest open pixel
    let sx = s.x, sy = s.y, found = !ink[sy * w + sx];
    for (let r = 1; r < 30 && !found; r++) for (let dy = -r; dy <= r && !found; dy++) for (let dx = -r; dx <= r && !found; dx++) {
      if (!ink[(s.y + dy) * w + s.x + dx]) { sx = s.x + dx; sy = s.y + dy; found = true; }
    }
    const mask = new Uint8Array(w * h);
    const stack = [sy * w + sx]; mask[sy * w + sx] = 1; let area = 0;
    while (stack.length) {
      const p = stack.pop(); area++;
      const x = p % w, y = (p - x) / w;
      for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) {
        if (q >= 0 && !mask[q] && !ink[q]) { mask[q] = 1; stack.push(q); }
      }
    }
    console.log('tt forest', s.name, 'area px', area, area > 220000 ? 'LEAKED?' : 'ok');
    if (area > 220000) continue;
    // fill the ink-wall margin back in so the polygon reaches the outline
    const grown = new Uint8Array(w * h);
    for (let y = 2; y < h - 2; y++) for (let x = 2; x < w - 2; x++) {
      if (mask[y * w + x]) { for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) grown[(y + dy) * w + x + dx] = 1; }
    }
    const polys = maskToPolys(grown, w, h, { blur: 4, minArea: 1500, minHole: 800, tol: 2 });
    addTerrain('forest', 'tel-tenauril', tt, polys);
  }
  tt.mountains.forEach((mt, i) => addTerrain(mt.kind, 'tel-tenauril', tt, [[roughen(mt.poly, 14, 700 + i, 30)]]));
}

// Tel-Tenauril's great southern forest (Watch Wardens + Forbidden Wood) with the young growth of the Phoenix Fields cut out of it
{
  const proj = lonlat(tt);
  const asLL = (w, i) => turf.polygon([roughen(w.poly, 12, 1500 + i, 30).map(proj)]);
  const woods = tt.woods || [];
  const byName = Object.fromEntries(woods.map((w, i) => [w.name, asLL(w, i)]));
  woods.forEach((w) => {
    if (w.kind === 'none') return; // clearings only exist to be cut out of other areas
    let feat = byName[w.name];
    for (const hole of [].concat(w.minus || [])) if (byName[hole]) { try { feat = turf.difference(turf.featureCollection([feat, byName[hole]])) || feat; } catch (e) { /* keep whole */ } }
    // woods can take their ground away from other terrain areas (e.g. a forest around a fort inside a mountain range)
    if (w.carves) {
      for (const t of terrain) {
        if (t.source !== 'tel-tenauril' || !w.carves.includes(t.kind)) continue;
        try { const r = turf.difference(turf.featureCollection([turf.polygon(t.coords), byName[w.name]])); if (r && r.geometry.type === 'Polygon') t.coords = r.geometry.coordinates; } catch (e) { /* leave as is */ }
      }
    }
    const parts = feat.geometry.type === 'Polygon' ? [feat.geometry.coordinates] : feat.geometry.coordinates;
    for (const coords of parts) for (const c of clipToLand(coords)) terrain.push({ kind: w.kind, source: 'tel-tenauril', coords: c });
  });
}

// Hand-placed polygons have ruler-straight edges; give them a hand-drawn wobble (source px) so ranges and woods
// don't end in visible rectangles.
function roughen(poly, amp, seed, step = 45) {
  const rnd = rng(seed);
  const pts = [];
  for (let i = 0; i < poly.length; i++) {
    const [x0, y0] = poly[i], [x1, y1] = poly[(i + 1) % poly.length];
    const len = Math.hypot(x1 - x0, y1 - y0), n = Math.max(1, Math.round(len / step));
    const nx = -(y1 - y0) / (len || 1), ny = (x1 - x0) / (len || 1);
    pts.push([x0, y0]);
    for (let k = 1; k < n; k++) {
      const t = k / n, o = (rnd() - 0.5) * 2 * amp;
      pts.push([x0 + (x1 - x0) * t + nx * o, y0 + (y1 - y0) * t + ny * o]);
    }
  }
  let ring = [...pts, pts[0]];
  for (let it = 0; it < 2; it++) {
    const next = [];
    for (let i = 0; i < ring.length - 1; i++) {
      const a = ring[i], b = ring[i + 1];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    ring = [...next, next[0]];
  }
  return ring;
}

// ---------------- Argusund: hand-placed terrain polygons (the drawing has no outlines to flood) ----------------
arg.features.forEach((f, i) => addTerrain(f.kind, 'argusund', arg, [[roughen(f.poly, f.rough ?? (f.kind === 'hills' ? 8 : 30), 900 + i)]]));

// ---------------- Selladorian Free Nations (hand-drawn photo), fitted over the Untamed Lands ----------------
fn.features.forEach((f, i) => f.name === 'Border Mountains' ? null : addTerrain(f.kind, 'free-nations', fn, [[roughen(f.poly, f.rough ?? (f.kind === 'hills' ? 10 : 12), 1100 + i, 30)]], true, 'insideFNoutBH'));

// ---------------- the Berhagen coast (the author's Wonderdraft map): mountains, woods, marsh ----------------
bh.features.forEach((f, i) => addTerrain(f.kind, 'berhagen', bh, [[roughen(f.poly, 6, 2200 + i, 40)]], true, 'insideBH'));

// ---------------- eastern Kharse, the Valley of Ertrugol and western Boddendell (hand-drawn map) ----------------
ke.features.forEach((f, i) => addTerrain(f.kind, 'kharse-ertrugol', ke, [[roughen(f.poly, f.rough ?? 20, 2100 + i, 60)]], true, f.mode ?? 'insideKE'));

// ---------------- Curmeah (hand-drawn continent) ----------------
cur.features.forEach((f, i) => addTerrain(f.kind, 'curmeah', cur, [[roughen(f.poly, f.rough ?? 8, 1300 + i, 60)]]));

// ---------------- Lochlainn (hand-drawn island) ----------------
loc.features.forEach((f, i) => addTerrain(f.kind, 'lochlainn', loc, [[roughen(f.poly, f.rough ?? (f.kind === 'hills' ? 6 : 16), 1700 + i, 40)]]));
// Lochlainn is the author's Ireland: lush and green. Everything that isn't The Waste or the mountains is forest.
{
  const proj = lonlat(loc);
  let feat = turf.polygon([[[0, 200], [1410, 200], [1410, 1990], [0, 1990], [0, 200]].map(proj)]);
  for (const f of loc.features.filter((x) => ['waste', 'mountain'].includes(x.kind))) {
    try { feat = turf.difference(turf.featureCollection([feat, turf.polygon([[...f.poly, f.poly[0]].map(proj)])])) || feat; } catch (e) { /* keep */ }
  }
  for (const coords of feat.geometry.type === 'Polygon' ? [feat.geometry.coordinates] : feat.geometry.coordinates) {
    for (const c of clipToLand(coords)) terrain.push({ kind: 'forest', source: 'lochlainn', coords: c });
  }
}

const roads = [];
// ---------------- The Border Mountains: one range from sea to sea (source/adjustments.json) ----------------
{
  const bm = adj.borderMountains;
  const toLLw = ([x, y]) => [(x - WORLD / 2) * DEG_PER_WORLD_PX, -(y - WORLD / 2) * DEG_PER_WORLD_PX];
  const toW = ([lng, lat]) => [lng / DEG_PER_WORLD_PX + WORLD / 2, WORLD / 2 - lat / DEG_PER_WORLD_PX];
  // the mountains the Sellador render drew in the south are the range's old location: remove them
  for (const [x0, y0, x1, y1] of bm.dropSelladorMountainsIn) {
    for (let i = terrain.length - 1; i >= 0; i--) {
      const t = terrain[i];
      if (t.source !== 'sellador' || t.kind !== 'mountain') continue;
      const b = turf.bbox(turf.polygon(t.coords)), [cx, cy] = toW([(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]);
      if (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) terrain.splice(i, 1);
    }
  }
  const left = bm.line.map(([x, y]) => [x - bm.halfWidth, y]), right = bm.line.map(([x, y]) => [x + bm.halfWidth, y]).reverse();
  const stripLL = turf.polygon([roughen([...left, ...right], 0.35, 4242, 4).map(toLLw)]);
  // the range takes its ground from the woods and hills drawn on either side
  const kept = [];
  for (const t of terrain) {
    if (!bm.carves.includes(t.kind) || !['sellador', 'free-nations'].includes(t.source)) { kept.push(t); continue; }
    let r = null;
    try { r = turf.difference(turf.featureCollection([turf.polygon(t.coords), stripLL])); } catch (e) { kept.push(t); continue; }
    if (!r) continue;
    for (const coords of r.geometry.type === 'Polygon' ? [r.geometry.coordinates] : r.geometry.coordinates) kept.push({ ...t, coords });
  }
  terrain.length = 0; terrain.push(...kept);
  // a pass cuts the range east to west (this is where Drachenhorn stands), with a mountain road through it
  const ps = bm.pass;
  const gapLL = turf.polygon([roughen([[ps.x0, ps.y0], [ps.x1, ps.y0], [ps.x1, ps.y1], [ps.x0, ps.y1]], 0.25, 77, 3).map(toLLw)]);
  let ranges = stripLL;
  try { ranges = turf.difference(turf.featureCollection([stripLL, gapLL])) || stripLL; } catch (e) { /* keep whole */ }
  for (const coords of ranges.geometry.type === 'Polygon' ? [ranges.geometry.coordinates] : ranges.geometry.coordinates) {
    // the Berhagen map draws the real mountains of this stretch, so the generic strip stops at its edge
    for (const c of clipToLand(coords)) for (const d of limitToPaper(c, 'outsideBH')) terrain.push({ kind: 'mountain', source: 'borderrange', coords: d });
  }
  roads.push({ type: 'Feature', properties: { name: 'Drachenhorn Pass road', kind: 'mountain-road' }, geometry: { type: 'LineString', coordinates: smoothLine(ps.road.map(toLLw), 2).map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]) } });
}

// ---------------- the islands west of Sellador: Prios, Thanatos, Agrea ----------------
for (const isl of islandDefs) {
  isl.features.forEach((f, i) => addTerrain(f.kind, isl.id, isl, [[roughen(f.poly, f.rough ?? 0.5 / isl.scale, 1900 + i, 30)]]));
}

// ---------------- ranges that link the existing mountains (adjustments.json: ridges) ----------------
// Real mountains come in chains: each ridge is a long mountain belt with a skirt of foothills either side.
{
  const toLLw = ([x, y]) => [(x - WORLD / 2) * DEG_PER_WORLD_PX, -(y - WORLD / 2) * DEG_PER_WORLD_PX];
  const toWw = ([lng, lat]) => [lng / DEG_PER_WORLD_PX + WORLD / 2, WORLD / 2 - lat / DEG_PER_WORLD_PX];
  const kmPerPx = DEG_PER_WORLD_PX * 111.19;
  (adj.ridges || []).forEach((r, i) => {
    const line = turf.lineString(smoothLine(r.pts.map(toLLw), 2));
    const shape = (halfPx, seed) => turf.polygon([roughen(turf.buffer(line, halfPx * kmPerPx, { units: 'kilometers', steps: 6 }).geometry.coordinates[0].map(toWw).slice(0, -1), 0.9, seed, 5).map(toLLw)]);
    const core = shape(r.half, 7300 + i), skirt = shape(r.half * 2.3, 7400 + i);
    let hills = skirt;
    try { hills = turf.difference(turf.featureCollection([skirt, core])) || skirt; } catch (e) { /* keep whole skirt */ }
    for (const c of clipToLand(core.geometry.coordinates)) terrain.push({ kind: 'mountain', source: 'range', coords: c });
    for (const part of hills.geometry.type === 'Polygon' ? [hills.geometry.coordinates] : hills.geometry.coordinates) for (const c of clipToLand(part)) terrain.push({ kind: 'hills', source: 'range', coords: c });
  });
}

// ---------------- Atma: the ruined city of the Atman Empire stands inside a ring of mountains ----------------
{
  const ring = adj.atmaMountains;
  const placements = fs.existsSync(path.join(SRC, 'placements.json')) ? JSON.parse(fs.readFileSync(path.join(SRC, 'placements.json'), 'utf8')).placements : [];
  const pl = placements.find((p) => p.dbId === ring.dbId);
  const centre = pl ? [pl.lng / DEG_PER_WORLD_PX + WORLD / 2, WORLD / 2 - pl.lat / DEG_PER_WORLD_PX] : ring.fallbackAt;
  const toLLw = ([x, y]) => [(x - WORLD / 2) * DEG_PER_WORLD_PX, -(y - WORLD / 2) * DEG_PER_WORLD_PX];
  const circle = (r, seed) => { const rnd = rng(seed); const ph = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28]; return Array.from({ length: 64 }, (_, i) => { const a = (i / 64) * Math.PI * 2; const k = 1 + 0.16 * Math.sin(3 * a + ph[0]) + 0.1 * Math.sin(5 * a + ph[1]) + 0.05 * Math.sin(9 * a + ph[2]); return [centre[0] + Math.cos(a) * r * k, centre[1] + Math.sin(a) * r * k]; }); };
  const outer = circle(ring.outer, 31), inner = circle(ring.inner, 47);
  const poly = turf.polygon([[...outer, outer[0]].map(toLLw), [...inner, inner[0]].map(toLLw)]);
  for (const c of clipToLand(poly.geometry.coordinates)) terrain.push({ kind: 'mountain', source: 'atma', coords: c });
  // the ruins of the city itself, inside the ring
  for (const c of clipToLand([[...inner, inner[0]].map(toLLw)])) terrain.push({ kind: 'ruins', source: 'atma', coords: c });
}

// ---------------- terrain around the regions the author placed (source/adjustments.json: terrain) ----------------
// Kharse's desert stops where the Ertrugol drawing's western mountains begin: everything east of the line along their west foot is cut away
const desertCut = turf.polygon([[[650, -100], [2100, -100], [2100, 2200], [850, 2200], [850, 1395], [815, 1360], [880, 1300], [905, 1230], [865, 1160], [825, 1085], [780, 1005], [735, 935], [690, 925], [640, 880], [590, 820], [560, 730], [610, 640], [620, 560], [635, 470], [648, 395], [650, 300], [650, -100]].map(lonlat(ke))]);
{
  const toLLw = ([x, y]) => [(x - WORLD / 2) * DEG_PER_WORLD_PX, -(y - WORLD / 2) * DEG_PER_WORLD_PX];
  (adj.terrain || []).forEach((t, i) => {
    let ring;
    if (t.ellipse) {
      const [cx, cy, rx, ry] = t.ellipse, rnd = rng(6100 + i), ph = [rnd() * 6.28, rnd() * 6.28];
      ring = Array.from({ length: 40 }, (_, k) => { const a = (k / 40) * Math.PI * 2, w = 1 + 0.14 * Math.sin(3 * a + ph[0]) + 0.08 * Math.sin(6 * a + ph[1]); return [cx + Math.cos(a) * rx * w, cy + Math.sin(a) * ry * w]; });
    } else ring = roughen(t.poly, 1.5, 6100 + i, 12);
    for (const c of clipToLand([[...ring, ring[0]].map(toLLw)])) {
      // the blasted desert is only a guess round the Kharse pin: where the Ertrugol drawing has been placed, the drawing decides
      if (t.source === 'kharse' && t.kind === 'desert') {
        try { const r = turf.difference(turf.featureCollection([turf.polygon(c), desertCut])); if (r) for (const d of r.geometry.type === 'Polygon' ? [r.geometry.coordinates] : r.geometry.coordinates) terrain.push({ kind: t.kind, source: t.source, coords: d }); } catch (e) { terrain.push({ kind: t.kind, source: t.source, coords: c }); }
        continue;
      }
      terrain.push({ kind: t.kind, source: t.source || 'adjust', coords: c });
    }
  });
}

// Small lakes drawn on top of the land (too small to be holes in the land polygon).
const lakes = [];
for (const [m, list] of [[sel, sel.lakes || []], [fn, fn.lakes || []], [ke, ke.lakes || []], [bh, bh.lakes || []], [cur, cur.lakes || []], [loc, loc.lakes || []], ...islandDefs.map((i) => [i, i.lakes || []])]) {
  const proj = lonlat(m);
  for (const l of list) {
    if (l.poly) { const ring = [...l.poly, l.poly[0]].map(proj); lakes.push({ type: 'Feature', properties: { name: l.name || '' }, geometry: { type: 'Polygon', coordinates: [ring] } }); continue; }
    const rx = (l.rx ?? l.r * 1.1), ry = (l.ry ?? l.r * 0.8);
    const ring = [];
    for (let i = 0; i <= 16; i++) { const a = (i / 16) * Math.PI * 2; ring.push(proj([l.x + Math.cos(a) * rx, l.y + Math.sin(a) * ry])); }
    lakes.push({ type: 'Feature', properties: { name: l.name }, geometry: { type: 'Polygon', coordinates: [ring] } });
  }
}

// ---------------- scatter symbols inside terrain polygons ----------------
// Symbols keep clear of water (coast, lakes) and shrink toward the edge of their area, so the biggest ones
// sit in the middle of a range or wood.
const ringSegments = (rings) => rings.flatMap((r) => r.slice(0, -1).map((a, i) => [a[0], a[1], r[i + 1][0], r[i + 1][1]]));
const allWaterSegs = [
  ...landFeat.geometry.coordinates.flatMap((poly) => ringSegments(poly)),
  ...lakes.flatMap((l) => ringSegments(l.geometry.coordinates)),
];
function distToSegs(px, py, segs) {
  let best = Infinity;
  for (const [x0, y0, x1, y1] of segs) {
    const dx = x1 - x0, dy = y1 - y0, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x0) * dx + (py - y0) * dy) / l2 : 0;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    const d = Math.hypot(px - x0 - t * dx, py - y0 - t * dy);
    if (d < best) best = d;
  }
  return best;
}
const MARGIN = { mountain: 1.5, hills: 1.1, forest: 0.9, marsh: 0.7, desert: 0.8, newgrowth: 0.6, ruins: 0.9 }; // world px kept clear of water
const SIZE_RANGE = { mountain: [0.45, 1.3], hills: [0.55, 1.2], forest: [0.6, 1.2], marsh: [0.65, 1.15], desert: [0.7, 1.15], newgrowth: [0.7, 1.1], ruins: [0.75, 1.2] };
// extra spacing for one kind on one map: Lochlainn is covered in forest, which needs a lot fewer trees than a small woodland
const SPACING_KIND = { 'lochlainn:forest': 2.3 };
const SPACING_SCALE = { curmeah: 1.9, lochlainn: 0.55, borderrange: 0.5, atma: 0.5, citadel: 0.55, range: 0.6, polar: 0.7, kharse: 0.8, valkith: 0.5, lehng: 1, shattered: 0.7, phocacia: 0.6, prios: 0.2, thanatos: 0.22, agrea: 0.2, umbral: 0.055, isle: 0.11, baratoria: 0.2 }; // Lochlainn is drawn small in world px, so its symbols pack closer
const rand = rng(1337);
const icons = [];
const STAGES = {
  mountain: [6.0, 4.4, 3.2],
  hills: [6.0, 4.6, 3.6],
  forest: [4.4, 3.0, 2.2],
  marsh: [5.0, 3.6, 2.8],
  ruins: [7.0, 5.0, 3.8],
  desert: [9.0, 6.5, 5.0],
  newgrowth: [3.2, 2.4, 1.8],
};
for (const t of terrain) {
  if (!STAGES[t.kind]) continue;
  // Curmeah is drawn at a larger scale (its polygons are huge in world px), so its symbols are spread wider
  const stages = STAGES[t.kind].map((s) => s * (SPACING_SCALE[t.source] ?? 1) * (SPACING_KIND[`${t.source}:${t.kind}`] ?? 1));
  const poly = turf.polygon(t.coords);
  const [minX, minY, maxX, maxY] = turf.bbox(poly);
  const pad = 4 * DEG_PER_WORLD_PX;
  const nearWater = allWaterSegs.filter(([x0, y0, x1, y1]) => Math.max(x0, x1) >= minX - pad && Math.min(x0, x1) <= maxX + pad && Math.max(y0, y1) >= minY - pad && Math.min(y0, y1) <= maxY + pad);
  const ownEdge = ringSegments(t.coords);
  const small = islandDefs.some((i) => i.id === t.source); // the western islands are tiny: finer symbols that appear only when zoomed in
  const tierOffset = small ? 3 : 0;
  const margin = MARGIN[t.kind] * (small ? 0.45 : 1) * (t.source === 'umbral' ? 0.3 : 1) * DEG_PER_WORLD_PX; // the Umbral Isle is only about three map px across
  const placed = [];
  const hash = new Map();
  const cell = stages[stages.length - 1] * DEG_PER_WORLD_PX;
  const key = (x, y) => `${Math.floor(x / cell)},${Math.floor(y / cell)}`;
  const near = (x, y, d) => {
    const cx = Math.floor(x / cell), cy = Math.floor(y / cell), reach = Math.ceil(d / cell);
    for (let i = -reach; i <= reach; i++) for (let j = -reach; j <= reach; j++) {
      for (const p of hash.get(`${cx + i},${cy + j}`) || []) if (Math.hypot(p[0] - x, p[1] - y) < d) return true;
    }
    return false;
  };
  stages.forEach((spacingPx, tier) => {
    const d = spacingPx * DEG_PER_WORLD_PX;
    for (let y = minY; y < maxY; y += d * 0.7) {
      for (let x = minX; x < maxX; x += d * 0.7) {
        const px = x + (rand() - 0.5) * d * 0.7, py = y + (rand() - 0.5) * d * 0.7;
        if (px < minX || px > maxX || py < minY || py > maxY) continue;
        if (near(px, py, d * 0.82)) continue;
        if (!turf.booleanPointInPolygon([px, py], poly)) continue;
        if (lakes.some((l) => turf.booleanPointInPolygon([px, py], l))) continue;
        if (distToSegs(px, py, nearWater) < margin) continue;
        const k = key(px, py);
        if (!hash.has(k)) hash.set(k, []);
        hash.get(k).push([px, py]);
        placed.push({ type: 'Feature', properties: { kind: t.kind, tier: tier + tierOffset, v: Math.floor(rand() * 240), s: 1, sk: +(-py).toFixed(4) }, geometry: { type: 'Point', coordinates: [+px.toFixed(5), +py.toFixed(5)] } });
      }
    }
  });
  // size by depth: distance from the area's edge, relative to how deep the area gets
  const depth = placed.map((f) => distToSegs(f.geometry.coordinates[0], f.geometry.coordinates[1], ownEdge));
  const sorted = depth.slice().sort((a, b) => a - b);
  const reference = sorted[Math.floor(sorted.length * 0.85)] || 1e-9;
  const [lo, hi] = SIZE_RANGE[t.kind];
  placed.forEach((f, i) => {
    const u = Math.min(1, depth[i] / reference);
    f.properties.s = +((lo + (hi - lo) * Math.sqrt(u)) * (0.92 + rand() * 0.16)).toFixed(2);
  });
  icons.push(...placed);
}
// Named landmark peaks (e.g. Arrokoth) are drawn from the first zoom levels, a little bigger than their neighbours
for (const lm of adj.promoteMountains || []) {
  const target = [(lm.at[0] - WORLD / 2) * DEG_PER_WORLD_PX, -(lm.at[1] - WORLD / 2) * DEG_PER_WORLD_PX];
  let best = null, bd = 2.5 * DEG_PER_WORLD_PX;
  for (const f of icons) if (f.properties.kind === 'mountain') { const d = Math.hypot(f.geometry.coordinates[0] - target[0], f.geometry.coordinates[1] - target[1]); if (d < bd) { bd = d; best = f; } }
  if (best) { best.properties.tier = 0; best.properties.s = +(best.properties.s * (lm.scale || 1.15)).toFixed(2); console.log('promoted landmark peak at', lm.at.join(',')); } else console.log('WARNING: no mountain icon near', lm.at.join(','));
}
console.log('terrain polygons', terrain.length, 'icons', icons.length);

// ---------------- rivers, lakes, places, regions ----------------
function smoothLine(pts, iters = 2) {
  let p = pts;
  for (let k = 0; k < iters; k++) {
    const out = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    out.push(p[p.length - 1]);
    p = out;
  }
  return p;
}
// Waypoints were placed by eye; add gentle meanders (in source px) so rivers read as rivers, not rulers.
function meander(pts, seed) {
  const rnd = rng(seed);
  const out = [pts[0]];
  const phase = [rnd() * 6.28, rnd() * 6.28];
  let travelled = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1];
    const len = Math.hypot(x1 - x0, y1 - y0);
    const nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
    const steps = Math.max(2, Math.round(len / 10));
    for (let k = 1; k <= steps; k++) {
      const t = k / steps, dist = travelled + len * t;
      const amp = k === steps && i === pts.length - 2 ? 0 : Math.min(7, 2 + len * 0.05);
      const off = amp * (0.7 * Math.sin(dist / 23 + phase[0]) + 0.4 * Math.sin(dist / 9 + phase[1]));
      out.push([x0 + (x1 - x0) * t + nx * off, y0 + (y1 - y0) * t + ny * off]);
    }
    travelled += len;
  }
  return out;
}
const rivers = [['tel-tenauril', tt], ['argusund', arg], ['free-nations', fn], ['kharse-ertrugol', ke], ['berhagen', bh], ['curmeah', cur], ['lochlainn', loc], ...islandDefs.map((i) => [i.id, i])].flatMap(([src, m], mi) => (m.rivers || []).map((r, i) => ({
  type: 'Feature', properties: { name: r.name || '', source: src, ...(r.w > 1 ? { w: r.w } : {}) },
  geometry: { type: 'LineString', coordinates: smoothLine(meander(r.pts, 500 + mi * 50 + i).map(lonlat(m)), 1).map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]) },
})));

// Invented rivers across the parts of the continents nobody has drawn (source/adjustments.json: rivers). Each flows from
// an inland point toward a coast (the line wanders, and stops where it reaches the sea); `delta` fans it into channels.
{
  const toLLw = ([x, y]) => [(x - WORLD / 2) * DEG_PER_WORLD_PX, -(y - WORLD / 2) * DEG_PER_WORLD_PX];
  const inLand = (p) => turf.booleanPointInPolygon(toLLw(p), landFeat);
  const rnd = rng(8080);
  const march = (from, ang, maxLen, wig) => {
    const ph = [rnd() * 6.28, rnd() * 6.28], pts = [from.slice()];
    const nx = -Math.sin(ang), ny = Math.cos(ang);
    for (let t = 1.4; t < maxLen; t += 1.4) {
      const off = wig * Math.min(1, t / 18) * (0.7 * Math.sin(t / 8 + ph[0]) + 0.4 * Math.sin(t / 3.3 + ph[1]));
      const p = [from[0] + Math.cos(ang) * t + nx * off, from[1] + Math.sin(ang) * t + ny * off];
      if (!inLand(p)) break;
      pts.push(p);
    }
    return pts;
  };
  const line = (pts, name = '') => ({ type: 'Feature', properties: { name, source: 'procedural' }, geometry: { type: 'LineString', coordinates: smoothLine(pts.map(toLLw), 1).map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]) } });
  for (const r of adj.rivers || []) {
    const ang = Math.atan2(r.to[1] - r.from[1], r.to[0] - r.from[0]);
    const pts = march(r.from, ang, Math.hypot(r.to[0] - r.from[0], r.to[1] - r.from[1]) + 45, 2.6);
    if (pts.length < 6) continue;
    rivers.push(line(pts));
    if (r.delta) {
      const k = Math.max(0, pts.length - 7), apex = pts[k], a = pts[k + 1];
      const base = Math.atan2(a[1] - apex[1], a[0] - apex[0]);
      for (const da of [-42, -17, 14, 38]) {
        const ch = march(apex, base + (da * Math.PI) / 180 + (rnd() - 0.5) * 0.15, 16 + rnd() * 6, 1.1);
        if (ch.length > 3) rivers.push(line([...ch, [ch[ch.length - 1][0] + Math.cos(base + (da * Math.PI) / 180) * 0.8, ch[ch.length - 1][1] + Math.sin(base + (da * Math.PI) / 180) * 0.8]]));
      }
    }
  }
  // rivers drawn by hand through points in world px (adjustments.riverLines: name, w, pts)
  for (const r of adj.riverLines || []) { const f = line(r.pts, r.name || ''); f.properties = { name: r.name || '', source: 'hand', ...(r.w > 1 ? { w: r.w } : {}) }; rivers.push(f); }
  // names for rivers already drawn: every segment with a point within `radius` world px of `at` (adjustments.riverNames)
  for (const n of adj.riverNames || []) {
    for (const f of rivers) {
      const ls = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
      if (!f.properties.name && ls.some((l) => l.some(([lng, lat]) => Math.hypot(lng * 51.2 + 512 - n.at[0], 512 - lat * 51.2 - n.at[1]) <= n.radius))) f.properties.name = n.name;
    }
  }
}

const pt =(props, m, x, y) => ({ type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: lonlat(m)([x, y]).map((v) => +v.toFixed(5)) } });
const places = [], regions = [];
// Sellador labels that fall under the Free Nations drawing are superseded by it (e.g. "The Untamed Lands").
const underFn = (f) => turf.booleanPointInPolygon(f.geometry.coordinates, paperLL);
for (const [src, m] of [['tel-tenauril', tt], ['sellador', sel], ['argusund', arg], ['free-nations', fn], ['kharse-ertrugol', ke], ['berhagen', bh], ['curmeah', cur], ['lochlainn', loc], ...islandDefs.map((i) => [i.id, i])]) {
  const im = adj.islandMove, drop = new Set(adj.borderMountains.dropLabels);
  const dLng = (im.to[0] - im.from[0]) * DEG_PER_WORLD_PX, dLat = -(im.to[1] - im.from[1]) * DEG_PER_WORLD_PX;
  const mk = (list, props) => list
    .map((p) => pt(props(p), m, p.x, p.y))
    .filter((f) => (src === 'sellador' ? !underFn(f) && !inBH(f) && !drop.has(f.properties.name) : src === 'free-nations' ? underFn(f) && !inBH(f) : true))
    .map((f) => {
      const mv = src === 'sellador' ? adj.borderMountains.moveLabels[f.properties.name] : null;
      if (mv) f.geometry.coordinates = [+(f.geometry.coordinates[0] + mv[0] * DEG_PER_WORLD_PX).toFixed(5), +(f.geometry.coordinates[1] - mv[1] * DEG_PER_WORLD_PX).toFixed(5)];
      if (src === 'sellador' && im.labels.includes(f.properties.name)) f.geometry.coordinates = [+(f.geometry.coordinates[0] + dLng).toFixed(5), +(f.geometry.coordinates[1] + dLat).toFixed(5)];
      return f;
    });
  places.push(...mk(m.places || [], (p) => ({ name: p.name, kind: p.kind, rank: p.rank, source: src, verified: false, ...(p.note ? { note: p.note } : {}) })));
  regions.push(...mk(m.regions || [], (r) => ({ name: r.name, kind: r.kind, rank: r.rank, source: src })));
}
for (const l of adj.arcticLabels || []) {
  regions.push({ type: 'Feature', properties: { name: l.name, kind: l.kind, rank: l.rank, source: 'adjust', note: l.note }, geometry: { type: 'Point', coordinates: [+((l.at[0] - WORLD / 2) * DEG_PER_WORLD_PX).toFixed(5), +(-(l.at[1] - WORLD / 2) * DEG_PER_WORLD_PX).toFixed(5)] } });
}
for (const l of adj.extraPlaces || []) {
  places.push({ type: 'Feature', properties: { name: l.name, kind: l.kind, rank: l.rank ?? 3, source: 'campaign', verified: false, ...(l.guess ? { guess: true, basis: l.basis } : {}), ...(l.note ? { note: l.note } : {}) }, geometry: { type: 'Point', coordinates: [+((l.at[0] - WORLD / 2) * DEG_PER_WORLD_PX).toFixed(5), +(-(l.at[1] - WORLD / 2) * DEG_PER_WORLD_PX).toFixed(5)] } });
}
for (const l of adj.extraLabels || []) {
  regions.push({ type: 'Feature', properties: { name: l.name, kind: l.kind, rank: l.rank, source: 'adjust', note: l.note }, geometry: { type: 'Point', coordinates: [+((l.at[0] - WORLD / 2) * DEG_PER_WORLD_PX).toFixed(5), +(-(l.at[1] - WORLD / 2) * DEG_PER_WORLD_PX).toFixed(5)] } });
}
{
  const l = adj.borderMountains.label;
  regions.push({ type: 'Feature', properties: { name: l.name, kind: 'mountain', rank: 2, source: 'adjust' }, geometry: { type: 'Point', coordinates: [+((l.at[0] - WORLD / 2) * DEG_PER_WORLD_PX).toFixed(5), +(-(l.at[1] - WORLD / 2) * DEG_PER_WORLD_PX).toFixed(5)] } });
}

const fc = (features) => ({ type: 'FeatureCollection', features });
const write = (name, features) => fs.writeFileSync(path.join(dataDir, name), JSON.stringify(fc(features)));
write('terrain.geojson', terrain.map((t) => ({ type: 'Feature', properties: { kind: t.kind, source: t.source }, geometry: { type: 'Polygon', coordinates: t.coords.map((r) => r.map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)])) } })));
write('icons.geojson', icons);
write('rivers.geojson', rivers);
// ocean currents (warm arrows) for the map's current layer
write('currents.geojson', (adj.currents || []).map((c) => ({ type: 'Feature', properties: { name: c.name, warm: !!c.warm }, geometry: { type: 'LineString', coordinates: smoothLine(c.pts.map(([x, y]) => [(x - WORLD / 2) * DEG_PER_WORLD_PX, -(y - WORLD / 2) * DEG_PER_WORLD_PX]), 3).map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]) } })));
write('roads.geojson', roads);
write('lakes.geojson', lakes);
write('places.geojson', places);
write('regions.geojson', regions);
for (const f of ['terrain', 'icons', 'rivers', 'lakes', 'places', 'regions']) console.log(f, fs.statSync(path.join(dataDir, f + '.geojson')).size, 'bytes');
