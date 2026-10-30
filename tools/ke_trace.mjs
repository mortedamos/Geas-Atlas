// Trace the two coast lines of the hand-drawn map of eastern Kharse / the Valley of Ertrugol / western Boddendell
// (original_data/maps/kharse_ertrugol.jpg, 1648x2000) with a "live wire": the pencil line is followed between waypoints that are
// given by eye, so the path hugs the actual stroke. Writes source/kharse_ertrugol.json (coasts, land polygon, paper quad)
// and _ke_trace.png to check.
// usage: node ke_trace.mjs [--write]
import fs from 'node:fs';
import sharp from 'sharp';

const SRC = '../original_data/maps/kharse_ertrugol.jpg';
const { data, info } = await sharp(SRC).greyscale().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
const cost = (i) => 1 + Math.max(0, data[i] - 120) / 5;

// waypoints by eye (drawing px), west to east
const NORTH = [[110, 176], [210, 232], [340, 272], [430, 330], [570, 392], [645, 448], [690, 400], [705, 330], [745, 260], [800, 225], [850, 255], [880, 330], [930, 355], [990, 325], [1040, 262], [1100, 200], [1160, 130], [1210, 70], [1255, 28], [1290, 60], [1310, 120], [1345, 172], [1390, 196], [1430, 235], [1470, 270], [1520, 265], [1600, 275]];
const SOUTH = [[156, 1390], [190, 1356], [250, 1300], [300, 1250], [330, 1220], [400, 1220], [460, 1250], [510, 1310], [570, 1350], [620, 1410], [680, 1430], [770, 1420], [830, 1390], [900, 1396], [940, 1430], [1000, 1496], [1030, 1536], [1110, 1580], [1180, 1640], [1220, 1730], [1260, 1790], [1280, 1860], [1276, 1940], [1280, 1995]];

function snap([x, y], r = 22) {
  let best = [x, y], bd = 1e9;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const nx = x + dx, ny = y + dy; if (nx < 2 || ny < 2 || nx >= W - 2 || ny >= H - 2) continue;
    const g = data[ny * W + nx]; if (g > 185) continue;
    const d = Math.hypot(dx, dy) + (g - 100) / 30; if (d < bd) { bd = d; best = [nx, ny]; }
  }
  return best;
}
class Heap { constructor() { this.a = []; } push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } } pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { let l = 2 * i + 1, r = l + 1, m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; } get size() { return this.a.length; } }
function wire(a, b, pad = 50) {
  const x0 = Math.max(2, Math.min(a[0], b[0]) - pad), x1 = Math.min(W - 3, Math.max(a[0], b[0]) + pad), y0 = Math.max(2, Math.min(a[1], b[1]) - pad), y1 = Math.min(H - 3, Math.max(a[1], b[1]) + pad);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, dist = new Float64Array(bw * bh).fill(Infinity), prev = new Int32Array(bw * bh).fill(-1);
  const idx = (x, y) => (y - y0) * bw + (x - x0), heap = new Heap(), s = idx(a[0], a[1]), t = idx(b[0], b[1]);
  dist[s] = 0; heap.push(0, s);
  while (heap.size) {
    const [d, u] = heap.pop(); if (d > dist[u]) continue; if (u === t) break;
    const ux = (u % bw) + x0, uy = ((u / bw) | 0) + y0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue; const nx = ux + dx, ny = uy + dy; if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue;
      const v = idx(nx, ny), nd = d + cost(ny * W + nx) * (dx && dy ? 1.414 : 1);
      if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heap.push(nd, v); }
    }
  }
  const path = []; for (let u = t; u !== -1; u = prev[u]) path.push([(u % bw) + x0, ((u / bw) | 0) + y0]);
  return path.reverse();
}
function trace(way) {
  const pts = way.map((p, i) => (i === 0 || i === way.length - 1 ? snap(p, 30) : snap(p)));
  let out = [];
  for (let i = 0; i + 1 < pts.length; i++) { const seg = wire(pts[i], pts[i + 1]); out = out.concat(i ? seg.slice(1) : seg); }
  return out;
}
// thin the pixel path to a polyline: keep a point every ~14 px, lightly averaged
function thin(path, step = 14) {
  const out = [path[0]]; let acc = 0;
  for (let i = 1; i < path.length; i++) { acc += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); if (acc >= step) { out.push(path[i]); acc = 0; } }
  out.push(path[path.length - 1]);
  return out.map((p, i) => { const a = out[Math.max(0, i - 1)], b = out[Math.min(out.length - 1, i + 1)]; return i === 0 || i === out.length - 1 ? p : [(a[0] + 2 * p[0] + b[0]) / 4, (a[1] + 2 * p[1] + b[1]) / 4]; }).map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]);
}
const north = thin(trace(NORTH)), south = thin(trace(SOUTH));
console.log('north', north.length, 'pts; south', south.length, 'pts');

// overlay
const rgb = Buffer.alloc(W * H * 3);
for (let i = 0; i < W * H; i++) rgb[i * 3] = rgb[i * 3 + 1] = rgb[i * 3 + 2] = data[i];
const dot = (x, y, c) => { for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const px = Math.round(x) + dx, py = Math.round(y) + dy; if (px >= 0 && py >= 0 && px < W && py < H) { const o = (py * W + px) * 3; rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2]; } } };
for (const [line, c] of [[north, [255, 0, 0]], [south, [0, 120, 255]]]) for (let i = 0; i + 1 < line.length; i++) { const a = line[i], b = line[i + 1], n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])) + 1; for (let k = 0; k <= n; k++) dot(a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n, c); }
await sharp(rgb, { raw: { width: W, height: H, channels: 3 } }).resize(824).png().toFile('_ke_trace.png');
if (process.argv.includes('--write')) {
  // land = between the coasts; the picture's edges are not coast, so close the polygon well outside the paper
  const land = [[-400, north[0][1] - 40], ...north, [north[north.length - 1][0] + 400, north[north.length - 1][1]], [south[south.length - 1][0] + 400, south[south.length - 1][1] + 100], ...south.slice().reverse(), [-400, south[0][1] + 10]];
  fs.writeFileSync('source/kharse_ertrugol.json', JSON.stringify({ _note: 'Hand-drawn map of eastern Kharse, the Valley of Ertrugol and western Boddendell (original_data/maps/kharse_ertrugol.jpg, 1648x2000). Coordinates are picture pixels, y down. north = the Inner Sea shore, south = the south-west coast; land is the area between them, extended past the paper edges. Traced by tools/ke_trace.mjs.', map: 'kharse_ertrugol.jpg', size: [W, H], north, south, land, paper: [[520, 20], [W - 20, 20], [W - 20, H - 20], [520, H - 20]], raster: { x0: -400, y0: -100, w: 2450, h: 2200, cell: 2 } }, null, 1));
  console.log('wrote source/kharse_ertrugol.json');
}
