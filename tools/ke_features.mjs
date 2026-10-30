// Terrain areas, lakes, river, places and labels of the Kharse / Ertrugol / Boddendell drawing, outlined by eye over the picture
// (drawing px, y down). The river is followed along the pencil line with the same live wire as the coasts (ke_trace.mjs).
// usage: node ke_features.mjs [--write]   writes _ke_features.png to check, and source/kharse_ertrugol.json with --write
import fs from 'node:fs';
import sharp from 'sharp';

const F = 'source/kharse_ertrugol.json';
const def = JSON.parse(fs.readFileSync(F, 'utf8'));
const SRC = '../original_data/maps/kharse_ertrugol.jpg';
const { data, info } = await sharp(SRC).greyscale().raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;

const features = [
  // Kharse: the desert runs from the north coast to the south coast and ends where the mountains begin (their west foot is its east edge)
  { name: 'Kharse Desert', kind: 'desert', mode: '', poly: [[578, 60], [650, 60], [650, 300], [648, 395], [635, 470], [620, 560], [610, 640], [560, 730], [590, 820], [640, 880], [690, 925], [735, 935], [780, 1005], [825, 1085], [865, 1160], [905, 1230], [880, 1300], [815, 1360], [850, 1395], [850, 1500], [610, 1500], [540, 1420], [575, 1330], [510, 1240], [560, 1150], [500, 1060], [545, 970], [490, 880], [540, 800], [505, 720], [560, 660], [578, 600]] },
  // peaks: the long western range (Kharse's mountains), the small groups north of the valley, the eastern peaks
  { name: 'Kharse Mountains', kind: 'mountain', poly: [[650, 300], [760, 262], [840, 300], [880, 380], [872, 470], [830, 560], [850, 640], [890, 730], [950, 820], [1020, 890], [1050, 960], [1050, 1060], [1090, 1170], [1060, 1260], [1050, 1350], [1010, 1420], [945, 1385], [850, 1395], [815, 1360], [880, 1300], [905, 1230], [865, 1160], [825, 1085], [780, 1005], [735, 935], [690, 925], [640, 880], [590, 820], [560, 730], [610, 640], [620, 560], [635, 470], [648, 395]] },
  { name: 'Northern Peaks', kind: 'mountain', poly: [[960, 320], [1100, 305], [1175, 390], [1135, 455], [985, 445]] },
  { name: 'Ertrugol Peaks (north-east)', kind: 'mountain', poly: [[1180, 600], [1290, 530], [1420, 560], [1470, 650], [1400, 720], [1300, 730], [1220, 680]] },
  { name: 'Eastern Peaks', kind: 'mountain', poly: [[1300, 760], [1420, 745], [1530, 790], [1640, 850], [1648, 1010], [1560, 1020], [1440, 1000], [1350, 960], [1310, 880]] },
  { name: 'Southern Peaks', kind: 'mountain', poly: [[1230, 1010], [1290, 1000], [1320, 1100], [1250, 1120]] },
  // hills (the little arcs)
  { name: 'Ertrugol Hills (north)', kind: 'hills', poly: [[950, 450], [1100, 440], [1200, 490], [1180, 560], [1070, 570], [960, 530]] },
  { name: 'Ertrugol Hills (west)', kind: 'hills', poly: [[740, 590], [880, 585], [1010, 640], [1050, 720], [1000, 800], [850, 780], [780, 720]] },
  { name: 'Ertrugol Hills (centre)', kind: 'hills', poly: [[1080, 640], [1180, 700], [1240, 760], [1230, 830], [1120, 840], [1050, 780]] },
  { name: 'Wild Lands', kind: 'hills', poly: [[1040, 1180], [1250, 1190], [1500, 1260], [1520, 1340], [1300, 1350], [1120, 1370], [1030, 1330]] },
  { name: 'Wild Lands (south)', kind: 'hills', poly: [[1240, 1465], [1540, 1465], [1540, 1525], [1240, 1525]] },
  { name: 'Artaios Hills', kind: 'hills', poly: [[1360, 1680], [1600, 1690], [1640, 1800], [1560, 1960], [1480, 1990], [1400, 1820]] },
  // the dark hatching: woodland / marsh country
  { name: 'Boddendell Woods', kind: 'forest', poly: [[1260, 148], [1300, 190], [1330, 260], [1390, 380], [1470, 390], [1540, 430], [1535, 525], [1450, 540], [1330, 520], [1230, 505], [1170, 480], [1130, 380], [1125, 300], [1190, 200]] },
  { name: 'Ertrugol Marsh', kind: 'marsh', poly: [[870, 640], [930, 570], [1000, 570], [1060, 630], [1100, 700], [1140, 780], [1120, 800], [1040, 780], [980, 760], [900, 740], [850, 690]] },
  { name: 'Ertrugol Fens', kind: 'marsh', poly: [[1010, 950], [1100, 900], [1190, 880], [1265, 910], [1255, 970], [1150, 990], [1060, 1030], [1010, 1000]] },
  { name: 'Ertrugol Woods', kind: 'forest', poly: [[1050, 1070], [1100, 1020], [1200, 1005], [1235, 1050], [1262, 1115], [1230, 1150], [1140, 1145], [1060, 1120]] },
  { name: 'Boddendell Thicket', kind: 'forest', poly: [[1500, 620], [1595, 610], [1605, 745], [1510, 745]] },
  { name: 'Small copse', kind: 'forest', poly: [[1380, 1100], [1470, 1100], [1470, 1160], [1380, 1160]] },
];
const lakes = [
  { name: 'Ertrugol Lake (north)', x: 1027, y: 568, rx: 29, ry: 42 },
  { name: 'Boddendell Lake', x: 1315, y: 658, rx: 58, ry: 33 },
  { name: 'Ertrugol Lake (south)', x: 950, y: 965, rx: 48, ry: 40 },
];
const places = [{ name: "Gherlan's Workshop", x: 678, y: 828, kind: 'tower', rank: 3, note: "Gherlan's workshop: the mad inventor and recluse works alone in the Kharse mountains, on the edge of the desert." }];
const regions = [
  { name: 'Wild Lands', x: 1210, y: 1390, rank: 2, kind: 'region' },
];
// the river: from the southern lake, round the valley, up through the north-eastern lake to the hills of Boddendell
const RIVER = [[990, 1000], [1030, 1008], [1115, 972], [1200, 975], [1250, 955], [1280, 920], [1275, 870], [1285, 810], [1295, 750], [1300, 700], [1255, 625], [1230, 610], [1200, 550], [1170, 500]];

// --- live wire (same idea as ke_trace.mjs) ---
const cost = (i) => 1 + Math.max(0, data[i] - 120) / 5;
function snap([x, y], r = 18) {
  let best = [x, y], bd = 1e9;
  for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) { const nx = x + dx, ny = y + dy; if (nx < 2 || ny < 2 || nx >= W - 2 || ny >= H - 2) continue; const g = data[ny * W + nx]; if (g > 190) continue; const d = Math.hypot(dx, dy) + (g - 100) / 30; if (d < bd) { bd = d; best = [nx, ny]; } }
  return best;
}
class Heap { constructor() { this.a = []; } push(k, v) { const a = this.a; a.push([k, v]); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p][0] <= a[i][0]) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } } pop() { const a = this.a, top = a[0], last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l][0] < a[m][0]) m = l; if (r < a.length && a[r][0] < a[m][0]) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; } get size() { return this.a.length; } }
function wire(a, b, pad = 40) {
  const x0 = Math.max(2, Math.min(a[0], b[0]) - pad), x1 = Math.min(W - 3, Math.max(a[0], b[0]) + pad), y0 = Math.max(2, Math.min(a[1], b[1]) - pad), y1 = Math.min(H - 3, Math.max(a[1], b[1]) + pad);
  const bw = x1 - x0 + 1, bh = y1 - y0 + 1, dist = new Float64Array(bw * bh).fill(Infinity), prev = new Int32Array(bw * bh).fill(-1);
  const idx = (x, y) => (y - y0) * bw + (x - x0), heap = new Heap(), s = idx(a[0], a[1]), t = idx(b[0], b[1]);
  dist[s] = 0; heap.push(0, s);
  while (heap.size) {
    const [d, u] = heap.pop(); if (d > dist[u]) continue; if (u === t) break;
    const ux = (u % bw) + x0, uy = ((u / bw) | 0) + y0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const nx = ux + dx, ny = uy + dy; if (nx < x0 || nx > x1 || ny < y0 || ny > y1) continue; const v = idx(nx, ny), nd = d + cost(ny * W + nx) * (dx && dy ? 1.414 : 1); if (nd < dist[v]) { dist[v] = nd; prev[v] = u; heap.push(nd, v); } }
  }
  const path = []; for (let u = t; u !== -1; u = prev[u]) path.push([(u % bw) + x0, ((u / bw) | 0) + y0]);
  return path.reverse();
}
const pts = RIVER.map((p) => snap(p));
let path = [];
for (let i = 0; i + 1 < pts.length; i++) { const seg = wire(pts[i], pts[i + 1]); path = path.concat(i ? seg.slice(1) : seg); }
const thinned = [path[0]]; let acc = 0;
for (let i = 1; i < path.length; i++) { acc += Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]); if (acc >= 16) { thinned.push(path[i]); acc = 0; } }
thinned.push(path[path.length - 1]);
const river = thinned.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]);
console.log('river points', river.length);

// --- check picture ---
const S = 0.5, w = Math.round(W * S), h = Math.round(H * S);
const rgb = Buffer.alloc(w * h * 3);
for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const g = data[Math.floor(y / S) * W + Math.floor(x / S)]; for (let c = 0; c < 3; c++) rgb[(y * w + x) * 3 + c] = g; }
const dot = (x, y, c) => { const px = Math.round(x * S), py = Math.round(y * S); if (px >= 0 && py >= 0 && px < w && py < h) { const o = (py * w + px) * 3; rgb[o] = c[0]; rgb[o + 1] = c[1]; rgb[o + 2] = c[2]; } };
const seg = (a, b, c) => { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) * S) + 1; for (let i = 0; i <= n; i++) dot(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, c); };
const COL = { mountain: [220, 0, 0], hills: [220, 120, 0], forest: [0, 150, 0], marsh: [0, 150, 150], desert: [200, 160, 0] };
for (const f of features) for (let i = 0; i < f.poly.length; i++) seg(f.poly[i], f.poly[(i + 1) % f.poly.length], COL[f.kind]);
for (let i = 0; i + 1 < river.length; i++) seg(river[i], river[i + 1], [0, 0, 255]);
for (const l of lakes) for (let k = 0; k < 40; k++) { const a = (k / 40) * 2 * Math.PI, b = ((k + 1) / 40) * 2 * Math.PI; seg([l.x + Math.cos(a) * l.rx, l.y + Math.sin(a) * l.ry], [l.x + Math.cos(b) * l.rx, l.y + Math.sin(b) * l.ry], [0, 0, 255]); }
for (const p of places) for (let k = -6; k <= 6; k++) { dot(p.x + k, p.y, [255, 0, 255]); dot(p.x, p.y + k, [255, 0, 255]); }
await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).png().toFile('_ke_features.png');
console.log('wrote tools/_ke_features.png');

if (process.argv.includes('--write')) {
  delete def.base; // ke_warp.mjs keeps an untouched copy here; it must be rebuilt from these
  Object.assign(def, { features, lakes, rivers: [{ name: '', pts: river, w: 2 }], places, regions });
  fs.writeFileSync(F, JSON.stringify(def, null, 1));
  console.log('wrote', F);
}
