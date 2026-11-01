// Peregrine's Table from the author's hex-tile map (original_data/maps/peregrine_hex.webp, 653x605).
// Each hex is a flat colour, so the map is read by colour: sea (navy), sand (tan), jungle (dark and mid green), light woodland (lime),
// highland (pale green and olive), dunes (peach), marsh (teal). Black tree and mountain glyphs and the lettering take the nearest colour;
// the blue river lines are lifted out separately, thinned to a centre line and traced.
// usage: node peregrine_trace.mjs [--write]   (without --write it only draws _peregrine_trace.png to check)
import fs from 'node:fs';
import sharp from 'sharp';
import { contours } from 'd3-contour';
import * as turf from '@turf/turf';

const WRITE = process.argv.includes('--write');
const { data, info } = await sharp('../original_data/maps/peregrine_hex.webp').removeAlpha().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, N = W * H;
const CLASSES = ['sea', 'tan', 'dark', 'mid', 'lime', 'pale', 'peach', 'teal', 'olive'];
const PROTO = [[76, 74, 124], [160, 144, 120], [52, 119, 86], [86, 152, 70], [136, 168, 88], [200, 208, 155], [208, 184, 142], [48, 100, 100], [104, 148, 88]];
const isRiver = (r, g, b) => b > g + 8 && b > r + 45 && g > 88 && b > 110;
const lab = new Int8Array(N).fill(-1), river = new Uint8Array(N);
for (let i = 0; i < N; i++) {
  const r = data[i * 3], g = data[i * 3 + 1], b = data[i * 3 + 2];
  if (isRiver(r, g, b)) { river[i] = 1; continue; }
  let best = -1, bd = 42 * 42;
  PROTO.forEach((p, k) => { const d = (r - p[0]) ** 2 + (g - p[1]) ** 2 + (b - p[2]) ** 2; if (d < bd) { bd = d; best = k; } });
  lab[i] = best;
}
// the unknown (glyphs, lettering, river lines) takes the nearest known colour
const queue = [];
for (let i = 0; i < N; i++) if (lab[i] >= 0) queue.push(i);
for (let h = 0; h < queue.length; h++) {
  const i = queue[h], x = i % W, y = (i / W) | 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const j = ny * W + nx; if (lab[j] < 0) { lab[j] = lab[i]; queue.push(j); } }
}
// majority filter, twice, to clean up the edges
let cls = Int8Array.from(lab);
for (let pass = 0; pass < 4; pass++) {
  const out = Int8Array.from(cls);
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const cnt = new Uint8Array(CLASSES.length);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) cnt[cls[(y + dy) * W + x + dx]]++;
    let bk = cls[y * W + x]; for (let k = 0; k < cnt.length; k++) if (cnt[k] > cnt[bk]) bk = k;
    out[y * W + x] = bk;
  }
  cls = out;
}
const area = (r) => Math.abs(r.reduce((s, p, i) => { const q = r[(i + 1) % r.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0)) / 2; // planar area in picture px (turf.area would read these as degrees)
const maskOf = (test) => { const m = new Float32Array(N); for (let i = 0; i < N; i++) m[i] = test(cls[i]) ? 1 : 0; return m; };
const ringsOf = (m, minArea, tol) => {
  const mp = contours().size([W, H]).thresholds([0.5])(m)[0], out = [];
  for (const poly of mp.coordinates) {
    const ring = poly[0], a = area(ring);
    if (a < minArea) continue;
    let line = turf.simplify(turf.lineString(ring), { tolerance: tol, highQuality: true }).geometry.coordinates;
    if (line[0][0] === line[line.length - 1][0] && line[0][1] === line[line.length - 1][1]) line = line.slice(0, -1);
    out.push({ a, pts: line.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]) });
  }
  return out.sort((p, q) => q.a - p.a);
};
const land = ringsOf(maskOf((c) => c !== 0), 300, 1.3);
console.log('land rings', land.map((r) => `${r.pts.length} pts`).join(', '));

// terrain: one polygon per patch of hexes of the same kind
const KIND = { forest: ['dark', 'mid'], newgrowth: ['lime'], hills: ['pale', 'olive'], desert: ['peach'], marsh: ['teal'] };
const NAME = { forest: 'Table jungle', newgrowth: 'Table scrub', hills: 'Table highland', desert: 'Table dunes', marsh: 'Table marsh' };
const features = [];
for (const [kind, names] of Object.entries(KIND)) {
  const ids = names.map((n) => CLASSES.indexOf(n));
  ringsOf(maskOf((c) => ids.includes(c)), kind === 'desert' ? 250 : kind === 'forest' ? 900 : 500, 1.4).forEach((r, i) => features.push({ name: `${NAME[kind]} ${i + 1}`, kind, poly: r.pts }));
}
// the four mountain glyphs on the highland hexes
const octagon = (cx, cy, r) => Array.from({ length: 9 }, (_, k) => [+(cx + Math.cos((k / 9) * 6.2832) * r * (0.9 + 0.2 * ((k * 7) % 3) / 2)).toFixed(1), +(cy + Math.sin((k / 9) * 6.2832) * r * 0.8).toFixed(1)]);
const MOUNTAINS = [[215, 262], [239, 270], [214, 302], [430, 252]];
MOUNTAINS.forEach(([x, y], i) => features.push({ name: `Table peak ${i + 1}`, kind: 'mountain', poly: octagon(x, y, 17) }));
console.log('terrain areas', features.length);

// rivers: closed up, thinned to one pixel, traced between junctions and ends
const R = new Uint8Array(N);
for (let i = 0; i < N; i++) R[i] = river[i] && cls[i] !== 0 ? 1 : 0;
const dil = (m, r) => { const o = new Uint8Array(N); for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (m[y * W + x]) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) o[ny * W + nx] = 1; } return o; };
const thick = dil(R, 2);
function thin(mask) {
  const q = Uint8Array.from(mask), at = (x, y) => q[y * W + x];
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of [0, 1]) {
      const kill = [];
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        if (!at(x, y)) continue;
        const p = [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)];
        const Bn = p.reduce((a, v) => a + v, 0); if (Bn < 2 || Bn > 6) continue;
        let A = 0; for (let i = 0; i < 8; i++) if (!p[i] && p[(i + 1) % 8]) A++; if (A !== 1) continue;
        if (step === 0 ? (p[0] * p[2] * p[4] || p[2] * p[4] * p[6]) : (p[0] * p[2] * p[6] || p[0] * p[4] * p[6])) continue;
        kill.push(y * W + x);
      }
      for (const k of kill) { q[k] = 0; changed = true; }
    }
  }
  return q;
}
const sk = thin(thick);
const nb = (k) => { const x = k % W, y = (k / W) | 0, o = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H && sk[ny * W + nx]) o.push(ny * W + nx); } return o; };
const nodes = new Set(); for (let k = 0; k < N; k++) if (sk[k] && nb(k).length !== 2) nodes.add(k);
const seen = new Set(), rivers = [];
for (const s of nodes) for (const first of nb(s)) {
  const ek = `${Math.min(s, first)}-${Math.max(s, first)}`; if (seen.has(ek)) continue;
  const path = [s, first]; seen.add(ek); let prev = s, cur = first;
  while (!nodes.has(cur)) { const nxt = nb(cur).filter((k) => k !== prev); if (!nxt.length) break; prev = cur; cur = nxt[0]; path.push(cur); }
  seen.add(`${Math.min(path[path.length - 2], cur)}-${Math.max(path[path.length - 2], cur)}`);
  if (path.length < 22) continue;
  const line = turf.simplify(turf.lineString(path.map((k) => [k % W, (k / W) | 0])), { tolerance: 1.8, highQuality: true }).geometry.coordinates;
  rivers.push({ name: '', pts: line.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]) });
}
console.log('rivers', rivers.length);

// picture to check
const rgb = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) { rgb[i * 4] = data[i * 3]; rgb[i * 4 + 1] = data[i * 3 + 1]; rgb[i * 4 + 2] = data[i * 3 + 2]; rgb[i * 4 + 3] = 255; }
const dot = (x, y, c) => { const px = Math.round(x), py = Math.round(y); if (px >= 0 && py >= 0 && px < W && py < H) { const o = (py * W + px) * 4; rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2]; } };
const draw = (pts, c, closed) => { for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) { const a = pts[i], b = pts[(i + 1) % pts.length], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])) + 1; for (let k = 0; k <= n; k++) dot(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, c); } };
for (const r of land) draw(r.pts, [255, 40, 40], true);
for (const f of features) draw(f.poly, f.kind === 'mountain' ? [255, 255, 255] : [255, 230, 0], true);
for (const r of rivers) draw(r.pts, [255, 0, 255], false);
await sharp(rgb, { raw: { width: W, height: H, channels: 4 } }).png().toFile('_peregrine_trace.png');
console.log('wrote tools/_peregrine_trace.png');

if (WRITE) {
  const F = 'source/islands.json', cfg = JSON.parse(fs.readFileSync(F, 'utf8')), old = cfg.islands.find((i) => i.id === 'isle');
  const oldW = (Math.max(...old.coast.map((p) => p[0])) - Math.min(...old.coast.map((p) => p[0]))) * cfg.refScale * old.sizeRatio; // keep the island's footprint, so the chain of western islands does not shift
  const main = land[0].pts, xs = main.map((p) => p[0]), bw = Math.max(...xs) - Math.min(...xs);
  const entry = {
    ...old, title: "Peregrine's Table", map: 'peregrine_hex.webp (hex-tile map)', sizeRatio: +(oldW / (bw * cfg.refScale)).toFixed(5),
    coast: main, islets: land.slice(1).map((r) => r.pts), lakes: [], rivers, features,
    places: [
      { name: 'The Table', x: 222, y: 286, kind: 'temple', rank: 3, note: "A flat rock set atop two others, like a table: a Sahuagin altar to Shokath, the shark god. It stands on the western hill, 'the flat place' where, the sea-birds say, others bring their prey." },
      { name: 'Boar Cave', x: 432, y: 266, kind: 'ruin', rank: 3, note: "On the eastern hill, toward the rising sun: the lair of two giant dire boars, the 'king and queen' of the sea-birds' tale. A small hidden chamber holds clay jars of old coin (Selladorian, elven, dwarven and Atman) and a worn painting of islands, one above the rest hurling lightning." },
    ],
    regions: [], wobble: 0, bandScale: 0.08,
    _note: "Redrawn from the author's hex-tile map original_data/maps/peregrine_hex.webp (tools/peregrine_trace.mjs): the coast, the jungle, scrub, highland, dunes and marsh hexes, the four mountain glyphs, the rivers (the blue lines on the hex borders) and the two sand islets to the north-east. sizeRatio keeps the island the width the old invented outline had, so the western island chain stays where it was.",
  };
  cfg.islands[cfg.islands.findIndex((i) => i.id === 'isle')] = entry;
  fs.writeFileSync(F, JSON.stringify(cfg, null, 1));
  console.log('wrote the isle into', F, 'sizeRatio', entry.sizeRatio);
}
