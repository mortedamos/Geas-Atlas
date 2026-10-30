// Simulated height map -> rivers, for the parts of the world nobody has drawn.
//   usage (after interior.mjs):  node heightmap.mjs ../atlas/data
// 1. Land is rasterised on a 1-world-pixel grid. Elevation = distance from the coast (inland is higher) + the mountain
//    and hill areas that already exist on the map (blurred, so ranges have slopes) + fractal noise.
// 2. Depressions are filled (priority-flood), every cell drains downhill to the sea, and rain is accumulated downstream.
// 3. Cells with a big enough catchment are rivers. They are traced from their sources to the sea, smoothed, given a
//    meander, and the biggest get a delta. Hand-drawn regions (and the polar ice) are left alone.
// Rivers are appended to rivers.geojson (source 'generated'); interior.mjs rewrites that file on every run.
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.argv[2] || '../atlas/data');
const SRC = path.resolve('source');
const WORLD = 1024, DEG = 20 / WORLD;
const X0 = 100, Y0 = -10, GW = 400, GH = 720; // domain in world px: the central continent and the north-east of the northern one
const N = GW * GH;
const T_RIVER = Number(process.env.T_RIVER || 260); // catchment (cells) that makes a river
const rd = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
const toW = ([lng, lat]) => [lng / DEG + WORLD / 2, WORLD / 2 - lat / DEG];
const toLL = ([x, y]) => [(x - WORLD / 2) * DEG, -(y - WORLD / 2) * DEG];

// ---- scanline polygon rasteriser (even-odd over a polygon's rings; world-pixel coordinates) ----
function rasterize(polys, mask, value = 1) {
  for (const rings of polys) {
    const rows = new Map();
    let minY = Infinity, maxY = -Infinity;
    for (const ring of rings) {
      for (let i = 0; i < ring.length - 1; i++) {
        let [x1, y1] = ring[i], [x2, y2] = ring[i + 1];
        if (y1 === y2) continue;
        if (y1 > y2) [x1, y1, x2, y2] = [x2, y2, x1, y1];
        minY = Math.min(minY, y1); maxY = Math.max(maxY, y2);
        const r0 = Math.max(0, Math.ceil(y1 - Y0 - 0.5)), r1 = Math.min(GH - 1, Math.floor(y2 - Y0 - 0.5));
        for (let r = r0; r <= r1; r++) {
          const y = Y0 + r + 0.5;
          if (y < y1 || y >= y2) continue;
          const x = x1 + ((x2 - x1) * (y - y1)) / (y2 - y1);
          (rows.get(r) || rows.set(r, []).get(r)).push(x);
        }
      }
    }
    for (const [r, xs] of rows) {
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const c0 = Math.max(0, Math.ceil(xs[k] - X0 - 0.5)), c1 = Math.min(GW - 1, Math.floor(xs[k + 1] - X0 - 0.5));
        for (let c = c0; c <= c1; c++) mask[r * GW + c] = value;
      }
    }
  }
}
const polysFromFeature = (f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates).map((rings) => rings.map((ring) => ring.map(toW)));

// ---- inputs ----
const LM = new Uint8Array(N); // land
for (const f of rd('land.geojson').features) rasterize(polysFromFeature(f), LM);
const M = new Uint8Array(N), H = new Uint8Array(N);
for (const f of rd('terrain.geojson').features) {
  if (f.properties.kind === 'mountain') rasterize(polysFromFeature(f), M);
  else if (f.properties.kind === 'hills') rasterize(polysFromFeature(f), H);
}
// where nothing may be drawn or rained on: hand-drawn maps' footprints and the polar ice
const FP = new Uint8Array(N);
{
  const j = (n) => JSON.parse(fs.readFileSync(path.join(SRC, n + '.json'), 'utf8'));
  const rect = (x, y, w, h) => rasterize([[[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]]], FP);
  const arg = j('argusund'), tt = j('tel-tenauril'), sel = j('sellador'), cur = j('curmeah'), loc = j('lochlainn'), fn = j('free-nations');
  rect(arg.ox, arg.oy, 1485 * arg.scale, 1050 * arg.scale);
  rect(tt.ox, tt.oy, 1253 * tt.scale, 955 * tt.scale);
  rect(sel.ox, sel.oy, 1268 * sel.scale, 951 * sel.scale);
  rect(cur.erase.x0, cur.erase.y0, cur.erase.x1 - cur.erase.x0, cur.erase.y1 - cur.erase.y0);
  rect(loc.erase.x0, loc.erase.y0, loc.erase.x1 - loc.erase.x0, loc.erase.y1 - loc.erase.y0);
  const t = fn.transform, c = Math.cos(t.rot), s = Math.sin(t.rot);
  const paper = fn.paper.map(([x, y]) => [t.ox + t.scale * (c * x - s * y), t.oy + t.scale * (s * x + c * y)]);
  rasterize([[[...paper, paper[0]]]], FP);
}
for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) if (Y0 + r < 14) FP[r * GW + c] = 1; // polar ice

// ---- elevation ----
function blur(src, rad, passes = 2) {
  let a = Float32Array.from(src);
  for (let p = 0; p < passes; p++) {
    const t = new Float32Array(N), o = new Float32Array(N);
    for (let r = 0; r < GH; r++) { let acc = 0; for (let k = -rad; k <= rad; k++) acc += a[r * GW + Math.min(GW - 1, Math.max(0, k))]; for (let c = 0; c < GW; c++) { t[r * GW + c] = acc / (2 * rad + 1); acc += a[r * GW + Math.min(GW - 1, c + rad + 1)] - a[r * GW + Math.max(0, c - rad)]; } }
    for (let c = 0; c < GW; c++) { let acc = 0; for (let k = -rad; k <= rad; k++) acc += t[Math.min(GH - 1, Math.max(0, k)) * GW + c]; for (let r = 0; r < GH; r++) { o[r * GW + c] = acc / (2 * rad + 1); acc += t[Math.min(GH - 1, r + rad + 1) * GW + c] - t[Math.max(0, r - rad) * GW + c]; } }
    a = o;
  }
  return a;
}
const dist = new Float32Array(N).fill(1e6); // chamfer distance to the nearest sea cell
for (let i = 0; i < N; i++) if (!LM[i]) dist[i] = 0;
for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) { const i = r * GW + c; if (!dist[i]) continue; let d = dist[i]; if (c > 0) d = Math.min(d, dist[i - 1] + 1); if (r > 0) { d = Math.min(d, dist[i - GW] + 1); if (c > 0) d = Math.min(d, dist[i - GW - 1] + 1.414); if (c < GW - 1) d = Math.min(d, dist[i - GW + 1] + 1.414); } dist[i] = d; }
for (let r = GH - 1; r >= 0; r--) for (let c = GW - 1; c >= 0; c--) { const i = r * GW + c; if (!dist[i]) continue; let d = dist[i]; if (c < GW - 1) d = Math.min(d, dist[i + 1] + 1); if (r < GH - 1) { d = Math.min(d, dist[i + GW] + 1); if (c < GW - 1) d = Math.min(d, dist[i + GW + 1] + 1.414); if (c > 0) d = Math.min(d, dist[i + GW - 1] + 1.414); } dist[i] = d; }
const hash = (x, y, s) => { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
const sm = (t) => t * t * (3 - 2 * t);
const vn = (x, y, s) => { const ix = Math.floor(x), iy = Math.floor(y), fx = sm(x - ix), fy = sm(y - iy); return (hash(ix, iy, s) * (1 - fx) + hash(ix + 1, iy, s) * fx) * (1 - fy) + (hash(ix, iy + 1, s) * (1 - fx) + hash(ix + 1, iy + 1, s) * fx) * fy; };
const fbm = (x, y) => 0.55 * vn(x / 34, y / 34, 3) + 0.3 * vn(x / 15, y / 15, 5) + 0.15 * vn(x / 6, y / 6, 7);
const mb = blur(Float32Array.from(M), 4, 2), hb = blur(Float32Array.from(H), 4, 2);
const E = new Float32Array(N);
for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
  const i = r * GW + c;
  if (!LM[i]) { E[i] = -1; continue; }
  const inland = Math.min(1, dist[i] / 55);
  E[i] = 0.3 * sm(inland) + 0.22 * fbm(X0 + c, Y0 + r) + 1.3 * mb[i] + 0.5 * hb[i] + (FP[i] ? 0.8 : 0); // footprints/ice are walls: water drains away from them
}

// ---- priority-flood: fill depressions and find each cell's downstream neighbour ----
const parent = new Int32Array(N).fill(-1);
const closed = new Uint8Array(N);
const order = new Int32Array(N); let nOrder = 0;
const heapK = new Float64Array(N * 2), heapV = new Int32Array(N * 2); let hs = 0;
const push = (k, v) => { let i = hs++; while (i > 0) { const p = (i - 1) >> 1; if (heapK[p] <= k) break; heapK[i] = heapK[p]; heapV[i] = heapV[p]; i = p; } heapK[i] = k; heapV[i] = v; };
const pop = () => { const v = heapV[0], k = heapK[--hs]; const kv = heapV[hs]; let i = 0; for (;;) { let c = 2 * i + 1; if (c >= hs) break; if (c + 1 < hs && heapK[c + 1] < heapK[c]) c++; if (heapK[c] >= k) break; heapK[i] = heapK[c]; heapV[i] = heapV[c]; i = c; } heapK[i] = k; heapV[i] = kv; return v; };
const NB = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, -1], [-1, 1], [1, 1]];
for (let r = 0; r < GH; r++) for (let c = 0; c < GW; c++) {
  const i = r * GW + c;
  if (!LM[i]) { closed[i] = 1; continue; }
  // land touching the sea (or the domain edge) is an outlet
  let outlet = r === 0 || c === 0 || r === GH - 1 || c === GW - 1;
  for (const [dc, dr] of NB) { const rr = r + dr, cc = c + dc; if (rr >= 0 && rr < GH && cc >= 0 && cc < GW && !LM[rr * GW + cc]) outlet = true; }
  if (outlet) { closed[i] = 1; parent[i] = -2; push(E[i], i); }
}
while (hs) {
  const cur = pop(); order[nOrder++] = cur;
  const r = (cur / GW) | 0, c = cur - r * GW;
  for (const [dc, dr] of NB) {
    const rr = r + dr, cc = c + dc;
    if (rr < 0 || rr >= GH || cc < 0 || cc >= GW) continue;
    const j = rr * GW + cc;
    if (closed[j]) continue;
    closed[j] = 1; parent[j] = cur;
    E[j] = Math.max(E[j], E[cur] + 1e-5 * (dc && dr ? 1.414 : 1));
    push(E[j], j);
  }
}
// ---- accumulate rain downstream (processing cells from the highest down) ----
const acc = new Float32Array(N);
for (let i = 0; i < N; i++) acc[i] = LM[i] && !FP[i] ? 1 : 0;
for (let k = nOrder - 1; k >= 0; k--) { const i = order[k], p = parent[i]; if (p >= 0) acc[p] += acc[i]; }

// ---- trace rivers ----
const isRiver = (i) => LM[i] && !FP[i] && acc[i] >= T_RIVER;
const hasUp = new Uint8Array(N);
for (let i = 0; i < N; i++) if (isRiver(i) && parent[i] >= 0 && isRiver(parent[i])) hasUp[parent[i]] = 1;
const traced = new Uint8Array(N);
const lines = [];
for (let i = 0; i < N; i++) {
  if (!isRiver(i) || hasUp[i]) continue; // start at headwaters
  const cells = [i]; let cur = i, joined = false;
  for (;;) {
    const p = parent[cur];
    if (p < 0 || !isRiver(p)) { if (p >= 0) cells.push(p); break; }
    cells.push(p);
    if (traced[p]) { joined = true; break; }
    cur = p;
  }
  for (const c of cells) traced[c] = 1;
  if (cells.length < 9) continue;
  lines.push({ cells, mouth: cells[cells.length - 1], reachesSea: !joined && parent[cells[cells.length - 1]] < 0 || (!LM[cells[cells.length - 1]]) });
}
console.log('domain land cells', LM.reduce((s, v) => s + v, 0), '| river lines', lines.length, '| threshold', T_RIVER);

// ---- to smooth, meandering polylines (world px) ----
const rnd = (() => { let a = 20261029; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
const centre = (i) => { const r = (i / GW) | 0, c = i - r * GW; return [X0 + c + 0.5, Y0 + r + 0.5]; };
function chaikinOpen(pts, k) {
  let p = pts;
  for (let t = 0; t < k; t++) { const o = [p[0]]; for (let i = 0; i < p.length - 1; i++) { const a = p[i], b = p[i + 1]; o.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); } o.push(p[p.length - 1]); p = o; }
  return p;
}
function meander(pts, amp, seed) {
  const ph = [seed * 1.7, seed * 2.9];
  let d = 0;
  return pts.map((p, i) => {
    if (i === 0 || i === pts.length - 1) return p;
    const a = pts[i - 1], b = pts[i + 1], l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    d += Math.hypot(p[0] - a[0], p[1] - a[1]);
    const o = amp * (0.7 * Math.sin(d / 7 + ph[0]) + 0.4 * Math.sin(d / 3 + ph[1]));
    return [p[0] - ((b[1] - a[1]) / l) * o, p[1] + ((b[0] - a[0]) / l) * o];
  });
}
const features = [];
const landAt = (x, y) => { const c = Math.floor(x - X0), r = Math.floor(y - Y0); return c >= 0 && r >= 0 && c < GW && r < GH && LM[r * GW + c] === 1; };
let deltas = 0;
lines.forEach((ln, idx) => {
  const endAcc = acc[ln.cells[ln.cells.length - 2] ?? ln.cells[0]];
  const w = endAcc > 3000 ? 2.4 : endAcc > 1200 ? 1.8 : endAcc > 600 ? 1.3 : 1;
  let pts = ln.cells.map(centre);
  pts = chaikinOpen(pts, 2);
  pts = meander(pts, Math.min(1.1, 0.35 + endAcc / 2500), idx + 1);
  features.push({ type: 'Feature', properties: { name: '', source: 'generated', w, catchment: Math.round(endAcc) }, geometry: { type: 'LineString', coordinates: chaikinOpen(pts.map(toLL), 1).map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]) } });
  // big rivers that reach the sea fan out into a delta
  const last = ln.cells[ln.cells.length - 1];
  if (endAcc > 1400 && !LM[last] || (endAcc > 1400 && parent[last] === -2)) {
    const k = Math.max(0, pts.length - 9), apex = pts[k], nxt = pts[Math.min(pts.length - 1, k + 1)];
    const base = Math.atan2(nxt[1] - apex[1], nxt[0] - apex[0]);
    for (const da of [-44, -18, 12, 36]) {
      const ang = base + (da * Math.PI) / 180 + (rnd() - 0.5) * 0.18, ch = [apex.slice()];
      const ph = [rnd() * 6.28, rnd() * 6.28];
      for (let t = 1.2; t < 22; t += 1.2) {
        const off = 0.9 * Math.min(1, t / 14) * (0.7 * Math.sin(t / 7 + ph[0]) + 0.4 * Math.sin(t / 3 + ph[1]));
        const p = [apex[0] + Math.cos(ang) * t - Math.sin(ang) * off, apex[1] + Math.sin(ang) * t + Math.cos(ang) * off];
        if (!landAt(p[0], p[1])) { ch.push([p[0] + Math.cos(ang) * 0.6, p[1] + Math.sin(ang) * 0.6]); break; }
        ch.push(p);
      }
      if (ch.length > 4) features.push({ type: 'Feature', properties: { name: '', source: 'generated', w: 1, delta: true }, geometry: { type: 'LineString', coordinates: chaikinOpen(ch.map(toLL), 1).map(([x, y]) => [+x.toFixed(5), +y.toFixed(5)]) } });
    }
    deltas++;
  }
});
console.log('rivers drawn', lines.length, '| deltas', deltas, '| biggest catchment', Math.round(Math.max(...lines.map((l) => acc[l.cells[l.cells.length - 2] ?? l.cells[0]]))));

const riversFile = path.join(dataDir, 'rivers.geojson');
const base = rd('rivers.geojson');
base.features = base.features.filter((f) => f.properties.source !== 'generated').concat(features);
fs.writeFileSync(riversFile, JSON.stringify(base));
