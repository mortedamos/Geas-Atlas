// Street-level layouts for every village, town, city and port, for the closest zoom levels (atlas/towns.js).
//   usage (after attach_notes.mjs):  node towns.mjs ../atlas/data
// Nothing on the map shows streets, so each settlement gets an invented but repeatable plan (seeded by its name):
//   - main roads leave toward the nearest neighbouring settlements; ring streets and cross lanes join them round a market square;
//   - houses are packed along the streets in rows; cities (and some towns) get a wall with gates and towers, a keep and a temple;
//   - where the real coast or a river runs close, the plan keeps off the water and adds a waterfront street, quay and piers (or bridges).
// All sizes are feet. Output: atlas/data/towns.json (compact: positions in a local east/north frame around the settlement).
// A hand-made city map can replace a generated one: list it in source/town_maps.json (see atlas/towns.js).
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.argv[2] || '../atlas/data');
const rd = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
const MPP = rd('scale.json').milesPerWorldPx, FT = 5280 * MPP; // feet per world px
const px = ([lng, lat]) => [lng * 51.2 + 512, 512 - lat * 51.2];
const KINDS = new Set(['village', 'town', 'city', 'port']);
const R_TIER = { 1: 420, 2: 1000, 3: 2200 }; // radius of the built-up area, feet
const CELL = 6; // occupancy grid, feet
const WIDTH = { main: 26, street: 17, lane: 11 };

// ---------- geometry of the real map (world px) ----------
const landG = rd('land.geojson').features[0].geometry;
const landPolys = (landG.type === 'Polygon' ? [landG.coordinates] : landG.coordinates).map((p) => {
  const rings = p.map((r) => r.map(px)), xs = rings[0].map((c) => c[0]), ys = rings[0].map((c) => c[1]);
  return { rings, bb: [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)] };
});
const inRing = (r, x, y) => { let c = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [xi, yi] = r[i], [xj, yj] = r[j]; if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c; } return c; };
const inLand = (x, y) => landPolys.some((P) => x >= P.bb[0] && x <= P.bb[2] && y >= P.bb[1] && y <= P.bb[3] && inRing(P.rings[0], x, y) && !P.rings.slice(1).some((h) => inRing(h, x, y)));
const coastSegs = [];
for (const P of landPolys) for (const r of P.rings) for (let i = 0; i < r.length - 1; i++) coastSegs.push([r[i][0], r[i][1], r[i + 1][0], r[i + 1][1], 0]);
const riverSegs = [];
for (const f of rd('rivers.geojson').features) {
  const lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.type === 'MultiLineString' ? f.geometry.coordinates : [];
  for (const l of lines) for (let i = 0; i < l.length - 1; i++) { const a = px(l[i]), b = px(l[i + 1]); riverSegs.push([a[0], a[1], b[0], b[1], f.properties.w || 1]); }
}
function nearestSeg(segs, x, y) {
  let best = { d: Infinity };
  for (const [ax, ay, bx, by, w] of segs) {
    const dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy || 1e-12;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / L2)), qx = ax + dx * t, qy = ay + dy * t, d = Math.hypot(qx - x, qy - y);
    if (d < best.d) { const L = Math.sqrt(L2); best = { d, qx, qy, ux: dx / L, uy: dy / L, w }; }
  }
  return best;
}

// ---------- small tools ----------
const hashStr = (s) => { let h = 2166136261; for (const c of s) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
const rngOf = (seed) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const lerp = (a, b, t) => a + (b - a) * t;
const angDiff = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
const r0 = Math.round;

function layoutTown(f, all) {
  const p = f.properties;
  const tier = p.tier ?? ({ village: 1, town: 2, port: 2, city: 3 }[p.kind] ?? 2);
  const rng = rngOf(hashStr(`${p.name}:${p.kind}`));
  const R = R_TIER[tier] * (0.9 + rng() * 0.2);
  let [cx, cy] = px(f.geometry.coordinates);
  const note = {};
  if (!inLand(cx, cy)) { // a pin in the sea: step it onto the nearest shore, or give up
    const c = nearestSeg(coastSegs, cx, cy);
    if (c.d > 2.5) return { skip: `in the sea, ${(c.d * MPP).toFixed(0)} mi from land` };
    const ux = (c.qx - cx) / c.d, uy = (c.qy - cy) / c.d;
    cx = c.qx + (ux * 0.3 * R) / FT; cy = c.qy + (uy * 0.3 * R) / FT;
    if (!inLand(cx, cy)) return { skip: 'in the sea' };
    note.moved = +(c.d * MPP).toFixed(1);
  }
  const toL = (wx, wy) => [(wx - cx) * FT, -(wy - cy) * FT];

  // the real coast and river nearest the settlement, as straight lines in the local frame
  let coast = null, river = null;
  { const c = nearestSeg(coastSegs, cx, cy);
    if (c.d * FT < (p.kind === 'port' ? 3.5 : 1.7) * R) {
      const q = toL(c.qx, c.qy), t = [c.ux, -c.uy];
      let n = [-t[1], t[0]];
      const probe = (nn) => inLand(cx + (q[0] + nn[0] * 100) / FT, cy - (q[1] + nn[1] * 100) / FT);
      if (probe(n)) n = [-n[0], -n[1]];
      coast = { p: q, n, t };
    } }
  { const c = nearestSeg(riverSegs, cx, cy);
    if (c.d * FT < 1.5 * R) river = { p: toL(c.qx, c.qy), t: [c.ux, -c.uy], W: { 1: 36, 2: 55, 3: 80, 4: 110 }[Math.max(1, Math.min(4, Math.round(c.w)))] }; }
  const sea = (x, y) => coast && (x - coast.p[0]) * coast.n[0] + (y - coast.p[1]) * coast.n[1] > 0;
  const riverDist = (x, y) => (river ? Math.abs((x - river.p[0]) * river.t[1] - (y - river.p[1]) * river.t[0]) : 1e9);
  const water = (x, y) => sea(x, y) || riverDist(x, y) < river?.W / 2 + 4;

  // centre of the plan: kept off the shore and off the river
  let c0 = [0, 0];
  if (coast) { const s = (0 - coast.p[0]) * coast.n[0] + (0 - coast.p[1]) * coast.n[1], need = 0.3 * R + s; if (need > 0 || (p.kind === 'port' && need < 0)) c0 = [c0[0] - coast.n[0] * need, c0[1] - coast.n[1] * need]; }
  if (river) { const sd = (c0[0] - river.p[0]) * river.t[1] - (c0[1] - river.p[1]) * river.t[0], need = river.W / 2 + 0.1 * R - Math.abs(sd); if (need > 0) { const s = sd >= 0 ? 1 : -1; c0 = [c0[0] + s * river.t[1] * need, c0[1] - s * river.t[0] * need]; } }

  const walled = tier === 3 || (tier === 2 && rng() < 0.3) || p.kind === 'fort';
  const Rw = 0.9 * R, Rin = walled ? Rw - 20 : R;
  const half = Math.ceil(1.45 * R), N = Math.ceil((2 * half) / CELL);
  const occ = new Uint8Array(N * N); // 0 free, 1 water, 2 street, 3 building, 4 plaza, 5 wall
  const gi = (v) => Math.floor((v + half) / CELL);
  const cellC = (i) => -half + (i + 0.5) * CELL;
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) if (water(cellC(i), cellC(j))) occ[j * N + i] = 1;
  const stamp = (x, y, r, val) => { for (let j = Math.max(0, gi(y - r)); j <= Math.min(N - 1, gi(y + r)); j++) for (let i = Math.max(0, gi(x - r)); i <= Math.min(N - 1, gi(x + r)); i++) { if (occ[j * N + i] === 0 && Math.hypot(cellC(i) - x, cellC(j) - y) <= r) occ[j * N + i] = val; } };
  const rectCells = (x, y, w, d, a, margin, fn) => {
    const ca = Math.cos(a), sa = Math.sin(a), hw = w / 2 + margin, hd = d / 2 + margin;
    const ex = Math.abs(ca) * hw + Math.abs(sa) * hd, ey = Math.abs(sa) * hw + Math.abs(ca) * hd;
    for (let j = gi(y - ey); j <= gi(y + ey); j++) for (let i = gi(x - ex); i <= gi(x + ex); i++) {
      const dx = cellC(i) - x, dy = cellC(j) - y, u = dx * ca + dy * sa, v = -dx * sa + dy * ca;
      if (Math.abs(u) <= hw && Math.abs(v) <= hd && fn(i, j) === false) return false;
    }
    return true;
  };
  const rectFree = (x, y, w, d, a, m = 2) => rectCells(x, y, w, d, a, m, (i, j) => i >= 0 && j >= 0 && i < N && j < N && occ[j * N + i] === 0);
  const rectMark = (x, y, w, d, a, val) => rectCells(x, y, w, d, a, 0, (i, j) => { if (i >= 0 && j >= 0 && i < N && j < N) occ[j * N + i] = val; });

  const out = { st: [], b: [], civ: [], pl: [], wl: [], tw: [], wa: [], dk: [], br: [], lb: [] };
  // wobble: a gentle warp so no street is ruler-straight
  const ph = [rng() * 6.28, rng() * 6.28, rng() * 6.28, rng() * 6.28];
  const warp = (x, y, k = 1) => [x + k * 0.022 * R * (Math.sin(y / (0.33 * R) + ph[0]) + 0.5 * Math.sin(x / (0.17 * R) + ph[1])), y + k * 0.022 * R * (Math.sin(x / (0.31 * R) + ph[2]) + 0.5 * Math.sin(y / (0.19 * R) + ph[3]))];

  // plaza
  const hs = Math.max(34, 0.05 * R), cut = hs * 0.3;
  out.pl.push([[-hs + cut, -hs], [hs - cut, -hs], [hs, -hs + cut], [hs, hs - cut], [hs - cut, hs], [-hs + cut, hs], [-hs, hs - cut], [-hs, -hs + cut]].map(([x, y]) => [r0(c0[0] + x), r0(c0[1] + y)]).flat());
  rectMark(c0[0], c0[1], 2 * hs, 2 * hs, 0, 4);
  out.lb.push([tier === 1 ? 'The Green' : 'Market Square', r0(c0[0]), r0(c0[1])]);

  // streets: densify, keep the dry runs, stamp them into the grid
  const streets = [];
  function addStreet(cls, pts, { suburb = false, crossRiver = false } = {}) {
    if (pts.length < 2) return;
    const dense = [];
    for (let i = 0; i < pts.length - 1; i++) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / 30)); for (let k = 0; k < n; k++) dense.push([lerp(ax, bx, k / n), lerp(ay, by, k / n)]); }
    dense.push(pts[pts.length - 1]);
    let run = [];
    const flush = () => { if (run.length >= 2) { let L = 0; for (let i = 1; i < run.length; i++) L += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]); if (L >= 24) { const s = { cls, pts: run, w: WIDTH[cls], suburb, L }; streets.push(s); } } run = []; };
    for (const q of dense) {
      const rr = Math.hypot(q[0] - c0[0], q[1] - c0[1]);
      const wet = crossRiver ? sea(q[0], q[1]) : water(q[0], q[1]);
      if (wet || rr > 1.3 * R || Math.abs(q[0]) > half - 10 || Math.abs(q[1]) > half - 10) flush(); else run.push(q);
    }
    flush();
  }
  // main roads toward the nearest neighbours
  const nbrs = all.filter((o) => o !== f).map((o) => { const [ox, oy] = px(o.geometry.coordinates); return { a: Math.atan2(-(oy - cy), ox - cx), d: Math.hypot(ox - cx, oy - cy) }; }).sort((a, b) => a.d - b.d);
  const want = tier === 3 ? 5 : tier === 2 ? 4 : 3;
  const angles = [];
  const toSea = (a) => coast && Math.cos(a) * coast.n[0] + Math.sin(a) * coast.n[1] > 0.55;
  for (const n of nbrs.slice(0, 10)) if (angles.length < want && !toSea(n.a) && angles.every((a) => angDiff(a, n.a) > 0.75)) angles.push(n.a);
  for (let tries = 0; angles.length < Math.min(want, 3 + (tier === 3 ? 1 : 0)) && tries < 60; tries++) { const a = rng() * 6.283; if (!toSea(a) && angles.every((b) => angDiff(a, b) > 0.9)) angles.push(a); }
  const gates = [];
  angles.forEach((a, i) => {
    const pts = [], dx = Math.cos(a), dy = Math.sin(a), ph1 = rng() * 6.28, ph2 = rng() * 6.28;
    for (let t = hs * 1.05; t <= 1.3 * R; t += 0.08 * R) { const lat = 0.025 * R * (Math.sin((t * 3.1) / R + ph1) + 0.6 * Math.sin((t * 7.3) / R + ph2)); pts.push([c0[0] + dx * t - dy * lat, c0[1] + dy * t + dx * lat]); }
    addStreet('main', pts, { suburb: true, crossRiver: true });
    if (walled) gates.push({ a, x: c0[0] + dx * Rw, y: c0[1] + dy * Rw });
  });
  // rings and cross lanes
  const ringF = tier === 3 ? [0.3, 0.55, 0.8] : tier === 2 ? [0.42, 0.78] : [0.62];
  const radii = [hs * 1.2, ...ringF.map((fr) => fr * Rin)];
  ringF.forEach((fr, ri) => {
    const r = fr * Rin, step = Math.max(0.1, 60 / r);
    let pts = [];
    const flushRing = () => { addStreet(tier === 3 && ri < 2 ? 'street' : tier === 1 ? 'lane' : ri === 0 ? 'street' : 'lane', pts); pts = []; };
    const a0 = rng() * 6.28;
    for (let a = 0; a <= 6.2832 + step; a += step) {
      const rr = r * (1 + 0.05 * Math.sin(a * 3 + ph[0]) + 0.035 * Math.sin(a * 5 + ph[1]));
      const q = warp(c0[0] + Math.cos(a + a0) * rr, c0[1] + Math.sin(a + a0) * rr, 0.6);
      pts.push(q);
      if (rng() < 0.012) { flushRing(); }
    }
    flushRing();
  });
  for (let k = 0; k + 1 < radii.length; k++) {
    const nl = tier === 3 ? 9 : tier === 2 ? 6 : 3;
    for (let n = 0; n < nl; n++) {
      const a = rng() * 6.283, ra = radii[k], rb = radii[k + 1] * (1.02), pts = [];
      for (let t = 0; t <= 1.001; t += 0.25) { const rr = lerp(ra, rb, t), aa = a + 0.08 * Math.sin(t * 5 + n); pts.push(warp(c0[0] + Math.cos(aa) * rr, c0[1] + Math.sin(aa) * rr, 0.5)); }
      addStreet(k === 0 && tier > 1 ? 'street' : 'lane', pts);
    }
  }
  // harbour: a street along the shore, a quay and piers
  if (coast) {
    const s0 = (c0[0] - coast.p[0]) * coast.n[0] + (c0[1] - coast.p[1]) * coast.n[1]; // negative = inland
    const foot = [c0[0] - coast.n[0] * s0, c0[1] - coast.n[1] * s0]; // nearest point of the shore to the plaza
    if (-s0 < 0.9 * R) {
      const L = 0.65 * R, pts = [];
      for (let t = -L; t <= L; t += 50) pts.push([foot[0] + coast.t[0] * t - coast.n[0] * 30, foot[1] + coast.t[1] * t - coast.n[1] * 30]);
      addStreet('street', pts);
      const ang = Math.atan2(coast.t[1], coast.t[0]);
      out.dk.push([r0(foot[0] - coast.n[0] * 6), r0(foot[1] - coast.n[1] * 6), r0(1.1 * L), 12, r0((ang * 180) / Math.PI), 0]);
      const np = tier === 3 ? 6 : tier === 2 ? 3 : 1;
      for (let k = 0; k < np; k++) {
        const t = np === 1 ? 0 : lerp(-0.7 * L, 0.7 * L, k / (np - 1)) + (rng() - 0.5) * 20, len = lerp(40, 90, rng());
        out.dk.push([r0(foot[0] + coast.t[0] * t + coast.n[0] * (len / 2 - 6)), r0(foot[1] + coast.t[1] * t + coast.n[1] * (len / 2 - 6)), 12, r0(len), r0((ang * 180) / Math.PI), 1]);
      }
      out.lb.push(['Harbour', r0(foot[0] + coast.n[0] * 70), r0(foot[1] + coast.n[1] * 70)]);
    }
  }
  for (const s of streets) { for (let i = 0; i < s.pts.length - 1; i++) { const [ax, ay] = s.pts[i], [bx, by] = s.pts[i + 1], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / 3)); for (let k = 0; k <= n; k++) stamp(lerp(ax, bx, k / n), lerp(ay, by, k / n), s.w / 2 + 1, 2); } }
  // bridges where a main road crosses the river
  if (river) for (const s of streets) if (s.cls === 'main') for (let i = 0; i < s.pts.length - 1; i++) {
    const sd = (q) => (q[0] - river.p[0]) * river.t[1] - (q[1] - river.p[1]) * river.t[0], s1 = sd(s.pts[i]), s2 = sd(s.pts[i + 1]);
    if (s1 * s2 < 0 || (Math.abs(s1) < river.W / 2 && Math.abs(s2) < river.W / 2)) { const m = [(s.pts[i][0] + s.pts[i + 1][0]) / 2, (s.pts[i][1] + s.pts[i + 1][1]) / 2]; if (riverDist(m[0], m[1]) < river.W) { out.br.push([r0(m[0]), r0(m[1]), r0(river.W + 44), 32, r0((Math.atan2(s.pts[i + 1][1] - s.pts[i][1], s.pts[i + 1][0] - s.pts[i][0]) * 180) / Math.PI), 0]); break; } }
  }
  // the river itself, as a band
  if (river) { const L = 1.6 * R, a = [river.p[0] - river.t[0] * L * 2, river.p[1] - river.t[1] * L * 2], b = [river.p[0] + river.t[0] * L * 2, river.p[1] + river.t[1] * L * 2], nx = -river.t[1] * river.W / 2, ny = river.t[0] * river.W / 2; out.wa.push([a[0] + nx, a[1] + ny, b[0] + nx, b[1] + ny, b[0] - nx, b[1] - ny, a[0] - nx, a[1] - ny].map(r0)); }

  // wall, gates, towers
  if (walled) {
    const step = 36 / Rw, towerEvery = 7;
    let run = [], k = 0;
    const pushRun = () => { if (run.length >= 2) out.wl.push(run.flat().map(r0)); run = []; };
    const ph5 = rng() * 6.28;
    for (let a = 0; a <= 6.2832 + step; a += step, k++) {
      const rr = Rw * (1 + 0.035 * Math.sin(a * 4 + ph5) + 0.02 * Math.sin(a * 9 + ph5 * 2));
      const q = [c0[0] + Math.cos(a) * rr, c0[1] + Math.sin(a) * rr];
      const atGate = gates.some((g) => Math.hypot(q[0] - g.x, q[1] - g.y) < 26);
      if (water(q[0], q[1]) || atGate) { pushRun(); continue; }
      run.push(q); stamp(q[0], q[1], 6, 5);
      if (k % towerEvery === 0) out.tw.push([r0(q[0]), r0(q[1]), tier === 3 ? 12 : 9]);
    }
    pushRun();
    for (const g of gates) { const tx = -Math.sin(g.a), ty = Math.cos(g.a); for (const sgn of [-1, 1]) out.tw.push([r0(g.x + tx * 30 * sgn), r0(g.y + ty * 30 * sgn), tier === 3 ? 14 : 11]); }
  }

  // civic buildings: temple, keep
  const civic = (type, w, d, rmin, rmax, towers) => {
    for (let tries = 0; tries < 80; tries++) {
      const a = rng() * 6.283, rr = lerp(rmin, rmax, rng()), x = c0[0] + Math.cos(a) * rr, y = c0[1] + Math.sin(a) * rr, ang = a + Math.PI / 2 + (rng() - 0.5) * 0.2;
      if (rr > Rin - Math.max(w, d) / 2) continue;
      if (rectFree(x, y, w, d, ang, 6)) {
        rectMark(x, y, w, d, ang, 3);
        out.civ.push([r0(x), r0(y), w, d, r0((ang * 180) / Math.PI), type === 'keep' ? 1 : 0]);
        out.lb.push([type === 'keep' ? 'Keep' : 'Temple', r0(x), r0(y + d / 2 + 14)]);
        if (towers) for (const sx of [-1, 1]) for (const sy of [-1, 1]) { const ca = Math.cos(ang), sa = Math.sin(ang), ox = (sx * w) / 2, oy = (sy * d) / 2; out.tw.push([r0(x + ox * ca - oy * sa), r0(y + ox * sa + oy * ca), 9]); }
        return true;
      }
    }
    return false;
  };
  if (tier >= 2 || rng() < 0.6) civic('temple', tier === 3 ? 56 : tier === 2 ? 44 : 26, tier === 3 ? 100 : tier === 2 ? 72 : 40, hs * 1.6, 0.4 * Rin, false);
  if (tier === 3 || walled || (tier === 2 && rng() < 0.3) || p.kind === 'fort') civic('keep', tier === 3 ? 110 : 70, tier === 3 ? 110 : 70, 0.5 * Rin, 0.8 * Rin, true);

  // houses: rows along every street
  const dims = tier === 3 ? { w: [16, 32], d: [18, 30] } : tier === 2 ? { w: [18, 36], d: [20, 34] } : { w: [22, 42], d: [22, 38] };
  const baseP = tier === 3 ? 0.93 : tier === 2 ? 0.82 : 0.6;
  const ok = (x, y, suburb) => { const rr = Math.hypot(x - c0[0], y - c0[1]); return walled ? rr < Rw - 18 || (suburb && rr > Rw + 18 && rr < 1.2 * R) : rr <= (suburb ? 1.22 : 1.1) * R; };
  const pFill = (x, y, suburb) => { const rr = Math.hypot(x - c0[0], y - c0[1]) / R; return baseP * (1 - 0.45 * Math.min(1, rr * rr)) * (walled && rr > 0.9 ? 0.5 : 1) * (suburb && rr > 0.95 ? 0.7 : 1); };
  const place = (x, y, w, d, a, nx, ny, suburb, queue) => {
    if (!ok(x, y, suburb) || rng() > pFill(x, y, suburb) || !rectFree(x, y, w, d, a)) return;
    rectMark(x, y, w, d, a, 3);
    out.b.push([r0(x), r0(y), r0(w), r0(d), r0((a * 180) / Math.PI), r0(rng() * 2.99)]);
    queue.push({ x, y, a, nx, ny, d, suburb });
  };
  let row = [];
  for (const s of streets) {
    const cum = [0];
    for (let i = 1; i < s.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(s.pts[i][0] - s.pts[i - 1][0], s.pts[i][1] - s.pts[i - 1][1]));
    const L = cum[cum.length - 1];
    const at = (t) => { let i = 1; while (i < cum.length - 1 && cum[i] < t) i++; const u = (t - cum[i - 1]) / (cum[i] - cum[i - 1] || 1), a = s.pts[i - 1], b = s.pts[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return { x: lerp(a[0], b[0], u), y: lerp(a[1], b[1], u), tx: (b[0] - a[0]) / len, ty: (b[1] - a[1]) / len }; };
    for (const side of [1, -1]) {
      let t = rng() * 8;
      while (t < L) {
        const bw = lerp(dims.w[0], dims.w[1], rng()), bd = lerp(dims.d[0], dims.d[1], rng()), q = at(Math.min(L, t + bw / 2));
        const nx = -q.ty * side, ny = q.tx * side, off = s.w / 2 + bd / 2 + 3 + rng() * 3;
        place(q.x + nx * off, q.y + ny * off, bw, bd, Math.atan2(q.ty, q.tx) + (rng() - 0.5) * 0.06, nx, ny, s.suburb, row);
        t += bw + 1.5 + rng() * 5;
      }
    }
  }
  const rows = tier === 3 ? 3 : 2;
  for (let rIdx = 1; rIdx < rows; rIdx++) {
    const next = [];
    for (const q of row) {
      const bw = lerp(dims.w[0], dims.w[1], rng()), bd = lerp(dims.d[0], dims.d[1], rng());
      if (rng() < (tier === 1 ? 0.45 : 0.85)) place(q.x + q.nx * (q.d / 2 + bd / 2 + 2.5), q.y + q.ny * (q.d / 2 + bd / 2 + 2.5), bw, bd, q.a, q.nx, q.ny, q.suburb, next);
    }
    row = next;
  }

  // backyards: fill the middle of the blocks, houses turned to the nearest street
  {
    const bucket = new Map(), BK = 170;
    for (const s of streets) for (let i = 0; i < s.pts.length - 1; i++) {
      const [ax, ay] = s.pts[i], [bx, by] = s.pts[i + 1], L = Math.hypot(bx - ax, by - ay) || 1, n = Math.max(1, Math.ceil(L / 25));
      for (let k = 0; k < n; k++) { const x = lerp(ax, bx, k / n), y = lerp(ay, by, k / n), key = Math.floor(x / BK) + ',' + Math.floor(y / BK); (bucket.get(key) || bucket.set(key, []).get(key)).push([x, y, (bx - ax) / L, (by - ay) / L, s.suburb]); }
    }
    const tries = tier === 3 ? 14000 : tier === 2 ? 3500 : 500, lim = (walled ? Rw : 1.1 * R) - 18;
    for (let n = 0; n < tries; n++) {
      const rr = Math.sqrt(rng()) * lim, a = rng() * 6.283, x = c0[0] + Math.cos(a) * rr, y = c0[1] + Math.sin(a) * rr;
      let best = null, bd = 1e9;
      const kx = Math.floor(x / BK), ky = Math.floor(y / BK);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const q of bucket.get((kx + dx) + ',' + (ky + dy)) || []) { const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = q; } }
      if (!best || bd > 240) continue;
      const ang = Math.atan2(best[3], best[2]) + (rng() - 0.5) * 0.1;
      const w = lerp(dims.w[0], dims.w[1], rng()), d = lerp(dims.d[0], dims.d[1], rng());
      if (rng() < 0.3) place(x, y, w, d, ang, 0, 0, false, []);
    }
  }

  const rounded = (a) => a.map((v) => (typeof v === 'number' ? r0(v) : v));
  const rec = { x: +cx.toFixed(3), y: +cy.toFixed(3), t: tier, r: r0(R), st: streets.map((s) => [s.cls === 'main' ? 0 : s.cls === 'street' ? 1 : 2, s.pts.flat().map(r0)]), b: out.b, civ: out.civ, pl: out.pl, wl: out.wl, tw: out.tw, wa: out.wa, dk: out.dk, br: out.br, lb: out.lb.map((l) => rounded(l)) };
  return { rec, stats: { b: out.b.length, st: streets.length, coast: !!coast, river: !!river, walled, ...note } };
}

const places = rd('places.geojson').features;
const todo = places.filter((f) => KINDS.has(f.properties.kind));
const towns = {}, skipped = [], moved = [];
let total = { b: 0 };
for (const f of todo) {
  const res = layoutTown(f, places);
  if (res.skip) { skipped.push(`${f.properties.name}: ${res.skip}`); continue; }
  const key = f.properties.editKey || `${f.properties.source}:${f.properties.name}`;
  towns[key] = { n: f.properties.name, ...res.rec };
  total.b += res.stats.b;
  if (res.stats.moved) moved.push(`${f.properties.name}: pin was ${res.stats.moved} mi off the coast, plan placed on the shore`);
}
const SIZE_NOTE = 'Street plans: local frame in feet (x east, y north) around the world-px point (x, y). Generated by tools/towns.mjs.';
fs.writeFileSync(path.join(dataDir, 'towns.json'), JSON.stringify({ note: SIZE_NOTE, ft: FT, towns }));
console.log(`towns ${Object.keys(towns).length}, buildings ${total.b}, file ${(fs.statSync(path.join(dataDir, 'towns.json')).size / 1e6).toFixed(2)} MB`);
if (moved.length) console.log('moved onto the shore:\n  ' + moved.join('\n  '));
if (skipped.length) console.log('skipped:\n  ' + skipped.join('\n  '));
