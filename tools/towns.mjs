// Street-level layouts for every village, town, city and port, for the closest zoom levels (atlas/towns.js).
//   usage (after attach_notes.mjs):  node towns.mjs ../atlas/data
// Nothing on the map shows streets, so each settlement gets an invented but repeatable plan (seeded by its name). The plan follows
// whoever built it (source/town_styles.json assigns a people to each settlement):
//   human    medieval sprawl: main roads toward neighbouring settlements, ring streets round a market square, walls on cities (French radial)
//   atma     Roman: a strict grid of insulae round a forum, cardo and decumanus, rectangular walls, theatre and baths
//   egyptian a Nile city: a processional avenue from the water to a walled temple, tidy rows of flat-roofed houses, palms
//   elf      woven into the trees: golden-ratio spiral streets, oval houses in groves, no walls (art nouveau)
//   dwarf    carved into the Stone: a symmetrical sunburst of avenues and terraces, stepped halls, a great gate (art deco)
//   orc      functional brutalism: a parade ground, rigid avenues, long concrete slabs, a thick bastioned wall
//   goblin   random and haphazard: crooked paths, heaps of huts at every angle, a broken palisade
//   viking   a Trelleborg ring fort with pinwheels of longhouses, boat sheds along the shore, a ring of Thing stones
//   gnome    halfling burrows: winding lanes, round homes with gardens round a party tree
//   minotaur a labyrinth: the city is a maze of stone blocks round a palace court
// Where the real coast or a river runs close, the plan keeps off the water and adds a waterfront street, quay and piers (or bridges).
// All sizes are feet. Output: atlas/data/towns.json (compact: positions in a local east/north frame around the settlement).
// A hand-made city map can replace a generated one: list it in atlas/data/town_maps.json (see atlas/towns.js).
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
const PHI = 1.618034;
const STYLE_OF = { human: 'radial', atma: 'grid', egyptian: 'nile', elf: 'spiral', dwarf: 'fan', orc: 'slab', goblin: 'wander', viking: 'norse', gnome: 'burrow', minotaur: 'maze' };
const styles = JSON.parse(fs.readFileSync(path.resolve('source/town_styles.json'), 'utf8'));
const notes = rd('notes.json');

// which people built this settlement
function raceOf(p) {
  if (styles.byName?.[p.name]) return styles.byName[p.name];
  const trail = (p.dbId && notes[p.dbId]?.path ? notes[p.dbId].path.join(' > ') : '');
  let best = null;
  for (const [k, v] of Object.entries(styles.byRealm || {})) if (trail.includes(k) && (!best || k.length > best[0].length)) best = [k, v];
  if (best) return best[1];
  return styles.bySource?.[p.source] || styles.default || 'human';
}

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
const deg = (a) => r0((a * 180) / Math.PI);

function layoutTown(f, all) {
  const p = f.properties;
  const ruinTier = styles.ruins?.[p.name];
  const tier = ruinTier ?? p.tier ?? ({ village: 1, town: 2, port: 2, city: 3 }[p.kind] ?? 2);
  const race = raceOf(p), style = STYLE_OF[race] || 'radial';
  const rng = rngOf(hashStr(`${p.name}:${p.kind}`));
  const R = R_TIER[tier] * (0.9 + rng() * 0.2) * (style === 'wander' ? 0.85 : 1);
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

  const walled = style === 'slab' ? tier >= 2 : style === 'fan' ? tier >= 2 : style === 'spiral' || style === 'wander' || style === 'norse' || style === 'burrow' || style === 'maze' ? false : style === 'nile' ? tier === 3 : (tier === 3 || (tier === 2 && rng() < 0.3) || p.kind === 'fort');
  const Rw = 0.9 * R, Rin = walled ? Rw - 20 : R;
  const half = Math.ceil(1.45 * R), N = Math.ceil((2 * half) / CELL);
  const occ = new Uint8Array(N * N); // 0 free, 1 water, 2 street, 3 building, 4 plaza, 5 wall, 6 tree
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

  const out = { st: [], b: [], civ: [], pl: [], wl: [], tw: [], wa: [], dk: [], br: [], lb: [], tr: [] };
  const rotP = (u, v, th) => [c0[0] + u * Math.cos(th) - v * Math.sin(th), c0[1] + u * Math.sin(th) + v * Math.cos(th)];
  const toUV = (x, y, th) => { const dx = x - c0[0], dy = y - c0[1]; return [dx * Math.cos(th) + dy * Math.sin(th), -dx * Math.sin(th) + dy * Math.cos(th)]; };
  const ph = [rng() * 6.28, rng() * 6.28, rng() * 6.28, rng() * 6.28];
  const warp = (x, y, k = 1) => [x + k * 0.022 * R * (Math.sin(y / (0.33 * R) + ph[0]) + 0.5 * Math.sin(x / (0.17 * R) + ph[1])), y + k * 0.022 * R * (Math.sin(x / (0.31 * R) + ph[2]) + 0.5 * Math.sin(y / (0.19 * R) + ph[3]))];
  const polyOut = (pts) => pts.map(([x, y]) => [r0(x), r0(y)]).flat();
  const hs = Math.max(34, 0.05 * R);
  const label = (text, x, y) => out.lb.push([text, r0(x), r0(y)]);

  // ---------- streets: densify, keep the dry runs, stamp them into the grid ----------
  const streets = [];
  function addStreet(cls, pts, { suburb = false, crossRiver = false, limit = 1.3 } = {}) {
    if (pts.length < 2) return;
    const dense = [];
    for (let i = 0; i < pts.length - 1; i++) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / 30)); for (let k = 0; k < n; k++) dense.push([lerp(ax, bx, k / n), lerp(ay, by, k / n)]); }
    dense.push(pts[pts.length - 1]);
    let run = [];
    const flush = () => { if (run.length >= 2) { let L = 0; for (let i = 1; i < run.length; i++) L += Math.hypot(run[i][0] - run[i - 1][0], run[i][1] - run[i - 1][1]); if (L >= 24) streets.push({ cls, pts: run, w: WIDTH[cls], suburb, L }); } run = []; };
    for (const q of dense) {
      const rr = Math.hypot(q[0] - c0[0], q[1] - c0[1]);
      const wet = crossRiver ? sea(q[0], q[1]) : water(q[0], q[1]);
      if (wet || rr > limit * R || Math.abs(q[0]) > half - 10 || Math.abs(q[1]) > half - 10) flush(); else run.push(q);
    }
    flush();
  }
  // walls: a polyline densified to ~36 ft, broken at water and at gates, with towers
  function addWall(pts, { gates = [], gap = 26, towerEvery = 7, tr = 12, gateTr = 14, thick = 0 } = {}) {
    const dense = [];
    for (let i = 0; i < pts.length - 1; i++) { const [ax, ay] = pts[i], [bx, by] = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / 36)); for (let k = 0; k < n; k++) dense.push([lerp(ax, bx, k / n), lerp(ay, by, k / n)]); }
    dense.push(pts[pts.length - 1]);
    let run = [], k = 0;
    const flush = () => { if (run.length >= 2) out.wl.push([thick || 0, ...run.flat().map(r0)]); run = []; };
    for (const q of dense) {
      k++;
      if (water(q[0], q[1]) || gates.some((g) => Math.hypot(q[0] - g[0], q[1] - g[1]) < gap)) { flush(); continue; }
      run.push(q); stamp(q[0], q[1], 6, 5);
      if (towerEvery && k % towerEvery === 0) out.tw.push([r0(q[0]), r0(q[1]), tr]);
    }
    flush();
    for (const g of gates) { const dx = g[0] - c0[0], dy = g[1] - c0[1], L = Math.hypot(dx, dy) || 1, tx = -dy / L, ty = dx / L; for (const s of [-1, 1]) out.tw.push([r0(g[0] + tx * (gap + 4) * s), r0(g[1] + ty * (gap + 4) * s), gateTr]); }
  }
  const civicAt = (x, y, w, d, ang, kind, text, towers) => {
    if (!rectFree(x, y, w, d, ang, 6)) return false;
    rectMark(x, y, w, d, ang, 3);
    out.civ.push([r0(x), r0(y), r0(w), r0(d), deg(ang), kind]);
    if (text) label(text, x, y + d / 2 + 14);
    if (towers) for (const sx of [-1, 1]) for (const sy of [-1, 1]) { const ca = Math.cos(ang), sa = Math.sin(ang), ox = (sx * w) / 2, oy = (sy * d) / 2; out.tw.push([r0(x + ox * ca - oy * sa), r0(y + ox * sa + oy * ca), 9]); }
    return true;
  };
  const civicSearch = (w, d, rmin, rmax, kind, text, towers, angOf) => {
    for (let tries = 0; tries < 90; tries++) {
      const a = rng() * 6.283, rr = lerp(rmin, rmax, rng()), x = c0[0] + Math.cos(a) * rr, y = c0[1] + Math.sin(a) * rr, ang = angOf ? angOf(a) : a + Math.PI / 2 + (rng() - 0.5) * 0.2;
      if (rr > Rin - Math.max(w, d) / 2) continue;
      if (civicAt(x, y, w, d, ang, kind, text, towers)) return true;
    }
    return false;
  };

  // neighbours: directions the main roads leave in
  const nbrs = all.filter((o) => o !== f).map((o) => { const [ox, oy] = px(o.geometry.coordinates); return { a: Math.atan2(-(oy - cy), ox - cx), d: Math.hypot(ox - cx, oy - cy) }; }).sort((a, b) => a.d - b.d);
  const toSea = (a) => coast && Math.cos(a) * coast.n[0] + Math.sin(a) * coast.n[1] > 0.55;
  const pickAngles = (want, minGap = 0.75) => {
    const angles = [];
    for (const n of nbrs.slice(0, 10)) if (angles.length < want && !toSea(n.a) && angles.every((a) => angDiff(a, n.a) > minGap)) angles.push(n.a);
    for (let tries = 0; angles.length < Math.min(want, 3) && tries < 60; tries++) { const a = rng() * 6.283; if (!toSea(a) && angles.every((b) => angDiff(a, b) > 0.9)) angles.push(a); }
    return angles;
  };
  const wavyRoad = (a, t0, t1, amp = 0.025) => {
    const pts = [], dx = Math.cos(a), dy = Math.sin(a), ph1 = rng() * 6.28, ph2 = rng() * 6.28;
    for (let t = t0; t <= t1; t += 0.08 * R) { const lat = amp * R * (Math.sin((t * 3.1) / R + ph1) + 0.6 * Math.sin((t * 7.3) / R + ph2)); pts.push([c0[0] + dx * t - dy * lat, c0[1] + dy * t + dx * lat]); }
    return pts;
  };
  const plazaPoly = (u0, v0, hu, hv, th, cutK = 0.3) => { const cu = Math.min(hu, hv) * cutK; return polyOut([[-hu + cu, -hv], [hu - cu, -hv], [hu, -hv + cu], [hu, hv - cu], [hu - cu, hv], [-hu + cu, hv], [-hu, hv - cu], [-hu, -hv + cu]].map(([u, v]) => rotP(u0 + u, v0 + v, th))); };

  // =====================================================================================================================
  // plans: each lays the plaza, streets and walls, and returns how the houses are packed (cfg) and what comes after
  // =====================================================================================================================
  const plans = {
    // ---- human: French radial ----
    radial() {
      out.pl.push(plazaPoly(0, 0, hs, hs, 0)); rectMark(c0[0], c0[1], 2 * hs, 2 * hs, 0, 4);
      label(tier === 1 ? 'The Green' : 'Market Square', c0[0], c0[1]);
      const angles = pickAngles(tier === 3 ? 5 : tier === 2 ? 4 : 3);
      const gates = [];
      for (const a of angles) { addStreet('main', wavyRoad(a, hs * 1.05, 1.3 * R), { suburb: true, crossRiver: true }); if (walled) gates.push([c0[0] + Math.cos(a) * Rw, c0[1] + Math.sin(a) * Rw]); }
      const ringF = tier === 3 ? [0.3, 0.55, 0.8] : tier === 2 ? [0.42, 0.78] : [0.62];
      const radii = [hs * 1.2, ...ringF.map((fr) => fr * Rin)];
      ringF.forEach((fr, ri) => {
        const r = fr * Rin, step = Math.max(0.1, 60 / r), a0 = rng() * 6.28;
        let pts = [];
        const flushRing = () => { addStreet(tier === 3 && ri < 2 ? 'street' : tier === 1 ? 'lane' : ri === 0 ? 'street' : 'lane', pts); pts = []; };
        for (let a = 0; a <= 6.2832 + step; a += step) {
          const rr = r * (1 + 0.05 * Math.sin(a * 3 + ph[0]) + 0.035 * Math.sin(a * 5 + ph[1]));
          pts.push(warp(c0[0] + Math.cos(a + a0) * rr, c0[1] + Math.sin(a + a0) * rr, 0.6));
          if (rng() < 0.012) flushRing();
        }
        flushRing();
      });
      for (let k = 0; k + 1 < radii.length; k++) {
        const nl = tier === 3 ? 9 : tier === 2 ? 6 : 3;
        for (let n = 0; n < nl; n++) {
          const a = rng() * 6.283, ra = radii[k], rb = radii[k + 1] * 1.02, pts = [];
          for (let t = 0; t <= 1.001; t += 0.25) { const rr = lerp(ra, rb, t), aa = a + 0.08 * Math.sin(t * 5 + n); pts.push(warp(c0[0] + Math.cos(aa) * rr, c0[1] + Math.sin(aa) * rr, 0.5)); }
          addStreet(k === 0 && tier > 1 ? 'street' : 'lane', pts);
        }
      }
      if (walled) {
        const loop = [], ph5 = rng() * 6.28;
        for (let a = 0; a <= 6.2832 + 0.05; a += 36 / Rw) { const rr = Rw * (1 + 0.035 * Math.sin(a * 4 + ph5) + 0.02 * Math.sin(a * 9 + ph5 * 2)); loop.push([c0[0] + Math.cos(a) * rr, c0[1] + Math.sin(a) * rr]); }
        addWall(loop, { gates, tr: tier === 3 ? 12 : 9, gateTr: tier === 3 ? 14 : 11 });
      }
      return {
        dim: () => [lerp(...(tier === 3 ? [16, 32] : tier === 2 ? [18, 36] : [22, 42]), rng()), 0], dd: () => lerp(...(tier === 3 ? [18, 30] : tier === 2 ? [20, 34] : [22, 38]), rng()),
        baseP: tier === 3 ? 0.93 : tier === 2 ? 0.82 : 0.6, rows: tier === 3 ? 3 : 2, gap: [1.5, 6.5], jitter: 0.06, setback: [3, 6], rowP: tier === 1 ? 0.45 : 0.85,
        infill: { tries: tier === 3 ? 14000 : tier === 2 ? 3500 : 500, p: 0.3, dist: 240 },
        after() {
          if (tier >= 2 || rng() < 0.6) civicSearch(tier === 3 ? 56 : tier === 2 ? 44 : 26, tier === 3 ? 100 : tier === 2 ? 72 : 40, hs * 1.6, 0.4 * Rin, 0, 'Temple', false);
          if (tier === 3 || walled || (tier === 2 && rng() < 0.3) || p.kind === 'fort') civicSearch(tier === 3 ? 110 : 70, tier === 3 ? 110 : 70, 0.5 * Rin, 0.8 * Rin, 1, 'Keep', true);
        },
      };
    },

    // ---- atma: Roman grid ----
    grid() {
      const angles = pickAngles(2, 1.2), th = angles[0] ?? rng() * 1.57;
      const B = tier === 3 ? 190 : tier === 2 ? 150 : 120, E0 = (walled ? Rw - 40 : R * 0.95), K = Math.max(1, Math.floor(E0 / B)), E = K * B + B / 2;
      const fh = B * 0.42;
      out.pl.push(plazaPoly(0, 0, fh, fh, th, 0.1)); rectMark(c0[0], c0[1], 2 * fh, 2 * fh, th, 4);
      label('Forum', c0[0], c0[1]);
      for (let k = -K; k <= K; k++) {
        const cls = k === 0 ? 'main' : tier === 1 ? 'lane' : 'street', ext = k === 0 ? 1.3 * R : E;
        addStreet(cls, [rotP(k * B, -ext, th), rotP(k * B, ext, th)], { suburb: k === 0, crossRiver: k === 0 });
        addStreet(cls, [rotP(-ext, k * B, th), rotP(ext, k * B, th)], { suburb: k === 0, crossRiver: k === 0 });
      }
      if (walled) {
        const W2 = E + 22, c = [rotP(-W2, -W2, th), rotP(W2, -W2, th), rotP(W2, W2, th), rotP(-W2, W2, th), rotP(-W2, -W2, th)];
        addWall(c, { gates: [rotP(W2, 0, th), rotP(-W2, 0, th), rotP(0, W2, th), rotP(0, -W2, th)], towerEvery: 4, tr: 11, gateTr: 14 });
        for (const q of c.slice(0, 4)) out.tw.push([r0(q[0]), r0(q[1]), 16]);
      }
      const blockAt = (w, d, kind, text, rmin, rmax) => {
        for (let t = 0; t < 60; t++) {
          const i = Math.floor(rng() * (2 * K + 2)) - K - 1, j = Math.floor(rng() * (2 * K + 2)) - K - 1, [x, y] = rotP((i + 0.5) * B, (j + 0.5) * B, th), rr = Math.hypot(x - c0[0], y - c0[1]);
          if (rr < rmin || rr > rmax || Math.abs((i + 0.5) * B) > E - B / 2 || Math.abs((j + 0.5) * B) > E - B / 2) continue;
          if (civicAt(x, y, w, d, th, kind, text, false)) return true;
        }
        return false;
      };
      return {
        dim: () => [lerp(18, 34, rng()), 0], dd: () => lerp(20, 30, rng()),
        baseP: 0.95, rows: tier === 3 ? 3 : 2, gap: [0.5, 2], jitter: 0, setback: [2, 3], rowP: 0.9, fall: 0.25, ok: (x, y, sub) => { const [u, v] = toUV(x, y, th); return Math.max(Math.abs(u), Math.abs(v)) < E + 8 || (sub && Math.hypot(x - c0[0], y - c0[1]) < 1.15 * R && !walled); },
        infill: { tries: tier === 3 ? 3000 : 800, p: 0.2, dist: 80, align: th },
        after() {
          const bw = B - 38;
          if (tier >= 2) blockAt(bw * 0.7, bw * 0.95, 0, 'Temple', fh * 1.2, E);
          if (tier >= 2) blockAt(bw * 0.9, bw * 0.6, 3, 'Baths', fh * 1.2, E);
          if (tier === 3) blockAt(bw, bw * 0.75, 2, 'Theatre', fh * 1.5, E);
          if (tier === 1) blockAt(bw * 0.6, bw * 0.8, 0, 'Shrine', fh * 1.2, E);
        },
      };
    },

    // ---- egyptian: Nile city ----
    nile() {
      // the avenue runs inland, away from the water if there is any
      let th = rng() * 6.283;
      if (river) { const sd = (c0[0] - river.p[0]) * river.t[1] - (c0[1] - river.p[1]) * river.t[0], s = sd >= 0 ? 1 : -1; th = Math.atan2(-s * river.t[0], s * river.t[1]); } // away from the river, on the side of the centre
      else if (coast) th = Math.atan2(-coast.n[1], -coast.n[0]);
      else { const a = pickAngles(1)[0]; if (a != null) th = a; }
      const L = Rin, tmpl = { w: tier === 3 ? 300 : tier === 2 ? 200 : 100, d: tier === 3 ? 480 : tier === 2 ? 300 : 160 };
      const tu = 0.58 * L; // centre of the temple along the avenue
      // plaza and avenue
      out.pl.push(plazaPoly(0, 0, hs * 1.7, hs * 1.1, th, 0.15)); rectMark(...rotP(0, 0, th), hs * 3.4, hs * 2.2, th, 4);
      label('Market Court', c0[0], c0[1] + hs * 1.6);
      addStreet('main', [rotP(-1.3 * R, 0, th), rotP(tu - tmpl.d / 2 - 20, 0, th)], { suburb: true, crossRiver: true });
      // sphinx avenue: a double row of small statues
      for (let u = hs * 1.9; u < tu - tmpl.d / 2 - 30; u += 30) for (const s of [-1, 1]) { const [x, y] = rotP(u, s * 24, th); out.tw.push([r0(x), r0(y), 3]); }
      // cross streets and lanes: a tidy lattice either side
      const Bu = tier === 3 ? 110 : 90, Bv = tier === 3 ? 84 : 70, nU = Math.floor((0.95 * L) / Bu), nV = Math.floor((0.85 * L) / Bv);
      for (let k = -nU; k <= nU; k++) if (k !== 0) { const u = k * Bu; if (u < tu - tmpl.d / 2 - 40) addStreet('street', [rotP(u, -0.85 * L, th), rotP(u, 0.85 * L, th)]); }
      for (let k = -nV; k <= nV; k++) if (k !== 0) addStreet('lane', [rotP(-0.95 * L, k * Bv, th), rotP(tu - tmpl.d / 2 - 30, k * Bv, th)]);
      // the temple: an enclosure with a pylon gate, a hall and a sanctuary
      const [tx, ty] = rotP(tu, 0, th);
      const corners = [rotP(tu - tmpl.d / 2, -tmpl.w / 2, th), rotP(tu + tmpl.d / 2, -tmpl.w / 2, th), rotP(tu + tmpl.d / 2, tmpl.w / 2, th), rotP(tu - tmpl.d / 2, tmpl.w / 2, th), rotP(tu - tmpl.d / 2, -tmpl.w / 2, th)];
      rectMark(tx, ty, tmpl.d + 16, tmpl.w + 16, th, 3);
      for (let i = 0; i < 4; i++) out.wl.push([12, ...polyOut([corners[i], corners[i + 1]])]);
      for (const s of [-1, 1]) { const [x, y] = rotP(tu - tmpl.d / 2, s * 34, th); out.tw.push([r0(x), r0(y), 14]); const [ox, oy] = rotP(tu - tmpl.d / 2 - 26, s * 16, th); out.tw.push([r0(ox), r0(oy), 4]); }
      out.civ.push([r0(tx + Math.cos(th) * tmpl.d * 0.12), r0(ty + Math.sin(th) * tmpl.d * 0.12), r0(tmpl.d * 0.5), r0(tmpl.w * 0.55), deg(th), 0]);
      out.civ.push([r0(tx + Math.cos(th) * tmpl.d * 0.34), r0(ty + Math.sin(th) * tmpl.d * 0.34), r0(tmpl.d * 0.18), r0(tmpl.w * 0.3), deg(th), 1]);
      label('Temple', tx, ty + tmpl.w / 2 + 16);
      if (walled) {
        const Wd = 0.95 * L, c = [rotP(-Wd, -Wd * 0.8, th), rotP(Wd, -Wd * 0.8, th), rotP(Wd, Wd * 0.8, th), rotP(-Wd, Wd * 0.8, th), rotP(-Wd, -Wd * 0.8, th)];
        addWall(c, { gates: [rotP(-Wd, 0, th), rotP(Wd, 0, th)], towerEvery: 5, tr: 10, gateTr: 14, thick: 9 });
      }
      const inside = (x, y) => { const [u, v] = toUV(x, y, th); return u > -1.0 * L && u < 1.0 * L && Math.abs(v) < 0.88 * L; };
      return {
        dim: () => [lerp(16, 26, rng()), 0], dd: () => lerp(20, 32, rng()), baseP: 0.95, rows: 3, gap: [0.5, 1.5], jitter: 0, setback: [2, 2], rowP: 0.92, fall: 0.2,
        ok: (x, y, sub) => (walled ? inside(x, y) && Math.hypot(x - c0[0], y - c0[1]) < 1.0 * L : Math.hypot(x - c0[0], y - c0[1]) < (sub ? 1.2 : 1.0) * R),
        infill: null,
        trees: { tries: tier === 3 ? 900 : tier === 2 ? 350 : 90, rmin: 0.1 * R, rmax: 1.15 * R, r: [6, 11], p: 0.6, kind: 1, nearWater: true },
      };
    },

    // ---- elf: golden-ratio spirals in the trees ----
    spiral() {
      const r0c = hs * 1.5;
      out.pl.push(polyOut(Array.from({ length: 16 }, (_, i) => [c0[0] + Math.cos((i / 16) * 6.2832) * hs * 1.35, c0[1] + Math.sin((i / 16) * 6.2832) * hs * 1.2])));
      stamp(c0[0], c0[1], hs * 1.4, 4);
      out.tr.push([r0(c0[0]), r0(c0[1]), r0(hs * 0.55), 2]); // the heart-tree
      label(tier === 1 ? 'The Glade' : 'The Glade', c0[0], c0[1] + hs * 1.8);
      const arms = tier === 3 ? 5 : tier === 2 ? 4 : 3, a0 = rng() * 6.283, dirSign = rng() < 0.5 ? 1 : -1;
      const thMax = (Math.PI / 2) * Math.log((1.25 * R) / r0c) / Math.log(PHI);
      const arm = (off, sign, cls, mod) => {
        const pts = [];
        for (let th = 0; th <= thMax; th += 0.1) {
          const rr = r0c * PHI ** (th / (Math.PI / 2)) * (1 + mod * Math.sin(th * 2.3 + off * 2));
          pts.push([c0[0] + Math.cos(a0 + off + sign * th) * rr, c0[1] + Math.sin(a0 + off + sign * th) * rr]);
        }
        addStreet(cls, pts, { suburb: true, limit: 1.25 });
      };
      for (let j = 0; j < arms; j++) arm((j / arms) * 6.2832, dirSign, 'street', 0.04);
      for (let j = 0; j < arms; j++) arm(((j + 0.5) / arms) * 6.2832, -dirSign, 'lane', 0.05);
      for (const a of pickAngles(tier === 3 ? 3 : 2)) addStreet('main', wavyRoad(a, hs * 1.5, 1.3 * R, 0.05), { suburb: true, crossRiver: true });
      // a living wall: a ring of trees
      for (let a = 0; a < 6.2832; a += 22 / (1.12 * R)) { const rr = 1.12 * R * (1 + 0.04 * Math.sin(a * 5 + ph[0])), x = c0[0] + Math.cos(a) * rr, y = c0[1] + Math.sin(a) * rr; if (!water(x, y)) out.tr.push([r0(x), r0(y), r0(8 + rng() * 8), 0]); }
      return {
        dim: () => { const w = lerp(26, 46, rng()); return [w, w / PHI]; }, dd: null, baseP: 0.62, rows: tier === 3 ? 2 : 1, gap: [8, 22], jitter: 0.12, setback: [9, 16], rowP: 0.5, fall: 0.3,
        ok: (x, y, sub) => Math.hypot(x - c0[0], y - c0[1]) < (sub ? 1.12 : 1.08) * R, infill: null,
        trees: { tries: tier === 3 ? 2400 : tier === 2 ? 900 : 220, rmin: 0.1 * R, rmax: 1.15 * R, r: [6, 18], p: 0.7, kind: 0 },
        after() { civicSearch(tier === 3 ? 90 : 62, (tier === 3 ? 90 : 62) / PHI, hs * 2, 0.5 * R, 2, 'Moon Hall', false, (a) => a + Math.PI / 2); if (tier >= 2) civicSearch(60, 60 / PHI, 0.4 * R, 0.8 * R, 2, 'Hall of Song', false, (a) => a + Math.PI / 2); },
      };
    },

    // ---- dwarf: art deco fan carved into the Stone ----
    fan() {
      let ax = pickAngles(1)[0]; if (ax == null) ax = rng() * 6.283;
      const S = (tier === 1 ? 75 : 80) * (Math.PI / 180), Rf = Rin;
      const forecourt = rotP(hs * 2.4, 0, ax);
      out.pl.push(polyOut(Array.from({ length: 8 }, (_, i) => { const a = ax + (i / 8) * 6.2832 + 0.3927; return [forecourt[0] + Math.cos(a) * hs * 1.25, forecourt[1] + Math.sin(a) * hs * 1.25]; })));
      stamp(forecourt[0], forecourt[1], hs * 1.3, 4);
      label('Hall Square', forecourt[0], forecourt[1]);
      // spokes at equal angles, arcs in thirds
      const nSp = tier === 3 ? 11 : tier === 2 ? 9 : 5, r1 = hs * 3.9;
      for (let i = 0; i < nSp; i++) {
        const a = ax - S + (2 * S * i) / (nSp - 1);
        addStreet(i === (nSp - 1) / 2 ? 'main' : 'street', [rotP(r1, 0, 0).map((_, k) => [c0[0] + Math.cos(a) * r1, c0[1] + Math.sin(a) * r1][k]), [c0[0] + Math.cos(a) * Rf, c0[1] + Math.sin(a) * Rf]], { suburb: false, limit: 1.4 });
      }
      for (const fr of tier === 1 ? [0.66, 1] : [1 / 3, 2 / 3, 1]) {
        const r = Math.max(r1 + 20, fr * Rf), pts = [];
        for (let a = -S; a <= S + 1e-6; a += 36 / r) pts.push([c0[0] + Math.cos(ax + a) * r, c0[1] + Math.sin(ax + a) * r]);
        addStreet(fr === 2 / 3 ? 'street' : 'lane', pts, { limit: 1.4 });
      }
      addStreet('main', [[c0[0] + Math.cos(ax) * Rf, c0[1] + Math.sin(ax) * Rf], [c0[0] + Math.cos(ax) * 1.3 * R, c0[1] + Math.sin(ax) * 1.3 * R]], { suburb: true, crossRiver: true });
      // the cliff walls and the great gate
      const Ro = Rf + 18, arcPts = [];
      for (let a = -S; a <= S + 1e-6; a += 36 / Ro) arcPts.push([c0[0] + Math.cos(ax + a) * Ro, c0[1] + Math.sin(ax + a) * Ro]);
      const gate = [c0[0] + Math.cos(ax) * Ro, c0[1] + Math.sin(ax) * Ro];
      if (tier >= 2) {
        addWall(arcPts, { gates: [gate], gap: 34, towerEvery: 6, tr: 13, gateTr: 20, thick: 14 });
        for (const s of [-1, 1]) addWall([[c0[0] + Math.cos(ax + s * S) * hs * 2, c0[1] + Math.sin(ax + s * S) * hs * 2], [c0[0] + Math.cos(ax + s * S) * Ro, c0[1] + Math.sin(ax + s * S) * Ro]], { towerEvery: 5, tr: 10, thick: 14 });
      } else { for (const s of [-1, 1]) out.tw.push([r0(gate[0] - Math.sin(ax) * 28 * s), r0(gate[1] + Math.cos(ax) * 28 * s), 12]); }
      const inFan = (x, y) => { const dx = x - c0[0], dy = y - c0[1], a = Math.atan2(dy, dx), r = Math.hypot(dx, dy); return angDiff(a, ax) <= S + 0.02 && r < Rf + 4 && r > hs * 2.2; };
      return {
        dim: () => [lerp(26, 50, rng()), 0], dd: () => lerp(24, 44, rng()), baseP: 0.9, rows: tier === 3 ? 3 : 2, gap: [3, 6], jitter: 0, setback: [3, 5], rowP: 0.85, fall: 0.2, mirror: ax,
        ok: (x, y) => inFan(x, y), infill: null,
        after() {
          // the great hall at the head of the avenue and a mirrored pair of halls
          const hw = tier === 3 ? 170 : tier === 2 ? 110 : 60;
          civicAt(c0[0] - Math.cos(ax) * hs * 0.6, c0[1] - Math.sin(ax) * hs * 0.6, hw, hw * 0.4, ax + Math.PI / 2, 3, 'Great Hall', false);
          for (const s of [-1, 1]) { const [x, y] = [c0[0] - Math.cos(ax) * hs * 0.6 + Math.cos(ax + Math.PI / 2) * (hw / 2) * s, c0[1] - Math.sin(ax) * hs * 0.6 + Math.sin(ax + Math.PI / 2) * (hw / 2) * s]; out.tw.push([r0(x), r0(y), 11]); }
          if (tier >= 2) for (const s of [-1, 1]) { const a = ax + s * 0.5, rr = 0.45 * Rf, x = c0[0] + Math.cos(a) * rr, y = c0[1] + Math.sin(a) * rr; civicAt(x, y, 70, 46, a + Math.PI / 2, 3, s === 1 ? 'Forge' : '', false); }
        },
      };
    },

    // ---- orc: brutalist slabs ----
    slab() {
      const a1 = pickAngles(1)[0] ?? 0, th = Math.round(a1 / (Math.PI / 2)) * (Math.PI / 2);
      const Pv = tier === 3 ? 90 : tier === 2 ? 80 : 70, Qu = tier === 3 ? 200 : tier === 2 ? 170 : 140, E = (walled ? Rw - 30 : R * 0.95);
      const ph2 = hs * 2.1;
      out.pl.push(plazaPoly(0, 0, ph2, ph2 * 0.75, th, 0)); rectMark(c0[0], c0[1], 2 * ph2, 1.5 * ph2, th, 4);
      label('Parade Ground', c0[0], c0[1]);
      const nV = Math.floor(E / Pv), nU = Math.floor(E / Qu);
      for (let k = -nV; k <= nV; k++) addStreet(k === 0 ? 'main' : 'street', [rotP(-(k === 0 ? 1.3 * R : E), k * Pv, th), rotP(k === 0 ? 1.3 * R : E, k * Pv, th)], { suburb: k === 0, crossRiver: k === 0 });
      for (let j = -nU; j <= nU; j++) addStreet(j === 0 ? 'main' : 'lane', [rotP(j * Qu, -(j === 0 ? 1.3 * R : E), th), rotP(j * Qu, j === 0 ? 1.3 * R : E, th)], { suburb: j === 0, crossRiver: j === 0 });
      if (walled) {
        const W2 = E + 30, c = [rotP(-W2, -W2, th), rotP(W2, -W2, th), rotP(W2, W2, th), rotP(-W2, W2, th), rotP(-W2, -W2, th)];
        addWall(c, { gates: [rotP(W2, 0, th), rotP(-W2, 0, th), rotP(0, W2, th), rotP(0, -W2, th)], towerEvery: 4, tr: 17, gateTr: 20, thick: 16, gap: 32 });
        for (const q of c.slice(0, 4)) out.tw.push([r0(q[0]), r0(q[1]), 26]);
      }
      return {
        dim: () => [lerp(60, 130, rng()), 0], dd: () => lerp(26, 38, rng()), baseP: 0.9, rows: 2, gap: [10, 16], jitter: 0, setback: [4, 4], rowP: 0.8, fall: 0.1,
        ok: (x, y, sub) => { const [u, v] = toUV(x, y, th); return walled ? Math.max(Math.abs(u), Math.abs(v)) < E - 40 : Math.hypot(x - c0[0], y - c0[1]) < (sub ? 1.15 : 1.0) * R; }, infill: null,
        after() { civicSearch(tier === 3 ? 150 : 100, tier === 3 ? 110 : 70, 0.4 * Rin, 0.75 * Rin, 1, 'Citadel', true, () => th); if (tier >= 2) civicSearch(120, 56, 0.3 * Rin, 0.8 * Rin, 3, 'Forge', false, () => th); },
      };
    },

    // ---- viking: ring fort, longhouses, boat sheds ----
    norse() {
      const th = coast ? Math.atan2(coast.t[1], coast.t[0]) : pickAngles(1)[0] ?? rng() * 6.283; // the houses run along the shore
      const e1 = [Math.cos(th), Math.sin(th)], e2 = [-Math.sin(th), Math.cos(th)];
      const Rr = tier === 3 ? 0.42 * R : tier === 2 ? 0.34 * R : 0; // a Trelleborg ring fort with four gates
      out.pl.push(plazaPoly(0, 0, hs * 0.9, hs * 0.9, th, 0.3)); rectMark(c0[0], c0[1], 1.8 * hs, 1.8 * hs, th, 4);
      label(tier === 1 ? 'The Hall Yard' : 'Hall Yard', c0[0], c0[1] + hs * 1.2);
      addStreet('main', [rotP(-1.3 * R, 0, th), rotP(1.3 * R, 0, th)], { suburb: true, crossRiver: true });
      addStreet(Rr ? 'main' : 'street', [rotP(0, -(Rr ? 1.0 : 0.6) * R, th), rotP(0, (Rr ? 1.0 : 0.6) * R, th)], { suburb: Rr > 0 });
      if (Rr) {
        const loop = []; for (let a = 0; a <= 6.2832 + 0.05; a += 30 / Rr) loop.push([c0[0] + Math.cos(a) * Rr, c0[1] + Math.sin(a) * Rr]);
        addWall(loop, { gates: [0, 1, 2, 3].map((k) => rotP(Rr * Math.cos((k * Math.PI) / 2), Rr * Math.sin((k * Math.PI) / 2), th)), gap: 20, towerEvery: 0, gateTr: 9, thick: 14 });
        // each quarter holds four longhouses turned about a yard, the pinwheel of Trelleborg
        const groups = [[0.58, Math.PI / 4]]; if (tier === 3) groups.push([0.86, Math.PI / 4 + 0.32], [0.86, Math.PI / 4 - 0.32]);
        for (const [fr, off] of groups) for (let k = 0; k < 4; k++) {
          const a = off + (k * Math.PI) / 2, qc = [c0[0] + Math.cos(a + th) * fr * Rr, c0[1] + Math.sin(a + th) * fr * Rr], L = lerp(64, 86, rng()), g = 8, d = 22;
          for (const [dx, dy, ang] of [[e2[0] * (L / 2 + g), e2[1] * (L / 2 + g), th], [-e2[0] * (L / 2 + g), -e2[1] * (L / 2 + g), th], [e1[0] * (L / 2 + g), e1[1] * (L / 2 + g), th + Math.PI / 2], [-e1[0] * (L / 2 + g), -e1[1] * (L / 2 + g), th + Math.PI / 2]]) {
            if (rectFree(qc[0] + dx, qc[1] + dy, L, d, ang, 2) && !water(qc[0] + dx, qc[1] + dy)) { rectMark(qc[0] + dx, qc[1] + dy, L, d, ang, 3); out.b.push([r0(qc[0] + dx), r0(qc[1] + dy), r0(L), d, deg(ang), 0]); }
          }
        }
      }
      // farm lanes: a ring road round the fort and spurs out to the farmsteads
      if (tier >= 2) {
        const rr = (Rr ? 1.45 * Rr : 0.6 * R); let pts = [];
        const flushRing = () => { addStreet('lane', pts); pts = []; };
        for (let a = 0; a <= 6.2832 + 0.1; a += 0.12) { const r = rr * (1 + 0.06 * Math.sin(a * 3 + ph[0])); pts.push([c0[0] + Math.cos(a) * r, c0[1] + Math.sin(a) * r]); if (rng() < 0.03) flushRing(); }
        flushRing();
        const nSp = tier === 3 ? 8 : 5;
        for (let k = 0; k < nSp; k++) { const a = rng() * 6.283, pts2 = [], r1 = rr * 0.95; for (let t = 0; t <= 4; t++) { const r = lerp(r1, 1.05 * R, t / 4), aa = a + 0.05 * Math.sin(t * 2 + k); pts2.push([c0[0] + Math.cos(aa) * r, c0[1] + Math.sin(aa) * r]); } addStreet('lane', pts2); }
      }
      // the Thing: a ring of standing stones
      { const [tx, ty] = rotP(Rr ? 1.22 * Rr : hs * 3, Rr ? 0.5 * Rr : hs * 2, th); for (let i = 0; i < 9; i++) { const a = (i / 9) * 6.2832; out.tw.push([r0(tx + Math.cos(a) * 34), r0(ty + Math.sin(a) * 34), 3]); } label('Thing', tx, ty + 52); stamp(tx, ty, 40, 4); }
      return {
        dim: () => [lerp(54, 96, rng()), 0], dd: () => lerp(17, 24, rng()), baseP: tier === 1 ? 0.6 : 0.8, rows: 1, gap: [8, 22], jitter: 0.1, setback: [12, 26], rowP: 0, fall: 0.35,
        ok: (x, y, sub) => { const rr = Math.hypot(x - c0[0], y - c0[1]); return rr > (Rr ? Rr + 28 : hs * 2) && rr < (sub ? 1.2 : 1.1) * R; },
        infill: { tries: tier === 3 ? 3500 : tier === 2 ? 1400 : 300, p: 0.4, dist: 160, dim: () => [lerp(12, 22, rng()), lerp(12, 18, rng())] },
        after() {
          civicAt(c0[0] + e2[0] * hs * 1.7, c0[1] + e2[1] * hs * 1.7, tier === 3 ? 130 : tier === 2 ? 100 : 80, 34, th, 0, 'Great Hall', false);
          if (coast) { // boat sheds along the shore
            const s0 = (c0[0] - coast.p[0]) * coast.n[0] + (c0[1] - coast.p[1]) * coast.n[1], foot = [c0[0] - coast.n[0] * s0, c0[1] - coast.n[1] * s0], ang = Math.atan2(coast.t[1], coast.t[0]);
            if (-s0 < 0.9 * R) for (let t = -0.6 * R; t <= 0.6 * R; t += 58) {
              const x = foot[0] + coast.t[0] * t - coast.n[0] * 22, y = foot[1] + coast.t[1] * t - coast.n[1] * 22, w = lerp(32, 46, rng());
              if (rng() < 0.8 && !water(x, y) && rectFree(x, y, w, 14, ang, 1)) { rectMark(x, y, w, 14, ang, 3); out.b.push([r0(x), r0(y), r0(w), 14, deg(ang), 2]); }
            }
          }
        },
      };
    },

    // ---- gnome / halfling: burrows, winding lanes, gardens ----
    burrow() {
      out.pl.push(polyOut(Array.from({ length: 12 }, (_, i) => { const a = (i / 12) * 6.2832, rr = hs * (1.15 + 0.25 * Math.sin(i * 2.1 + ph[0])); return [c0[0] + Math.cos(a) * rr, c0[1] + Math.sin(a) * rr]; })));
      stamp(c0[0], c0[1], hs * 1.1, 4);
      out.tr.push([r0(c0[0]), r0(c0[1]), r0(hs * 0.45), 2]);
      label('The Green', c0[0], c0[1] + hs * 1.6);
      const nL = tier === 3 ? 9 : tier === 2 ? 7 : 4, a0 = rng() * 6.283;
      for (let i = 0; i < nL; i++) {
        let a = a0 + (i / nL) * 6.2832 + (rng() - 0.5) * 0.4, x = c0[0] + Math.cos(a) * hs * 1.2, y = c0[1] + Math.sin(a) * hs * 1.2;
        const pts = [[x, y]], drift = (rng() - 0.5) * 0.18;
        for (let s = 0; s < 40; s++) { a += drift + (rng() - 0.5) * 0.4; x += Math.cos(a) * 45; y += Math.sin(a) * 45; pts.push([x, y]); if (Math.hypot(x - c0[0], y - c0[1]) > 1.1 * R) break; }
        addStreet(i % 3 === 0 ? 'street' : 'lane', pts, { limit: 1.15 });
      }
      if (tier >= 2) { let pts = []; const flushR = () => { addStreet('lane', pts); pts = []; }; for (let a = 0; a <= 6.2832 + 0.1; a += 0.12) { const rr = 0.55 * R * (1 + 0.1 * Math.sin(a * 3 + ph[0]) + 0.06 * Math.sin(a * 7 + ph[1])); pts.push([c0[0] + Math.cos(a) * rr, c0[1] + Math.sin(a) * rr]); if (rng() < 0.03) flushR(); } flushR(); }
      for (const a of pickAngles(tier === 3 ? 4 : 3)) addStreet('main', wavyRoad(a, hs * 1.3, 1.3 * R, 0.05), { suburb: true, crossRiver: true });
      return {
        dim: () => { const w = lerp(15, 30, rng()); return [w, w]; }, dd: null, baseP: 0.8, rows: tier === 3 ? 2 : 1, gap: [8, 18], jitter: 0.4, setback: [7, 15], rowP: 0.5, fall: 0.3,
        ok: (x, y, sub) => Math.hypot(x - c0[0], y - c0[1]) < (sub ? 1.2 : 1.08) * R,
        infill: { tries: tier === 3 ? 2600 : tier === 2 ? 900 : 200, p: 0.35, dist: 130 },
        post() { // every burrow has its garden
          for (const [x, y, w] of out.b.slice()) {
            if (rng() > 0.65) continue;
            const a = rng() * 6.283, r = lerp(8, 16, rng()), gx = x + Math.cos(a) * (w / 2 + r + 3), gy = y + Math.sin(a) * (w / 2 + r + 3);
            if (rectFree(gx, gy, 2 * r, 2 * r, 0, 1)) { stamp(gx, gy, r, 6); out.tr.push([r0(gx), r0(gy), r0(r), 3]); }
          }
        },
        after() { civicSearch(40, 28, hs * 1.8, 0.4 * R, 1, 'Mill House', false, () => rng() * 3.14); },
        trees: { tries: tier === 3 ? 500 : tier === 2 ? 200 : 60, rmin: 0.3 * R, rmax: 1.1 * R, r: [6, 12], p: 0.6, kind: 0 },
      };
    },

    // ---- minotaur: a labyrinth city ----
    maze() {
      const P = tier === 1 ? 20 : 24, Rl = 0.95 * R, m = 2 * Math.floor(Rl / P / 2), S = 2 * m + 1, c = tier === 3 ? 5 : tier === 2 ? 3 : 1;
      const st = new Uint8Array(S * S); // 0 outside, 1 block, 2 passage, 3 palace
      const id = (i, j) => (j + m) * S + (i + m);
      const cellXY = (i, j) => [c0[0] + i * P, c0[1] + j * P];
      for (let j = -m; j <= m; j++) for (let i = -m; i <= m; i++) { const [x, y] = cellXY(i, j); if (Math.hypot(i * P, j * P) <= Rl && !water(x, y)) st[id(i, j)] = 1; }
      const inPalace = (i, j) => Math.abs(i) <= c + 2 && Math.abs(j) <= c + 2;
      for (let j = -c - 2; j <= c + 2; j++) for (let i = -c - 2; i <= c + 2; i++) if (st[id(i, j)]) st[id(i, j)] = Math.abs(i) <= c && Math.abs(j) <= c ? 2 : 3;
      // carve: depth-first on the even lattice, then the avenues, a ring road, and a few loops
      const si = c + 3 + ((c + 3) % 2), stack = [[si, 0]];
      if (st[id(si, 0)] === 1) st[id(si, 0)] = 2;
      while (stack.length) {
        const [i, j] = stack[stack.length - 1], opts = [[2, 0], [-2, 0], [0, 2], [0, -2]].filter(([di, dj]) => { const a = i + di, b = j + dj; return Math.abs(a) <= m && Math.abs(b) <= m && st[id(a, b)] === 1; });
        if (!opts.length) { stack.pop(); continue; }
        const [di, dj] = opts[Math.floor(rng() * opts.length)];
        if (st[id(i + di / 2, j + dj / 2)] === 1 || st[id(i + di / 2, j + dj / 2)] === 2) { st[id(i + di / 2, j + dj / 2)] = 2; st[id(i + di, j + dj)] = 2; stack.push([i + di, j + dj]); } else { st[id(i + di, j + dj)] = 2; }
      }
      for (let k = -m; k <= m; k++) for (const [i, j] of [[k, 0], [0, k]]) if (!inPalace(i, j) && st[id(i, j)] === 1) st[id(i, j)] = 2;
      if (tier >= 2) for (let j = -m; j <= m; j++) for (let i = -m; i <= m; i++) { const rr = Math.hypot(i * P, j * P); if (st[id(i, j)] === 1 && Math.abs(rr - 0.93 * Rl) < P * 0.6) st[id(i, j)] = 2; }
      for (let j = -m + 1; j < m; j++) for (let i = -m + 1; i < m; i++) { if (st[id(i, j)] !== 1 || (i + j) % 2 === 0) continue; const h = st[id(i - 1, j)] === 2 && st[id(i + 1, j)] === 2, v = st[id(i, j - 1)] === 2 && st[id(i, j + 1)] === 2; if ((h || v) && rng() < 0.07) st[id(i, j)] = 2; }
      // blocks become buildings, merged along a row
      for (let j = -m; j <= m; j++) {
        let i = -m;
        while (i <= m) {
          if (st[id(i, j)] !== 1) { i++; continue; }
          let k = i; while (k + 1 <= m && st[id(k + 1, j)] === 1 && k + 1 - i < 6) k++;
          const [x, y] = cellXY((i + k) / 2, j);
          out.b.push([r0(x), r0(y), r0((k - i + 1) * P - 3), P - 3, 0, r0(rng() * 2.99)]);
          i = k + 1;
        }
      }
      // floor of the labyrinth, palace court and wings
      out.pl.push(polyOut(Array.from({ length: 40 }, (_, k) => [c0[0] + Math.cos((k / 40) * 6.2832) * (Rl + P * 0.7), c0[1] + Math.sin((k / 40) * 6.2832) * (Rl + P * 0.7)])));
      out.pl.push(plazaPoly(0, 0, (c + 0.5) * P, (c + 0.5) * P, 0, 0));
      const wing = (u, v, w, d) => { const [x, y] = cellXY(u, v); out.civ.push([r0(x), r0(y), r0(w * P - 4), r0(d * P - 4), 0, 3]); };
      wing(0, c + 1.5, 2 * c + 5, 2); wing(0, -(c + 1.5), 2 * c + 5, 2); wing(-(c + 1.5), 0, 2, 2 * c + 1); wing(c + 1.5, 0, 2, 2 * c + 1);
      label('The Palace', c0[0], c0[1]); label('The Labyrinth', c0[0], c0[1] - 0.45 * R);
      if (tier >= 2) { const loop = []; for (let a = 0; a <= 6.2832 + 0.05; a += 36 / (Rl + P)) loop.push([c0[0] + Math.cos(a) * (Rl + P), c0[1] + Math.sin(a) * (Rl + P)]); addWall(loop, { gates: [0, 1, 2, 3].map((k) => [c0[0] + Math.cos((k * Math.PI) / 2) * (Rl + P), c0[1] + Math.sin((k * Math.PI) / 2) * (Rl + P)]), gap: 24, towerEvery: 9, tr: 12, gateTr: 15, thick: 10 }); }
      for (let k = 0; k < 4; k++) addStreet('main', [[c0[0] + Math.cos((k * Math.PI) / 2) * (Rl + P * 1.5), c0[1] + Math.sin((k * Math.PI) / 2) * (Rl + P * 1.5)], [c0[0] + Math.cos((k * Math.PI) / 2) * 1.3 * R, c0[1] + Math.sin((k * Math.PI) / 2) * 1.3 * R]], { suburb: true, crossRiver: true });
      return { custom: true, fill() {} };
    },

    // ---- goblin: haphazard ----
    wander() {
      const blob = Array.from({ length: 9 }, (_, i) => { const a = (i / 9) * 6.2832, rr = hs * (0.5 + rng() * 0.6); return [c0[0] + Math.cos(a) * rr, c0[1] + Math.sin(a) * rr]; });
      out.pl.push(polyOut(blob)); stamp(c0[0], c0[1], hs * 0.55, 4);
      label('The Pit', c0[0], c0[1]);
      const trunks = tier === 3 ? 7 : tier === 2 ? 5 : 3, angles = pickAngles(2, 0.6);
      const walk = (x, y, a, depth, cls) => {
        const pts = [[x, y]], segs = 5 + Math.floor(rng() * 5);
        for (let s = 0; s < segs; s++) {
          a += (rng() - 0.5) * 1.2; const L = lerp(35, 90, rng()); x += Math.cos(a) * L; y += Math.sin(a) * L; pts.push([x, y]);
          if (Math.hypot(x - c0[0], y - c0[1]) > 1.1 * R) break;
          if (depth < 2 && rng() < 0.16) walk(x, y, a + (rng() < 0.5 ? 1 : -1) * lerp(0.6, 1.4, rng()), depth + 1, 'lane');
        }
        addStreet(cls, pts, { limit: 1.15 });
      };
      const a0w = rng() * 6.283;
      for (let i = 0; i < trunks; i++) walk(c0[0], c0[1], a0w + (i / trunks) * 6.283 + (rng() - 0.5) * 0.7, 0, rng() < 0.4 ? 'street' : 'lane');
      for (const a of angles) addStreet('main', wavyRoad(a, hs * 0.6, 1.3 * R, 0.07), { suburb: true, crossRiver: true });
      // a broken palisade
      { let run = []; const flush = () => { if (run.length >= 2) out.wl.push([4, ...run.flat().map(r0)]); run = []; };
        const phA = rng() * 6.28, phB = rng() * 6.28;
        for (let a = 0; a < 6.2832; a += 30 / (0.98 * R)) { const rr = 0.98 * R * (1 + 0.05 * Math.sin(a * 6 + phA) + 0.03 * Math.sin(a * 13 + phB) + (rng() - 0.5) * 0.02), q = [c0[0] + Math.cos(a) * rr, c0[1] + Math.sin(a) * rr]; if (water(q[0], q[1]) || rng() < 0.3) { flush(); continue; } run.push(q); stamp(q[0], q[1], 4, 5); if (rng() < 0.05) out.tw.push([r0(q[0]), r0(q[1]), 5]); } flush(); }
      return {
        custom: true,
        after() { civicSearch(tier === 3 ? 56 : 40, tier === 3 ? 40 : 30, hs * 1.4, 0.4 * R, 1, "Chieftain's Hall", false, () => rng() * 3.14); },
        fill() { // heaps of huts at every angle
          const heaps = tier === 3 ? 60 : tier === 2 ? 34 : 12, per = tier === 3 ? [16, 46] : tier === 2 ? [12, 34] : [7, 18];
          for (let h = 0; h < heaps; h++) {
            const a = rng() * 6.283, rr = Math.sqrt(rng()) * 0.95 * R; let hx = c0[0] + Math.cos(a) * rr, hy = c0[1] + Math.sin(a) * rr;
            if (streets.length && rng() < 0.75) { const st = streets[Math.floor(rng() * streets.length)], q = st.pts[Math.floor(rng() * st.pts.length)]; hx = q[0]; hy = q[1]; }
            const sig = lerp(25, 70, rng()), n = Math.floor(lerp(per[0], per[1], rng()));
            for (let i = 0; i < n; i++) {
              const gx = hx + (rng() + rng() + rng() - 1.5) * 2 * sig, gy = hy + (rng() + rng() + rng() - 1.5) * 2 * sig, w = lerp(11, 34, rng() * rng() + 0.1), d = lerp(10, 28, rng()), ang = rng() * 3.1416;
              if (Math.hypot(gx - c0[0], gy - c0[1]) > R * 1.02 || !rectFree(gx, gy, w, d, ang, 1)) continue;
              rectMark(gx, gy, w, d, ang, 3); out.b.push([r0(gx), r0(gy), r0(w), r0(d), deg(ang), r0(rng() * 2.99)]);
            }
          }
        },
      };
    },
  };

  // ---------- the plan, then everything shared: harbour, streets stamped, river, houses ----------
  const cfg = plans[style]();

  // harbour: a street along the shore, a quay and piers
  if (coast) {
    const s0 = (c0[0] - coast.p[0]) * coast.n[0] + (c0[1] - coast.p[1]) * coast.n[1]; // negative = inland
    const foot = [c0[0] - coast.n[0] * s0, c0[1] - coast.n[1] * s0];
    if (-s0 < 0.9 * R) {
      const L = 0.65 * R, pts = [];
      for (let t = -L; t <= L; t += 50) pts.push([foot[0] + coast.t[0] * t - coast.n[0] * 30, foot[1] + coast.t[1] * t - coast.n[1] * 30]);
      addStreet('street', pts);
      const ang = Math.atan2(coast.t[1], coast.t[0]);
      out.dk.push([r0(foot[0] - coast.n[0] * 6), r0(foot[1] - coast.n[1] * 6), r0(1.1 * L), 12, deg(ang), 0]);
      const np = tier === 3 ? 6 : tier === 2 ? 3 : 1;
      for (let k = 0; k < np; k++) {
        const t = np === 1 ? 0 : lerp(-0.7 * L, 0.7 * L, k / (np - 1)) + (rng() - 0.5) * 20, len = lerp(40, 90, rng());
        out.dk.push([r0(foot[0] + coast.t[0] * t + coast.n[0] * (len / 2 - 6)), r0(foot[1] + coast.t[1] * t + coast.n[1] * (len / 2 - 6)), 12, r0(len), deg(ang), 1]);
      }
      label('Harbour', foot[0] + coast.n[0] * 70, foot[1] + coast.n[1] * 70);
    }
  }
  for (const s of streets) { for (let i = 0; i < s.pts.length - 1; i++) { const [ax, ay] = s.pts[i], [bx, by] = s.pts[i + 1], L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / 3)); for (let k = 0; k <= n; k++) stamp(lerp(ax, bx, k / n), lerp(ay, by, k / n), s.w / 2 + 1, 2); } }
  // bridges where a main road crosses the river, and the river as a band
  if (river) {
    for (const s of streets) if (s.cls === 'main') for (let i = 0; i < s.pts.length - 1; i++) {
      const sd = (q) => (q[0] - river.p[0]) * river.t[1] - (q[1] - river.p[1]) * river.t[0], s1 = sd(s.pts[i]), s2 = sd(s.pts[i + 1]);
      if (s1 * s2 < 0 || (Math.abs(s1) < river.W / 2 && Math.abs(s2) < river.W / 2)) { const m = [(s.pts[i][0] + s.pts[i + 1][0]) / 2, (s.pts[i][1] + s.pts[i + 1][1]) / 2]; if (riverDist(m[0], m[1]) < river.W) { out.br.push([r0(m[0]), r0(m[1]), r0(river.W + 44), 32, deg(Math.atan2(s.pts[i + 1][1] - s.pts[i][1], s.pts[i + 1][0] - s.pts[i][0])), 0]); break; } }
    }
    const L = 1.6 * R, a = [river.p[0] - river.t[0] * L * 2, river.p[1] - river.t[1] * L * 2], b = [river.p[0] + river.t[0] * L * 2, river.p[1] + river.t[1] * L * 2], nx = (-river.t[1] * river.W) / 2, ny = (river.t[0] * river.W) / 2;
    out.wa.push([a[0] + nx, a[1] + ny, b[0] + nx, b[1] + ny, b[0] - nx, b[1] - ny, a[0] - nx, a[1] - ny].map(r0));
  }

  cfg.after?.();
  if (p.source === 'ruin-site') label(p.name, c0[0], c0[1] - 0.25 * R);

  // houses: rows along every street (or the style's own fill)
  const dimsOf = () => { const [w, d] = cfg.dim(); return [w, d || (cfg.dd ? cfg.dd() : w * 0.8)]; };
  const dflt = (x, y, sub) => { const rr = Math.hypot(x - c0[0], y - c0[1]); return walled ? rr < Rw - 18 || (sub && rr > Rw + 18 && rr < 1.2 * R) : rr <= (sub ? 1.22 : 1.1) * R; };
  const ok = cfg.ok || dflt;
  const pFill = (x, y, sub) => { const rr = Math.hypot(x - c0[0], y - c0[1]) / R; return cfg.baseP * (1 - (cfg.fall ?? 0.45) * Math.min(1, rr * rr)) * (walled && rr > 0.9 && !cfg.ok ? 0.5 : 1) * (sub && rr > 0.95 ? 0.7 : 1); };
  const place = (x, y, w, d, a, nx, ny, sub, queue, force = false) => {
    if (!ok(x, y, sub) || (!force && rng() > pFill(x, y, sub)) || !rectFree(x, y, w, d, a)) return false;
    rectMark(x, y, w, d, a, 3);
    out.b.push([r0(x), r0(y), r0(w), r0(d), deg(a), r0(rng() * 2.99)]);
    queue.push({ x, y, a, nx, ny, d, sub });
    return true;
  };
  // mirrored placement for the dwarf fan: only the left of the axis is searched, each house gets its twin
  const placeSym = (x, y, w, d, a, nx, ny, sub, queue) => {
    const [, v] = toUV(x, y, cfg.mirror);
    if (v < -2) return;
    if (!place(x, y, w, d, a, nx, ny, sub, queue)) return;
    if (Math.abs(v) < 2) return;
    const [u, vv] = toUV(x, y, cfg.mirror), [mx, my] = rotP(u, -vv, cfg.mirror), ma = 2 * cfg.mirror - a, [mnx, mny] = [nx, ny];
    place(mx, my, w, d, ma, mnx, mny, sub, queue, true);
  };
  if (cfg.custom) cfg.fill();
  else {
    const put = cfg.mirror != null ? placeSym : place;
    let row = [];
    for (const s of streets) {
      const cum = [0];
      for (let i = 1; i < s.pts.length; i++) cum.push(cum[i - 1] + Math.hypot(s.pts[i][0] - s.pts[i - 1][0], s.pts[i][1] - s.pts[i - 1][1]));
      const L = cum[cum.length - 1];
      const at = (t) => { let i = 1; while (i < cum.length - 1 && cum[i] < t) i++; const u = (t - cum[i - 1]) / (cum[i] - cum[i - 1] || 1), a = s.pts[i - 1], b = s.pts[i], len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return { x: lerp(a[0], b[0], u), y: lerp(a[1], b[1], u), tx: (b[0] - a[0]) / len, ty: (b[1] - a[1]) / len }; };
      for (const side of [1, -1]) {
        let t = rng() * 8;
        while (t < L) {
          const [bw, bd] = dimsOf(), q = at(Math.min(L, t + bw / 2));
          const nx = -q.ty * side, ny = q.tx * side, off = s.w / 2 + bd / 2 + lerp(cfg.setback[0], cfg.setback[1], rng());
          put(q.x + nx * off, q.y + ny * off, bw, bd, Math.atan2(q.ty, q.tx) + (rng() - 0.5) * cfg.jitter, nx, ny, s.suburb, row);
          t += bw + lerp(cfg.gap[0], cfg.gap[1], rng());
        }
      }
    }
    for (let rIdx = 1; rIdx < cfg.rows; rIdx++) {
      const next = [];
      for (const q of row) {
        const [bw, bd] = dimsOf();
        if (rng() < cfg.rowP) put(q.x + q.nx * (q.d / 2 + bd / 2 + 2.5), q.y + q.ny * (q.d / 2 + bd / 2 + 2.5), bw, bd, q.a, q.nx, q.ny, q.sub, next);
      }
      row = next;
    }
    // backyards: fill the middle of the blocks, houses turned to the nearest street
    if (cfg.infill) {
      const bucket = new Map(), BK = 170;
      for (const s of streets) for (let i = 0; i < s.pts.length - 1; i++) {
        const [ax, ay] = s.pts[i], [bx, by] = s.pts[i + 1], L = Math.hypot(bx - ax, by - ay) || 1, n = Math.max(1, Math.ceil(L / 25));
        for (let k = 0; k < n; k++) { const x = lerp(ax, bx, k / n), y = lerp(ay, by, k / n), key = Math.floor(x / BK) + ',' + Math.floor(y / BK); (bucket.get(key) || bucket.set(key, []).get(key)).push([x, y, (bx - ax) / L, (by - ay) / L]); }
      }
      const lim = (walled ? Rw : 1.1 * R) - 18;
      for (let n = 0; n < cfg.infill.tries; n++) {
        const rr = Math.sqrt(rng()) * lim, a = rng() * 6.283, x = c0[0] + Math.cos(a) * rr, y = c0[1] + Math.sin(a) * rr;
        let best = null, bd = 1e9;
        const kx = Math.floor(x / BK), ky = Math.floor(y / BK);
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) for (const q of bucket.get((kx + dx) + ',' + (ky + dy)) || []) { const d = Math.hypot(q[0] - x, q[1] - y); if (d < bd) { bd = d; best = q; } }
        if (!best || bd > cfg.infill.dist) continue;
        const [w, d] = cfg.infill.dim ? cfg.infill.dim() : dimsOf(), ang = cfg.infill.align ?? (Math.atan2(best[3], best[2]) + (rng() - 0.5) * 0.1);
        if (rng() < cfg.infill.p) place(x, y, w, d, ang, 0, 0, false, []);
      }
    }
  }
  cfg.post?.();
  // trees (groves, palms)
  if (cfg.trees) {
    const t = cfg.trees;
    for (let n = 0; n < t.tries; n++) {
      const rr = lerp(t.rmin, t.rmax, Math.sqrt(rng())), a = rng() * 6.283, x = c0[0] + Math.cos(a) * rr, y = c0[1] + Math.sin(a) * rr, r = lerp(t.r[0], t.r[1], rng());
      if (rng() > t.p || !rectFree(x, y, 2 * r, 2 * r, 0, 1)) continue;
      if (t.nearWater && river && riverDist(x, y) > 0.35 * R && rng() < 0.7) continue;
      stamp(x, y, r, 6); out.tr.push([r0(x), r0(y), r0(r), t.kind]);
    }
  }

  if (ruinTier) { // a ruin: most houses gone, walls in pieces, towers fallen
    out.b = out.b.filter(() => rng() < 0.32);
    out.tw = out.tw.filter(() => rng() < 0.5);
    out.wl = out.wl.flatMap(([thick, ...c]) => { const pieces = []; for (let i = 0; i + 3 < c.length; i += 8) if (rng() < 0.5) pieces.push([thick, ...c.slice(i, i + 8)]); return pieces; });
  }
  const rec = { x: +cx.toFixed(3), y: +cy.toFixed(3), t: tier, s: style, ...(ruinTier ? { ru: 1 } : {}), r: r0(R), st: streets.map((s) => [s.cls === 'main' ? 0 : s.cls === 'street' ? 1 : 2, s.pts.flat().map(r0)]), b: out.b, civ: out.civ, pl: out.pl, wl: out.wl, tw: out.tw, wa: out.wa, dk: out.dk, br: out.br, tr: out.tr, lb: out.lb };
  return { rec, stats: { b: out.b.length, st: streets.length, coast: !!coast, river: !!river, walled, race, style, ...note } };
}

const places = rd('places.geojson').features;
const ll = ([x, y]) => [(x - 512) / 51.2, (512 - y) / 51.2];
for (const s of styles.ruinSites || []) places.push({ type: 'Feature', properties: { name: s.name, kind: 'ruin', source: 'ruin-site', editKey: 'ruin-site:' + s.name }, geometry: { type: 'Point', coordinates: ll(s.at) } });
const todo = places.filter((f) => KINDS.has(f.properties.kind) || styles.ruins?.[f.properties.name]);
const towns = {}, skipped = [], moved = [], byRace = {};
let total = { b: 0 };
for (const f of todo) {
  const res = layoutTown(f, places);
  if (res.skip) { skipped.push(`${f.properties.name}: ${res.skip}`); continue; }
  const key = f.properties.editKey || `${f.properties.source}:${f.properties.name}`;
  towns[key] = { n: f.properties.name, ...res.rec };
  total.b += res.stats.b;
  (byRace[res.stats.race] ||= []).push(f.properties.name);
  if (res.stats.moved) moved.push(`${f.properties.name}: pin was ${res.stats.moved} mi off the coast, plan placed on the shore`);
}
const NOTE = 'Street plans: local frame in feet (x east, y north) around the world-px point (x, y). Generated by tools/towns.mjs.';
fs.writeFileSync(path.join(dataDir, 'towns.json'), JSON.stringify({ note: NOTE, ft: FT, towns }));
console.log(`towns ${Object.keys(towns).length}, buildings ${total.b}, file ${(fs.statSync(path.join(dataDir, 'towns.json')).size / 1e6).toFixed(2)} MB`);
for (const [r, names] of Object.entries(byRace)) console.log(`  ${r.padEnd(9)} ${names.length}: ${r === 'human' ? names.slice(0, 6).join(', ') + ', ...' : names.join(', ')}`);
if (moved.length) console.log('moved onto the shore:\n  ' + moved.join('\n  '));
if (skipped.length) console.log('skipped:\n  ' + skipped.join('\n  '));
