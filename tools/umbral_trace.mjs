// Trace the illustrated map of the Umbral Isle (original_data/maps/umbral.png) into outlines for source/islands.json.
// Colours decide what is known: tan is land, teal is sea. Everything else (trees, mountain lines, the title, and the clouds that
// cover parts of the coast) is "unknown" and takes the nearest known side, so a cloud over the coast puts the shore about halfway
// across it. The land is then outlined and simplified.
// usage: node umbral_trace.mjs [--write]   (without --write: only writes _umbral_trace.png to check; with it, updates islands.json)
import fs from 'node:fs';
import sharp from 'sharp';
import { contours } from 'd3-contour';
import * as turf from '@turf/turf';

const WRITE = process.argv.includes('--write');
const SRC = '../original_data/maps/umbral.png';
const { data, info } = await sharp(SRC).flatten({ background: '#ffffff' }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, N = W * H;
const state = new Uint8Array(N); // 0 unknown, 1 land, 2 sea
for (let i = 0; i < N; i++) {
  const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
  if (r > b + 22 && r > 110) state[i] = 1; // parchment tan
  else if (b > r + 14 && g > r + 4) state[i] = 2; // teal sea and its pale glow
}
// every unknown pixel takes the nearest known side (multi-source breadth-first)
const lab = Uint8Array.from(state), queue = [];
for (let i = 0; i < N; i++) if (lab[i]) queue.push(i);
for (let h = 0; h < queue.length; h++) {
  const i = queue[h], x = i % W, y = (i / W) | 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (!lab[j]) { lab[j] = lab[i]; queue.push(j); } }
}
// a light smoothing (3x3 majority, twice) removes specks of lettering and tree outlines
let land = Uint8Array.from(lab, (v) => (v === 1 ? 1 : 0));
for (let pass = 0; pass < 2; pass++) {
  const nx = new Uint8Array(N);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) { let s = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += land[(y + dy) * W + x + dx]; nx[y * W + x] = s >= 5 ? 1 : 0; }
  land = nx;
}
const g = new Float32Array(N); for (let i = 0; i < N; i++) g[i] = land[i];
const mp = contours().size([W, H]).thresholds([0.5])(g)[0];
const rings = [];
for (const poly of mp.coordinates) {
  const ring = poly[0], a = Math.abs(turf.area(turf.polygon([ring])));
  if (a < 400) continue;
  let line = turf.simplify(turf.lineString(ring), { tolerance: 1.4, highQuality: true }).geometry.coordinates;
  if (line[0][0] === line[line.length - 1][0] && line[0][1] === line[line.length - 1][1]) line = line.slice(0, -1);
  rings.push({ a, pts: line.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]) });
}
rings.sort((p, q) => q.a - p.a);
console.log('rings', rings.map((r) => `${r.pts.length} pts, area ${Math.round(r.a)}`).join(' | '));

// picture to check: the map with the outline drawn in red
const rgb = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) { rgb[i * 4] = data[i * 3]; rgb[i * 4 + 1] = data[i * 3 + 1]; rgb[i * 4 + 2] = data[i * 3 + 2]; rgb[i * 4 + 3] = 255; }
const dot = (x, y) => { const px = Math.round(x), py = Math.round(y); if (px >= 0 && py >= 0 && px < W && py < H) { const o = (py * W + px) * 4; rgb[o] = 230; rgb[o + 1] = 20; rgb[o + 2] = 20; } };
for (const { pts } of rings) for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])) + 1; for (let k = 0; k <= n; k++) dot(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n); }
await sharp(rgb, { raw: { width: W, height: H, channels: 4 } }).png().toFile('_umbral_trace.png');
console.log('wrote tools/_umbral_trace.png');

if (WRITE) {
  const F = 'source/islands.json', cfg = JSON.parse(fs.readFileSync(F, 'utf8'));
  const SCALE = 0.0049; // world px per picture px: the main island comes out about 18 miles across (the author gave no size; first drawn 27 miles, then made a third smaller)
  const main = rings[0].pts, xs = main.map((p) => p[0]), ys = main.map((p) => p[1]);
  const entry = {
    id: 'umbral', title: 'The Umbral Isle', map: 'umbral.png (illustrated map)', scale: SCALE, at: [-318.5, 448.8],
    coast: main, islets: rings.slice(1).map((r) => r.pts), lakes: [], rivers: [],
    features: [
      { name: 'Umbral peak', kind: 'mountain', poly: [[120, 205], [150, 170], [195, 140], [235, 115], [275, 135], [320, 175], [350, 215], [310, 240], [250, 235], [190, 240], [140, 225]] },
      { name: 'Umbral woods (north)', kind: 'forest', poly: [[150, 115], [175, 85], [215, 80], [250, 95], [300, 100], [340, 120], [335, 150], [300, 140], [250, 125], [200, 130], [165, 150]] },
      { name: 'Umbral woods (west)', kind: 'forest', poly: [[75, 225], [110, 205], [160, 215], [185, 250], [150, 268], [105, 262]] },
      { name: 'Umbral woods (south)', kind: 'forest', poly: [[230, 245], [280, 240], [340, 235], [385, 250], [395, 285], [340, 292], [270, 285]] },
      { name: 'Umbral islet wood', kind: 'forest', poly: [[480, 175], [510, 175], [515, 205], [485, 205]] },
    ],
    places: [], regions: [], bandScale: 0.06, wobble: 0,
    _note: 'Traced from the author\'s illustrated map original_data/maps/umbral.png (tools/umbral_trace.mjs): the island, the north-western tip, and the little isle to the east. Where clouds hide the coast it is drawn halfway across them. Terrain areas are outlined by eye. No size was given, so the island is drawn about 18 miles across (SCALE in the tracer); centred three days\' sailing north-west of Agrea.',
  };
  const i = cfg.islands.findIndex((x) => x.id === 'umbral');
  if (i >= 0) cfg.islands[i] = entry; else cfg.islands.push(entry);
  fs.writeFileSync(F, JSON.stringify(cfg, null, 1));
  console.log('wrote the umbral island into', F);
}
