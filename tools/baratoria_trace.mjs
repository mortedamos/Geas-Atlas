// Trace the pencil drawing of Baratoria (original_data/maps/baratoria.png, 587x707) into outlines.
// The coast lines are the dark strokes; faint grey scribbles (shoals / ripples) are ignored. Gaps in the pencil line are closed by
// thickening the line, the enclosed land is flood-filled, then grown back out to the line.
// usage: node baratoria_trace.mjs [--write]   (without --write: prints the rings and writes _baratoria_trace.png to check)
import fs from 'node:fs';
import sharp from 'sharp';
import { contours } from 'd3-contour';
import * as turf from '@turf/turf';

const WRITE = process.argv.includes('--write');
const SRC = '../original_data/maps/baratoria.png';
const { data, info } = await sharp(SRC).flatten({ background: '#ffffff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height, N = W * H;
const wall = new Uint8Array(N);
for (let i = 0; i < N; i++) wall[i] = data[i] < 175 ? 1 : 0;
const dilate = (m, r) => {
  const out = new Uint8Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!m[y * W + x]) continue;
    for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < W && ny < H) out[ny * W + nx] = 1; }
  }
  return out;
};
const R = 10; // thick enough to close the gaps in the cays' pencil lines
const thick = dilate(wall, R);
const label = new Int32Array(N).fill(-1), regs = [];
for (let s = 0; s < N; s++) {
  if (thick[s] || label[s] >= 0) continue;
  const id = regs.length, stack = [s]; label[s] = id; let n = 0, touches = false, sx = 0, sy = 0;
  while (stack.length) {
    const p = stack.pop(), x = p % W, y = (p / W) | 0; n++; sx += x; sy += y;
    if (x === 0 || y === 0 || x === W - 1 || y === H - 1) touches = true;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue; const q = ny * W + nx; if (!thick[q] && label[q] < 0) { label[q] = id; stack.push(q); } }
  }
  regs.push({ id, n, touches, cx: Math.round(sx / n), cy: Math.round(sy / n) });
}
const enclosed = regs.filter((r) => !r.touches && r.n >= 2500).sort((a, b) => b.n - a.n);
console.log('enclosed areas:', enclosed.map((r) => `#${r.id} n=${r.n} @(${r.cx},${r.cy})`).join('  '));

const WANT = [['Walkers Cay', [350, 200]], ['South Cay', [415, 625]]];
const rings = {};
for (const [name, [x, y]] of WANT) {
  const id = label[y * W + x];
  const reg = id >= 0 ? regs[id] : null;
  if (!reg || reg.touches || reg.n < 2500) { console.log('NOT CLOSED:', name, reg && `n=${reg.n} touches=${reg.touches}`); continue; }
  const grid = new Uint8Array(N); for (let i = 0; i < N; i++) grid[i] = label[i] === id ? 1 : 0;
  const grown = dilate(grid, R - 1); // back out to the pencil line
  const g = new Float32Array(N); for (let i = 0; i < N; i++) g[i] = grown[i];
  const mp = contours().size([W, H]).thresholds([0.5])(g)[0];
  let best = null, bestA = 0;
  for (const poly of mp.coordinates) { const ring = poly[0]; const a = Math.abs(turf.area(turf.polygon([ring]))); if (a > bestA) { bestA = a; best = ring; } }
  let line = turf.simplify(turf.lineString(best), { tolerance: 1.2, highQuality: true }).geometry.coordinates;
  if (line[0][0] === line[line.length - 1][0] && line[0][1] === line[line.length - 1][1]) line = line.slice(0, -1);
  rings[name] = line.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]);
  console.log(name, 'area', reg.n, 'points', rings[name].length);
}

// Grand Isle's east coast is a broken dotted line that no amount of thickening closes without leaking into the sea, so it is
// outlined by eye (clockwise from the top-left) and each point is then pulled onto the nearest pencil stroke.
{
  const eye = [[110, 258], [128, 243], [160, 245], [185, 255], [205, 265], [225, 278], [243, 288], [252, 300], [250, 320], [262, 345], [268, 375], [262, 400], [248, 425], [228, 448], [217, 470], [217, 500], [222, 525], [240, 545], [262, 558], [290, 568], [303, 580], [312, 600], [310, 625], [302, 645], [285, 658], [255, 666], [225, 665], [195, 660], [165, 655], [140, 645], [125, 628], [110, 600], [97, 570], [93, 540], [97, 510], [108, 480], [130, 455], [148, 430], [155, 400], [152, 370], [142, 340], [125, 315], [112, 290], [107, 268]];
  const dense = [];
  for (let i = 0; i < eye.length; i++) { const a = eye[i], b = eye[(i + 1) % eye.length], n = Math.max(1, Math.round(Math.hypot(b[0] - a[0], b[1] - a[1]) / 7)); for (let k = 0; k < n; k++) dense.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]); }
  const snap = ([x, y]) => {
    let best = null, bd = 1e9;
    for (let dy = -9; dy <= 9; dy++) for (let dx = -9; dx <= 9; dx++) {
      const nx = Math.round(x) + dx, ny = Math.round(y) + dy;
      if (nx < 0 || ny < 0 || nx >= W || ny >= H || !wall[ny * W + nx]) continue;
      const d = Math.hypot(dx, dy); if (d < bd) { bd = d; best = [nx, ny]; }
    }
    return best || [x, y];
  };
  let snapped = dense.map(snap);
  // a loose average along the ring keeps the pencil wobble but removes the jumps between neighbouring strokes
  snapped = snapped.map((p, i) => { const a = snapped[(i + snapped.length - 1) % snapped.length], b = snapped[(i + 1) % snapped.length]; return [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4]; });
  rings['Grand Isle'] = snapped.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]);
  console.log('Grand Isle (by eye, snapped) points', rings['Grand Isle'].length);
}
// The Wailing Rock: a marker in open water east of Grand Isle; a small islet around it
rings['The Wailing Rock'] = Array.from({ length: 10 }, (_, k) => { const t = (k / 10) * Math.PI * 2, r = 9 + (k % 3); return [+(496 + Math.cos(t) * r).toFixed(1), +(388 + Math.sin(t) * r * 0.85).toFixed(1)]; });
// check picture
const rgb = Buffer.alloc(N * 4);
for (let i = 0; i < N; i++) { rgb[i * 4] = rgb[i * 4 + 1] = rgb[i * 4 + 2] = data[i]; rgb[i * 4 + 3] = 255; }
const dot = (x, y, c) => { const px = Math.round(x), py = Math.round(y); if (px >= 0 && py >= 0 && px < W && py < H) { const o = (py * W + px) * 4; rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2]; } };
for (const ring of Object.values(rings)) for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])) + 1; for (let k = 0; k <= n; k++) { dot(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, [255, 0, 0]); dot(a[0] + ((b[0] - a[0]) * k) / n + 1, a[1] + ((b[1] - a[1]) * k) / n, [255, 0, 0]); } }
await sharp(rgb, { raw: { width: W, height: H, channels: 4 } }).png().toFile('_baratoria_trace.png');
console.log('wrote tools/_baratoria_trace.png');

if (WRITE) fs.writeFileSync('source/baratoria_rings.json', JSON.stringify({ _note: 'Outlines traced from original_data/maps/baratoria.png (pixel coordinates, y down) by tools/baratoria_trace.mjs.', size: [W, H], rings }, null, 1));
