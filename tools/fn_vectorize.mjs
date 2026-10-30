// Vectorise the clean Free Nations outline (original_data/maps/free_nations_outline.jpg, 695x468) into polygons, lakes and rivers
// in the PHOTO frame that source/free-nations.json uses. The outline is the same drawing as the photo squeezed vertically:
//   outline = (1.0063 * x - 69.2,  0.7943 * y - 23.1)   (fitted on the three lakes; the old coast agrees to a few px).
// usage: node fn_vectorize.mjs [--write]    (without --write it only writes the overlay _fn_extract.png and prints what it found)
import fs from 'node:fs';
import sharp from 'sharp';
import { contours } from 'd3-contour';
import * as turf from '@turf/turf';

const WRITE = process.argv.includes('--write');
const AX = 1.0063, BX = -69.2, AY = 0.7943, BY = -23.1;
const toPhoto = ([x, y]) => [(x - BX) / AX, (y - BY) / AY];
const SRC = '../original_data/maps/free_nations_outline.jpg';
const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, N = W * H;

// ---- colour classes ----
const BLACK = 1, GREEN = 2, NAVY = 3, LBLUE = 4, CYAN = 5;
const cls = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
  const x = i % W, y = (i / W) | 0;
  if (x < 2 || y < 2 || x >= W - 2 || y >= H - 2) continue; // the picture frame
  if (r > 215 && g > 215 && b > 215) continue;
  if (r < 130 && g < 130 && b > r + 30 && b > g + 25) cls[i] = NAVY;
  else if (b > 110 && b > r + 40 && b > g + 20) cls[i] = LBLUE;
  else if (g > 185 && b > 185 && r < 175) cls[i] = CYAN;
  else if (g > r + 12 && g > b + 12) cls[i] = GREEN;
  else if (r < 120 && g < 120 && b < 120) cls[i] = BLACK;
}
const count = (k) => cls.reduce((n, v) => n + (v === k ? 1 : 0), 0);
console.log('pixels: black', count(BLACK), 'green', count(GREEN), 'navy', count(NAVY), 'lightblue', count(LBLUE), 'cyan', count(CYAN));

const dilate = (mask, r) => {
  const out = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!mask[y * W + x]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) out[ny * W + nx] = 1; }
  }
  return out;
};

// ---- enclosed regions: flood the pixels that are not "wall" (green outline or the coast line / any black) ----
function regions(wall) {
  const label = new Int32Array(N).fill(-1), out = [];
  for (let s = 0; s < N; s++) {
    if (wall[s] || label[s] >= 0) continue;
    const id = out.length, stack = [s]; label[s] = id; let n = 0, touches = false, sx = 0, sy = 0;
    while (stack.length) {
      const p = stack.pop(), x = p % W, y = (p / W) | 0; n++; sx += x; sy += y;
      if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touches = true;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const q = ny * W + nx; if (!wall[q] && label[q] < 0) { label[q] = id; stack.push(q); } }
    }
    out.push({ id, n, touches, cx: sx / n, cy: sy / n });
  }
  return { label, regions: out };
}
const wall = new Uint8Array(N);
{
  const g = new Uint8Array(N);
  for (let i = 0; i < N; i++) if (cls[i] === GREEN) g[i] = 1;
  const gd = dilate(g, 1);
  for (let i = 0; i < N; i++) wall[i] = gd[i] || cls[i] === BLACK || cls[i] === NAVY ? 1 : 0;
}
const { label, regions: regs } = regions(wall);
const enclosed = regs.filter((r) => !r.touches && r.n >= 250 && r.n <= 30000).sort((a, b) => b.n - a.n);
console.log('enclosed regions:', enclosed.map((r) => `#${r.id} n=${r.n} @(${r.cx.toFixed(0)},${r.cy.toFixed(0)})`).join('  '));

// ring of a labelled region, in outline px, simplified; dilated 1 px back toward the green line
function ringOf(id, tol = 1.1) {
  const grid = new Float32Array(N);
  for (let i = 0; i < N; i++) grid[i] = label[i] === id ? 1 : 0;
  const mp = contours().size([W, H]).thresholds([0.5])(grid)[0];
  let best = null, bestA = 0;
  for (const poly of mp.coordinates) { const a = Math.abs(turf.area(turf.polygon([poly[0].concat([poly[0][0]]).slice(0, poly[0].length)]))); if (a > bestA) { bestA = a; best = poly[0]; } }
  let line = turf.simplify(turf.lineString(best), { tolerance: tol, highQuality: true }).geometry.coordinates;
  if (line[0][0] === line[line.length - 1][0] && line[0][1] === line[line.length - 1][1]) line = line.slice(0, -1);
  return line;
}

// which enclosed region is which (outline-px centroid -> name)
const WANT = [
  { name: 'Borderwode (north)', kind: 'forest', at: [150, 180] },
  { name: 'Borderwode (south)', kind: 'forest', at: [140, 262] },
  { name: 'Winding Wood', kind: 'forest', at: [496, 213], pick: 'nearest' },
  { name: 'Direwode', kind: 'forest', at: [508, 130] },
  { name: 'Crow Fells', kind: 'hills', at: [295, 294] },
];
const found = {};
for (const w of WANT) {
  let id = label[w.at[1] * W + w.at[0]];
  if (w.pick === 'nearest') id = enclosed.slice().sort((a, b) => Math.hypot(a.cx - w.at[0], a.cy - w.at[1]) - Math.hypot(b.cx - w.at[0], b.cy - w.at[1]))[0].id;
  const reg = id >= 0 ? regs[id] : null;
  if (!reg || reg.touches || reg.n < 200) { console.log('NOT FOUND', w.name, reg && `n=${reg.n} touches=${reg.touches}`); continue; }
  const ring = ringOf(id);
  found[w.name] = { ...w, id, n: reg.n, ring };
  console.log(w.name, 'region', id, 'area', reg.n, 'pts', ring.length);
}

// ---- lakes: pale-blue / cyan fill (+ its outline) -> ellipse ----
function blobs(test, minN) {
  const seen = new Uint8Array(N), out = [];
  for (let s = 0; s < N; s++) {
    if (seen[s] || !test(s)) continue;
    const stack = [s]; seen[s] = 1; let n = 0, x0 = W, y0 = H, x1 = 0, y1 = 0, sx = 0, sy = 0;
    while (stack.length) {
      const p = stack.pop(), x = p % W, y = (p / W) | 0; n++; sx += x; sy += y; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const q = ny * W + nx; if (!seen[q] && test(q)) { seen[q] = 1; stack.push(q); } }
    }
    if (n >= minN) out.push({ n, cx: sx / n, cy: sy / n, x0, y0, x1, y1 });
  }
  return out.sort((a, b) => b.n - a.n);
}
const lakeBlobs = blobs((i) => cls[i] === LBLUE || cls[i] === CYAN, 20);
console.log('lake blobs (outline px):', lakeBlobs.map((b) => `n=${b.n} bbox [${b.x0},${b.y0},${b.x1},${b.y1}]`).join('  '));
const LAKES = [['Lessten Lake', [182, 163]], ['Kiergard Lake', [322, 200]], ['Fen Lake', [592, 188]]].map(([name, [px, py]]) => {
  const b = lakeBlobs.find((l) => px >= l.x0 - 4 && px <= l.x1 + 4 && py >= l.y0 - 4 && py <= l.y1 + 4);
  if (!b) { console.log('LAKE NOT FOUND', name); return null; }
  const cx = (b.x0 + b.x1 + 1) / 2, cy = (b.y0 + b.y1 + 1) / 2, rx = (b.x1 - b.x0 + 3) / 2, ry = (b.y1 - b.y0 + 3) / 2;
  const [x, y] = toPhoto([cx, cy]);
  return { name, x: +x.toFixed(1), y: +y.toFixed(1), rx: +(rx / AX).toFixed(1), ry: +(ry / AY).toFixed(1) };
}).filter(Boolean);
console.log('lakes (photo px):', JSON.stringify(LAKES));

// ---- rivers: the navy strokes. Thin to a centre line, take the longest path, simplify ----
function thin(mask) { // Zhang-Suen
  const m = Uint8Array.from(mask);
  const nb = (x, y) => [m[(y - 1) * W + x], m[(y - 1) * W + x + 1], m[y * W + x + 1], m[(y + 1) * W + x + 1], m[(y + 1) * W + x], m[(y + 1) * W + x - 1], m[y * W + x - 1], m[(y - 1) * W + x - 1]];
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of [0, 1]) {
      const kill = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        if (!m[y * W + x]) continue;
        const p = nb(x, y), B = p.reduce((a, v) => a + v, 0);
        if (B < 2 || B > 6) continue;
        let A = 0; for (let i = 0; i < 8; i++) if (!p[i] && p[(i + 1) % 8]) A++;
        if (A !== 1) continue;
        if (step === 0 ? (p[0] * p[2] * p[4] || p[2] * p[4] * p[6]) : (p[0] * p[2] * p[6] || p[0] * p[4] * p[6])) continue;
        kill.push(y * W + x);
      }
      for (const k of kill) { m[k] = 0; changed = true; }
    }
  }
  return m;
}
function longestPath(skel, from) { // BFS twice over the skeleton graph
  const bfs = (s) => {
    const dist = new Map([[s, 0]]), prev = new Map(), q = [s];
    for (let h = 0; h < q.length; h++) {
      const p = q[h], x = p % W, y = (p / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const n = ny * W + nx; if (skel[n] && !dist.has(n)) { dist.set(n, dist.get(p) + 1); prev.set(n, p); q.push(n); } }
    }
    return { dist, prev, far: q[q.length - 1] };
  };
  const a = bfs(from), b = bfs(a.far);
  const path = []; for (let p = b.far; p !== undefined; p = b.prev.get(p)) path.push([p % W, (p / W) | 0]);
  return path;
}
const navy = new Uint8Array(N); for (let i = 0; i < N; i++) navy[i] = cls[i] === NAVY ? 1 : 0;
const riverBlobs = blobs((i) => navy[i] === 1, 40);
console.log('river blobs:', riverBlobs.map((b) => `n=${b.n} bbox [${b.x0},${b.y0},${b.x1},${b.y1}]`).join('  '));
const RIVERS = [];
const wantRiver = (b) => (b.x0 > 500 && b.n > 500) || (b.x0 >= 340 && b.x0 <= 360 && b.y0 <= 155);
for (const b of riverBlobs.filter(wantRiver)) {
  const sub = new Uint8Array(N);
  for (let y = b.y0; y <= b.y1; y++) for (let x = b.x0; x <= b.x1; x++) sub[y * W + x] = navy[y * W + x];
  const sk = thin(sub);
  let start = 0; for (let i = 0; i < N; i++) if (sk[i]) { start = i; break; }
  const path = longestPath(sk, start);
  const line = turf.simplify(turf.lineString(path), { tolerance: 1.4, highQuality: true }).geometry.coordinates;
  // run it from its lake: Fen Lake feeds the Maral, Kiergard Lake feeds the upper river
  const lake = b.x0 > 500 ? [592, 189] : [323, 200];
  if (Math.hypot(line[0][0] - lake[0], line[0][1] - lake[1]) > Math.hypot(line[line.length - 1][0] - lake[0], line[line.length - 1][1] - lake[1])) line.reverse();
  if (b.x0 < 500) line.unshift([331, 198]);
  RIVERS.push({ blob: b, line, widthPx: b.n / path.length });
  console.log('river', `bbox [${b.x0},${b.y0},${b.x1},${b.y1}]`, 'path', path.length, 'pts', line.length, 'mean width', (b.n / path.length).toFixed(1));
}

// ---- symbol areas drawn by hand over the outline (outline px) ----
const AREAS = {
  'Kaldir Crown Mountains': [[322, 172], [326, 135], [345, 118], [372, 108], [400, 96], [440, 90], [485, 92], [503, 112], [500, 135], [470, 150], [430, 155], [395, 158], [372, 170], [350, 180]],
  'Three Peaks': [[612, 320], [690, 318], [692, 372], [612, 372]],
  'Wooly Swamp': [[438, 285], [455, 262], [500, 258], [560, 262], [588, 285], [592, 340], [580, 362], [520, 368], [470, 345], [440, 322]],
};
// ---- overlay for checking ----
const S = 2;
const { data: rgb } = await sharp(SRC).removeAlpha().resize(W * S, H * S).raw().toBuffer({ resolveWithObject: true });
const out = Buffer.alloc(W * S * H * S * 4);
for (let i = 0; i < W * S * H * S; i++) { out[i * 4] = rgb[i * 3]; out[i * 4 + 1] = rgb[i * 3 + 1]; out[i * 4 + 2] = rgb[i * 3 + 2]; out[i * 4 + 3] = 255; }
const dot = (x, y, c) => { for (let dx = 0; dx < 2; dx++) for (let dy = 0; dy < 2; dy++) { const px = Math.round(x * S) + dx, py = Math.round(y * S) + dy; if (px >= 0 && py >= 0 && px < W * S && py < H * S) { const o = (py * W * S + px) * 4; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; } } };
const seg = (a, b, c) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * S) + 1; for (let i = 0; i <= n; i++) dot(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, c); };
const poly = (pts, c, close = true) => { for (let i = 0; i < pts.length - (close ? 0 : 1); i++) seg(pts[i], pts[(i + 1) % pts.length], c); };
for (const f of Object.values(found)) poly(f.ring, f.kind === 'hills' ? [255, 0, 255] : [255, 100, 0]);
for (const r of RIVERS) poly(r.line, [0, 200, 0], false);
for (const a of Object.values(AREAS)) poly(a, [0, 120, 255]);
for (const b of lakeBlobs) poly([[b.x0 - 1, b.y0 - 1], [b.x1 + 2, b.y0 - 1], [b.x1 + 2, b.y1 + 2], [b.x0 - 1, b.y1 + 2]], [255, 0, 0]);
await sharp(out, { raw: { width: W * S, height: H * S, channels: 4 } }).png().toFile('_fn_extract.png');
console.log('wrote tools/_fn_extract.png');

if (WRITE) {
  const file = 'source/free-nations.json';
  if (!fs.existsSync('source/free-nations.photo-trace.json')) fs.copyFileSync(file, 'source/free-nations.photo-trace.json'); // the original hand tracing, kept
  const fn = JSON.parse(fs.readFileSync('source/free-nations.photo-trace.json', 'utf8'));
  const round = (p) => p.map((v) => +v.toFixed(1));
  for (const f of Object.values(found)) {
    const poly = f.ring.map(toPhoto).map(round);
    const old = fn.features.find((x) => x.name === f.name);
    if (old) { old.poly = poly; old.rough = 0.8; }
    else fn.features.push({ name: f.name, kind: f.kind, poly, rough: 0.8 });
  }
  for (const [name, ring] of Object.entries(AREAS)) { const old = fn.features.find((x) => x.name === name); if (old) { old.poly = ring.map(toPhoto).map(round); old.rough = name === 'Wooly Swamp' ? 6 : 3; } }
  // the forest the photo labels Direwode (it was not traced the first time)
  if (!fn.regions.some((r) => r.name === 'Direwode')) { const [x, y] = toPhoto([510, 130]); fn.regions.push({ name: 'Direwode', x: Math.round(x), y: Math.round(y), rank: 3, kind: 'forest' }); }
  for (const l of LAKES) { const old = fn.lakes.find((x) => x.name === l.name); if (old) Object.assign(old, l); else fn.lakes.push(l); }
  const named = (b) => (b.x0 > 500 ? 'Maral River' : '');
  fn.rivers = RIVERS.map((r) => {
    const pts = r.line.map(toPhoto).map(round);
    return { name: named(r.blob), pts, w: r.widthPx > 5 ? 3 : r.widthPx > 3 ? 2 : 1 };
  });
  fn._note += ' [Linework refined from the clean outline original_data/maps/free_nations_outline.jpg by tools/fn_vectorize.mjs: forest/hill loops, lakes and rivers; the first hand tracing is kept in free-nations.photo-trace.json.]';
  fs.writeFileSync(file, JSON.stringify(fn, null, 2));
  console.log('wrote', file);
}
