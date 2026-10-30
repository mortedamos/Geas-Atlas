// Berhagen (Wonderdraft) -> terrain areas, rivers, lake, roads, places and labels for the atlas, all in canvas px (source/berhagen.json).
//  - terrain: each kind of symbol (mountains, hills, trees, marsh grass) is turned into areas by drawing a disc round every symbol
//    and tracing the outline of the union;
//  - rivers: the mask's red channel holds the rivers (thin lines, kept where the mask is land); they are thinned to a centre line and
//    traced into segments between junctions and ends;
//  - roads are the map's dashed paths; towns sit on the town symbols.
// usage: node bh_features.mjs [--write]
import fs from 'node:fs';
import { contours } from 'd3-contour';
import * as turf from '@turf/turf';
import { readGcpf } from './wd_read.mjs';
import { decodeVariant } from './godot_var.mjs';

const F = 'source/berhagen.json';
const def = JSON.parse(fs.readFileSync(F, 'utf8'));
const m = decodeVariant(readGcpf(fs.readFileSync('../original_data/maps/berhagen.wonderdraft_map')), 4).value;
const W = def.size[0], bytes = m.mask.props.data.data.bytes;
const [RX0, RY0, RX1, RY1] = def.rect;
const RW = RX1 - RX0 + 1, RH = RY1 - RY0 + 1;

// ---------- terrain from symbols ----------
const kindOf = (t) => (/mountain/.test(t) ? 'mountain' : /cliff/.test(t) ? 'mountain' : /hill|hiil/.test(t) ? 'hills' : /oak|pine/.test(t) ? 'forest' : /marshy/.test(t) ? 'marsh' : /dead_trees/.test(t) ? 'dead' : null);
const R_OF = { mountain: 80, hills: 55, forest: 40, marsh: 72 };
const syms = def.symbols.map((s) => ({ ...s, kind: kindOf(s.t) })).filter((s) => s.kind);
const marsh = syms.filter((s) => s.kind === 'marsh');
for (const s of syms) if (s.kind === 'dead') s.kind = marsh.some((q) => Math.hypot(q.x - s.x, q.y - s.y) < 150) ? 'marsh' : null; // dead trees count as marsh only beside marsh grass
const CS = 4, GX = Math.ceil(RW / CS), GY = Math.ceil(RH / CS);
function areas(kind, minArea) {
  const g = new Float32Array(GX * GY), r = R_OF[kind];
  for (const s of syms) {
    if (s.kind !== kind) continue;
    const cx = (s.x - RX0) / CS, cy = (s.y - RY0) / CS, rr = r / CS;
    for (let j = Math.max(0, Math.floor(cy - rr)); j <= Math.min(GY - 1, Math.ceil(cy + rr)); j++) for (let i = Math.max(0, Math.floor(cx - rr)); i <= Math.min(GX - 1, Math.ceil(cx + rr)); i++) if (Math.hypot(i - cx, j - cy) <= rr) g[j * GX + i] = 1;
  }
  const out = [];
  for (const poly of contours().size([GX, GY]).thresholds([0.5])(g)[0].coordinates) {
    const ring = poly[0].map(([i, j]) => [RX0 + i * CS, RY0 + j * CS]);
    if (Math.abs(turf.area(turf.polygon([ring]))) < minArea) continue;
    let line = turf.simplify(turf.lineString(ring), { tolerance: 5, highQuality: true }).geometry.coordinates;
    if (line[0][0] === line[line.length - 1][0] && line[0][1] === line[line.length - 1][1]) line = line.slice(0, -1);
    out.push(line.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]));
  }
  return out;
}
const labelAt = (poly, labels) => { const c = turf.centroid(turf.polygon([[...poly, poly[0]]])).geometry.coordinates; return labels.map((l) => ({ l, d: Math.hypot(l.x - c[0], l.y - c[1]) })).sort((a, b) => a.d - b.d)[0]; };
const features = [];
for (const [kind, minArea] of [['mountain', 20000], ['hills', 8000], ['forest', 20000], ['marsh', 20000]]) {
  const polys = areas(kind, minArea);
  polys.forEach((poly, i) => {
    let name = `Berhagen ${kind} ${i + 1}`;
    if (kind === 'forest') { const n = labelAt(poly, def.labels.filter((l) => /Borderwode|Crow Fells/.test(l.text))); if (n.d < 600) name = n.l.text; }
    if (kind === 'marsh') name = 'Sunken Lands';
    if (kind === 'mountain') name = 'Border Mountains (Berhagen map)';
    features.push({ name, kind, poly });
  });
  console.log(kind, polys.length, 'areas', polys.map((p) => p.length + ' pts').join(', '));
}

// ---------- rivers from the mask's red channel ----------
const land = (x, y) => bytes[(y * W + x) * 4 + 3] > 40;
const red = new Uint8Array(RW * RH);
for (let y = RY0; y <= RY1; y++) for (let x = RX0; x <= RX1; x++) red[(y - RY0) * RW + x - RX0] = bytes[(y * W + x) * 4] > 128 && land(x, y) ? 1 : 0;
function thin(mask, w, h) { // Zhang-Suen on a window
  const q = Uint8Array.from(mask);
  const at = (x, y) => q[y * w + x];
  let changed = true;
  while (changed) {
    changed = false;
    for (const step of [0, 1]) {
      const kill = [];
      for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
        if (!at(x, y)) continue;
        const p = [at(x, y - 1), at(x + 1, y - 1), at(x + 1, y), at(x + 1, y + 1), at(x, y + 1), at(x - 1, y + 1), at(x - 1, y), at(x - 1, y - 1)];
        const B = p.reduce((a, v) => a + v, 0); if (B < 2 || B > 6) continue;
        let A = 0; for (let i = 0; i < 8; i++) if (!p[i] && p[(i + 1) % 8]) A++; if (A !== 1) continue;
        if (step === 0 ? (p[0] * p[2] * p[4] || p[2] * p[4] * p[6]) : (p[0] * p[2] * p[6] || p[0] * p[4] * p[6])) continue;
        kill.push(y * w + x);
      }
      for (const k of kill) { q[k] = 0; changed = true; }
    }
  }
  return q;
}
// components of the red mask, then skeleton + segment tracing for the thin (river-like) ones
const lab = new Int32Array(RW * RH).fill(-1), comps = [];
for (let s = 0; s < RW * RH; s++) {
  if (!red[s] || lab[s] >= 0) continue;
  const id = comps.length, st = [s]; lab[s] = id; let n = 0, x0 = RW, y0 = RH, x1 = 0, y1 = 0;
  while (st.length) { const p = st.pop(), x = p % RW, y = (p / RW) | 0; n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= RW || ny >= RH) continue; const k = ny * RW + nx; if (red[k] && lab[k] < 0) { lab[k] = id; st.push(k); } } }
  comps.push({ id, n, x0, y0, x1, y1 });
}
const rivers = [], lakes = [];
for (const c of comps) {
  const bw = c.x1 - c.x0 + 3, bh = c.y1 - c.y0 + 3, sub = new Uint8Array(bw * bh);
  for (let y = c.y0; y <= c.y1; y++) for (let x = c.x0; x <= c.x1; x++) if (lab[y * RW + x] === c.id) sub[(y - c.y0 + 1) * bw + x - c.x0 + 1] = 1;
  const diag = Math.hypot(c.x1 - c.x0, c.y1 - c.y0);
  if (c.n < 60 || diag < 40) continue;
  const sk = thin(sub, bw, bh);
  // pixel graph
  const nb = (k) => { const x = k % bw, y = (k / bw) | 0, out = []; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { if (!dx && !dy) continue; const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < bw && ny < bh && sk[ny * bw + nx]) out.push(ny * bw + nx); } return out; };
  const deg = new Map(); for (let k = 0; k < sk.length; k++) if (sk[k]) deg.set(k, nb(k).length);
  const nodes = new Set([...deg].filter(([, d]) => d !== 2).map(([k]) => k));
  const seen = new Set();
  const toXY = (k) => [RX0 + c.x0 - 1 + (k % bw), RY0 + c.y0 - 1 + ((k / bw) | 0)];
  for (const s of nodes) for (const first of nb(s)) {
    const ek = `${Math.min(s, first)}-${Math.max(s, first)}`; if (seen.has(ek)) continue;
    const path = [s, first]; seen.add(ek); let prev = s, cur = first;
    while (!nodes.has(cur)) { const nxt = nb(cur).filter((k) => k !== prev); if (!nxt.length) break; prev = cur; cur = nxt[0]; path.push(cur); }
    seen.add(`${Math.min(path[path.length - 2], cur)}-${Math.max(path[path.length - 2], cur)}`);
    if (path.length < 8) continue;
    const pts = path.map(toXY);
    const line = turf.simplify(turf.lineString(pts), { tolerance: 2.2, highQuality: true }).geometry.coordinates;
    rivers.push({ comp: c.id, pts: line.map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]) });
  }
}
console.log('river segments', rivers.length, 'from', new Set(rivers.map((r) => r.comp)).size, 'networks');
// Lake Brynmere: the little blob on the river by the label
{
  const b = comps.filter((c) => c.n > 60).map((c) => ({ c, d: 0 }));
  lakes.push({ name: 'Brynmere', x: 1342, y: 873, rx: 15, ry: 11 });
}

// ---------- roads, places, labels ----------
const roads = def.roads.map((r) => ({ name: '', pts: r.pts }));
const places = [
  { name: 'Hagensport', x: 1438.2, y: 826.3, kind: 'port', rank: 2 },
  { name: 'BrynCros', x: 1322.4, y: 864.2, kind: 'village', rank: 3 },
  { name: 'Alderford', x: 1356.1, y: 733.4, kind: 'village', rank: 3 },
  { name: 'Brynmere', x: 1360, y: 888, kind: 'village', rank: 3 },
];
const regions = [
  { name: 'Berhagen', x: 1709.6, y: 481.7, rank: 2, kind: 'region' },
  { name: 'Borderwode', x: 1352.8, y: 547.3, rank: 3, kind: 'forest' },
  { name: 'Sunken Lands', x: 1644, y: 685.7, rank: 3, kind: 'marsh' },
  { name: 'Crow Fells', x: 1986.4, y: 670.5, rank: 3, kind: 'forest' },
  { name: 'New Sellador', x: 1126.4, y: 860.5, rank: 3, kind: 'region' },
];
if (process.argv.includes('--write')) {
  Object.assign(def, { features, rivers, lakes, roads, places, regions });
  fs.writeFileSync(F, JSON.stringify(def));
  console.log('wrote', F);
}
