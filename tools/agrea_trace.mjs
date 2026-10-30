// The full Agrea map (original_data/maps/agrea_full.png, 665x620) replaces the part-map the island was built from
// (agrea.jpg, 684x425, a zoomed-in crop of the same picture). This script
//  1. segments land from sea by colour in both pictures and registers the old crop onto the new picture
//     (so the terrain / places already placed in old-picture px can be carried over),
//  2. traces the main island's coast and the islets in the full picture.
// usage: node agrea_trace.mjs [--write]   (writes source/agrea_full.json with --write; always writes _agrea_trace.png for checking)
import fs from 'node:fs';
import sharp from 'sharp';
import { contours } from 'd3-contour';
import * as turf from '@turf/turf';

const WRITE = process.argv.includes('--write');
async function load(file) {
  const { data, info } = await sharp(file).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, W: info.width, H: info.height };
}
// land = sand (red well above blue) or jungle green (green well above red and blue); sea and its pale shallows are teal (g ~ b)
function landMask({ data, W, H }) {
  const m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
    m[i] = (r - b > 32 && r > 120) || (g > r + 22 && g > b + 28) ? 1 : 0;
  }
  return m;
}
function smooth(m, W, H, r, th) { // majority filter
  const out = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0, n = 0;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; s += m[ny * W + nx]; n++; }
    out[y * W + x] = s / n >= th ? 1 : 0;
  }
  return out;
}
function components(m, W, H, minN) {
  const label = new Int32Array(W * H).fill(-1), out = [];
  for (let s = 0; s < W * H; s++) {
    if (!m[s] || label[s] >= 0) continue;
    const id = out.length, stack = [s]; label[s] = id; let n = 0, sx = 0, sy = 0;
    while (stack.length) {
      const p = stack.pop(), x = p % W, y = (p / W) | 0; n++; sx += x; sy += y;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const q = ny * W + nx; if (m[q] && label[q] < 0) { label[q] = id; stack.push(q); } }
    }
    out.push({ id, n, cx: sx / n, cy: sy / n });
  }
  return { label, comps: out.filter((c) => c.n >= minN) };
}

const NEW = await load('../original_data/maps/agrea_full.png');
const OLD = await load('../original_data/maps/agrea.jpg');
let mNew = smooth(landMask(NEW), NEW.W, NEW.H, 2, 0.5), mOld = smooth(landMask(OLD), OLD.W, OLD.H, 2, 0.5);
// the "Agrea" title and ships are white/grey: they fall outside both land rules, so only holes inside the island matter
{
  const inv = mNew.map((v) => 1 - v);
  const { label, comps } = components(inv, NEW.W, NEW.H, 1);
  const big = new Set(comps.filter((c) => c.n > 400).map((c) => c.id));
  for (let i = 0; i < mNew.length; i++) if (!mNew[i] && !big.has(label[i])) mNew[i] = 1; // fill small holes (labels, ships' shadows)
}
{
  const { comps } = components(mNew, NEW.W, NEW.H, 150);
  console.log('land pieces in the full map:', comps.map((c) => `n=${c.n} @(${c.cx.toFixed(0)},${c.cy.toFixed(0)})`).join('  '));
}

// ---- register the old crop onto the full picture: new = s * old + t ----
const samples = [];
for (let y = 6; y < OLD.H; y += 5) for (let x = 6; x < OLD.W; x += 5) samples.push([x, y, mOld[y * OLD.W + x]]);
const score = (s, tx, ty) => {
  let ok = 0, n = 0;
  for (const [x, y, v] of samples) {
    const u = Math.round(s * x + tx), w = Math.round(s * y + ty);
    if (u < 0 || w < 0 || u >= NEW.W || w >= NEW.H) continue;
    n++; if (mNew[w * NEW.W + u] === v) ok++;
  }
  return n < samples.length * 0.5 ? 0 : ok / n;
};
let best = { sc: 0 };
for (let s = 0.6; s <= 0.95; s += 0.01) for (let tx = 100; tx <= 420; tx += 4) for (let ty = 100; ty <= 420; ty += 4) { const sc = score(s, tx, ty); if (sc > best.sc) best = { sc, s, tx, ty }; }
for (const [ds, dt] of [[0.004, 1.5], [0.0015, 0.5]]) {
  const c = { ...best };
  for (let s = c.s - 4 * ds; s <= c.s + 4 * ds + 1e-9; s += ds) for (let tx = c.tx - 6 * dt; tx <= c.tx + 6 * dt + 1e-9; tx += dt) for (let ty = c.ty - 6 * dt; ty <= c.ty + 6 * dt + 1e-9; ty += dt) { const sc = score(s, tx, ty); if (sc > best.sc) best = { sc, s, tx, ty }; }
}
console.log(`old crop -> full map: new = ${best.s.toFixed(4)} * old + (${best.tx.toFixed(1)}, ${best.ty.toFixed(1)}), agreement ${best.sc.toFixed(3)}`);

// ---- trace coasts of the full map ----
const { label, comps } = components(mNew, NEW.W, NEW.H, 20);
const traced = [];
for (const c of comps.sort((a, b) => b.n - a.n)) {
  const g = new Float32Array(NEW.W * NEW.H); for (let i = 0; i < g.length; i++) g[i] = label[i] === c.id ? 1 : 0;
  const mp = contours().size([NEW.W, NEW.H]).thresholds([0.5])(g)[0];
  let ring = null, a0 = 0;
  for (const poly of mp.coordinates) { const a = Math.abs(turf.area(turf.polygon([poly[0]]))); if (a > a0) { a0 = a; ring = poly[0]; } }
  let line = turf.simplify(turf.lineString(ring), { tolerance: c.n > 5000 ? 1.4 : 0.8, highQuality: true }).geometry.coordinates;
  if (line[0][0] === line[line.length - 1][0] && line[0][1] === line[line.length - 1][1]) line = line.slice(0, -1);
  if (traced.length && turf.booleanPointInPolygon([c.cx, c.cy], turf.polygon([[...traced[0].ring, traced[0].ring[0]]]))) continue; // dark rock inside the island, not a separate piece
  traced.push({ n: c.n, cx: +c.cx.toFixed(0), cy: +c.cy.toFixed(0), ring: line.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]) });
  console.log('piece', traced.length - 1, 'area', c.n, 'centre', c.cx.toFixed(0), c.cy.toFixed(0), 'points', line.length);
}

// ---- check picture ----
const out = Buffer.alloc(NEW.W * NEW.H * 4);
for (let i = 0; i < NEW.W * NEW.H; i++) { out[i * 4] = NEW.data[i * 3]; out[i * 4 + 1] = NEW.data[i * 3 + 1]; out[i * 4 + 2] = NEW.data[i * 3 + 2]; out[i * 4 + 3] = 255; }
const dot = (x, y, c) => { for (let k = 0; k < 2; k++) { const px = Math.round(x) + k, py = Math.round(y); if (px >= 0 && py >= 0 && px < NEW.W && py < NEW.H) { const o = (py * NEW.W + px) * 4; out[o] = c[0]; out[o + 1] = c[1]; out[o + 2] = c[2]; } } };
const seg = (a, b, c) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])) + 1; for (let i = 0; i <= n; i++) dot(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, c); };
for (const t of traced) for (let i = 0; i < t.ring.length; i++) seg(t.ring[i], t.ring[(i + 1) % t.ring.length], [255, 0, 0]);
{ // outline of where the old crop sits
  const c = [[0, 0], [OLD.W, 0], [OLD.W, OLD.H], [0, OLD.H]].map(([x, y]) => [best.s * x + best.tx, best.s * y + best.ty]);
  for (let i = 0; i < 4; i++) seg(c[i], c[(i + 1) % 4], [255, 255, 0]);
}
await sharp(out, { raw: { width: NEW.W, height: NEW.H, channels: 4 } }).png().toFile('_agrea_trace.png');
console.log('wrote tools/_agrea_trace.png');

if (WRITE) fs.writeFileSync('source/agrea_full.json', JSON.stringify({ _note: 'Traced from original_data/maps/agrea_full.png (665x620) by tools/agrea_trace.mjs. rings = land pieces, biggest first (image px, y down). oldToNew registers the old part-map agrea.jpg onto this picture: new = s * old + t.', size: [NEW.W, NEW.H], oldToNew: { s: +best.s.toFixed(4), tx: +best.tx.toFixed(1), ty: +best.ty.toFixed(1), agreement: +best.sc.toFixed(3) }, pieces: traced }, null, 1));
