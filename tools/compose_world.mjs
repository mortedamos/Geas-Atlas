// Compose the unified landmass: the world composite as the base, with each hand-drawn / rendered regional
// map re-traced at full detail inside its (registered) footprint. Outputs GeoJSON land + water bands.
// usage: node compose_world.mjs <outDir> [debugDir]
import fs from 'node:fs';
import path from 'node:path';
import { contours } from 'd3-contour';
import * as turf from '@turf/turf';
import { loadJpeg, saveJpeg, boxBlur } from './lib.mjs';
import { loadIslands } from './lib_islands.mjs';
import { regionalLandMask, colorLandMask, floodLandMask, worldSeaField } from './regional_mask.mjs';

const [outDir, debugDir] = process.argv.slice(2);
const MAPS = path.resolve('..', 'original_data/web/img/gallery/maps');
const world = loadJpeg(path.join(MAPS, 'geas_worldmap_big.jpg'));
const WW = world.width, WH = world.height;
const F = 4; // fine grid cells per world pixel
const GW = WW * F, GH = WH * F;
const SPAN = 20;
const toLL = ([gx, gy]) => [((gx / F - WW / 2) * SPAN) / WW, (-(gy / F - WH / 2) * SPAN) / WW];

// ---- regions, in application order (later ones win where footprints overlap) ----
const REGIONS = [
  { name: 'argusund', kind: 'ink', file: 'argusund map big.jpg', scale: 0.058, ox: 99, oy: 41, opts: { openSea: 22 } },
  { name: 'tel-tenauril', kind: 'ink', file: 'tel-tenauril map big.jpg', scale: 0.122, ox: 5, oy: 111, opts: { openSea: 3 } },
  { name: 'sellador', kind: 'color', file: 'sellador map big.jpg', scale: 0.096, ox: 13, oy: 211, opts: { smooth: 6 } },
  { name: 'free-nations', kind: 'fn', file: 'free-nations' }, // hand-drawn photo fitted over the Untamed Lands (tools/fit_fn.mjs)
  { name: 'berhagen', kind: 'fn', file: 'berhagen' }, // the author's Wonderdraft map of the Berhagen coast (tools/bh_*.mjs); replaces the Free Nations draft there
  { name: 'kharse-ertrugol', kind: 'fn', file: 'kharse_ertrugol' }, // hand-drawn map of eastern Kharse / the Valley of Ertrugol / western Boddendell (tools/ke_fit.mjs)
  { name: 'curmeah', kind: 'drawing' }, // hand-drawn continent over the old island blob (source/curmeah.json)
  { name: 'lochlainn', kind: 'drawing' }, // hand-drawn island replacing the old blob (source/lochlainn.json)
];

// ---- base field from the world composite ----
const landW = { w: WW, h: WH, v: new Float32Array(WW * WH) };
for (let i = 0; i < WW * WH; i++) {
  const d = Math.hypot(world.data[i * 4] - 0, world.data[i * 4 + 1] - 129, world.data[i * 4 + 2] - 195);
  landW.v[i] = d > 90 ? 1 : 0;
}
for (let y = 0; y < 80; y++) for (let x = 690; x < 850; x++) landW.v[y * WW + x] = 0; // title logo
const baseW = boxBlur(boxBlur(landW, 2), 2);

function bilinear(m, u, v) {
  const x = Math.min(m.w - 1.001, Math.max(0, u - 0.5)), y = Math.min(m.h - 1.001, Math.max(0, v - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const a = m.v[y0 * m.w + x0], b = m.v[y0 * m.w + x0 + 1], c = m.v[(y0 + 1) * m.w + x0], d = m.v[(y0 + 1) * m.w + x0 + 1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

const field = new Float32Array(GW * GH);
const covered = new Uint8Array(GW * GH); // cells repainted from a hand-drawn regional map (their coasts are not touched by the coast warp)
for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) field[gy * GW + gx] = bilinear(baseW, (gx + 0.5) / F, (gy + 0.5) / F);

// ---- paint regions ----
const FEATHER = 2.5; // world px blend band at footprint edges

// The hand-drawn Free Nations photo: its two traced coastlines give a land polygon; only the 'paper' quad is
// authoritative. The map is rotated a little, so cells are mapped back through the inverse transform.
function paintFreeNations(fileName = 'free-nations') {
  const def = JSON.parse(fs.readFileSync(`source/${fileName}.json`, 'utf8'));
  const { scale, rot, ox, oy } = def.transform;
  const RS = def.raster ?? { x0: -250, y0: 0, w: 1300, h: 700, cell: 1 }; // the land polygon is rasterised over this box of source px (cell = px per cell)
  const X0 = RS.x0, Y0 = RS.y0, CS = RS.cell, CW = Math.ceil(RS.w / CS), CH = Math.ceil(RS.h / CS);
  const inPoly = (poly, x, y) => { let inside = false; for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) { const [xa, ya] = poly[a], [xb, yb] = poly[b]; if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside; } return inside; };
  const sat = new Float64Array((CW + 1) * (CH + 1));
  for (let y = 0; y < CH; y++) { let row = 0; for (let x = 0; x < CW; x++) { row += inPoly(def.land, X0 + (x + 0.5) * CS, Y0 + (y + 0.5) * CS) ? 1 : 0; sat[(y + 1) * (CW + 1) + x + 1] = sat[y * (CW + 1) + x + 1] + row; } }
  const box = (x0, y0, x1, y1) => {
    x0 = Math.max(0, Math.min(CW, Math.round((x0 - X0) / CS))); x1 = Math.max(x0 + 1, Math.min(CW, Math.round((x1 - X0) / CS)));
    y0 = Math.max(0, Math.min(CH, Math.round((y0 - Y0) / CS))); y1 = Math.max(y0 + 1, Math.min(CH, Math.round((y1 - Y0) / CS)));
    return (sat[y1 * (CW + 1) + x1] - sat[y0 * (CW + 1) + x1] - sat[y1 * (CW + 1) + x0] + sat[y0 * (CW + 1) + x0]) / ((x1 - x0) * (y1 - y0));
  };
  const c = Math.cos(rot), s = Math.sin(rot);
  const toWorld = ([x, y]) => [ox + scale * (c * x - s * y), oy + scale * (s * x + c * y)];
  const paperW = def.paper.map(toWorld);
  const distToPaper = (u, v) => { let best = Infinity; for (let i = 0; i < paperW.length; i++) { const [x0, y0] = paperW[i], [x1, y1] = paperW[(i + 1) % paperW.length]; const dx = x1 - x0, dy = y1 - y0; let t = ((u - x0) * dx + (v - y0) * dy) / (dx * dx + dy * dy); t = Math.max(0, Math.min(1, t)); best = Math.min(best, Math.hypot(u - x0 - t * dx, v - y0 - t * dy)); } return best; };
  const xs = paperW.map((p) => p[0]), ys = paperW.map((p) => p[1]);
  const half = 0.5 / (F * scale);
  let painted = 0;
  for (let gy = Math.max(0, Math.floor(Math.min(...ys) * F)); gy < Math.min(GH, Math.ceil(Math.max(...ys) * F)); gy++) {
    for (let gx = Math.max(0, Math.floor(Math.min(...xs) * F)); gx < Math.min(GW, Math.ceil(Math.max(...xs) * F)); gx++) {
      const u = (gx + 0.5) / F, v = (gy + 0.5) / F;
      const dx = (u - ox) / scale, dy = (v - oy) / scale;
      const fx = c * dx + s * dy, fy = -s * dx + c * dy;
      if (!inPoly(def.paper, fx, fy)) continue;
      const wgt = Math.min(1, distToPaper(u, v) / FEATHER);
      const val = box(fx - half, fy - half, fx + half, fy + half);
      field[gy * GW + gx] = field[gy * GW + gx] * (1 - wgt) + val * wgt;
      painted++; covered[gy * GW + gx] = 1;
    }
  }
  console.log(`${fileName}: painted`, painted, 'cells');
}

// Curmeah: a clean drawing placed at a fixed scale/offset over the old island's footprint. Its coast replaces the
// blob: inside the 'erase' box, anything the drawing does not show as land becomes sea.
function paintDrawing(name) {
  const def = JSON.parse(fs.readFileSync(`source/${name}.json`, 'utf8'));
  const m = floodLandMask(path.join(path.resolve('..', 'original_data/maps'), def.map), { close: 8, minLand: 6000, seam: def.seam, ignore: def.ignore, forceSea: def.forceSea || [] });
  const sat = new Float64Array((m.w + 1) * (m.h + 1));
  for (let y = 0; y < m.h; y++) { let row = 0; for (let x = 0; x < m.w; x++) { row += m.land[y * m.w + x]; sat[(y + 1) * (m.w + 1) + x + 1] = sat[y * (m.w + 1) + x + 1] + row; } }
  const box = (x0, y0, x1, y1) => {
    x0 = Math.max(0, Math.min(m.w, Math.round(x0))); x1 = Math.max(x0 + 1, Math.min(m.w, Math.round(x1)));
    y0 = Math.max(0, Math.min(m.h, Math.round(y0))); y1 = Math.max(y0 + 1, Math.min(m.h, Math.round(y1)));
    return (sat[y1 * (m.w + 1) + x1] - sat[y0 * (m.w + 1) + x1] - sat[y1 * (m.w + 1) + x0] + sat[y0 * (m.w + 1) + x0]) / ((x1 - x0) * (y1 - y0));
  };
  const { scale, ox, oy, erase: e } = def;
  const half = 0.5 / (F * scale);
  let painted = 0;
  for (let gy = Math.floor(e.y0 * F); gy < Math.ceil(e.y1 * F); gy++) for (let gx = Math.floor(e.x0 * F); gx < Math.ceil(e.x1 * F); gx++) {
    const u = (gx + 0.5) / F, v = (gy + 0.5) / F;
    const edge = Math.min(u - e.x0, e.x1 - u, v - e.y0, e.y1 - v);
    const wgt = Math.min(1, edge / FEATHER);
    const rx = (u - ox) / scale, ry = (v - oy) / scale;
    const inside = rx >= 0 && ry >= 0 && rx < m.w && ry < m.h;
    const val = inside ? box(rx - half, ry - half, rx + half, ry + half) : 0;
    field[gy * GW + gx] = field[gy * GW + gx] * (1 - wgt) + val * wgt;
    painted++; covered[gy * GW + gx] = 1;
  }
  console.log(`${name}: painted`, painted, 'cells');
}

for (const R of REGIONS) {
  if (R.kind === 'fn') { paintFreeNations(R.file); continue; }
  if (R.kind === 'drawing') { paintDrawing(R.name); continue; }
  const file = path.join(MAPS, R.file);
  const t0 = Date.now();
  const m = R.kind === 'ink' ? regionalLandMask(file, world, R, R.opts) : colorLandMask(file, R.opts);
  // summed-area table for box-averaged sampling
  const sat = new Float64Array((m.w + 1) * (m.h + 1));
  for (let y = 0; y < m.h; y++) {
    let row = 0;
    for (let x = 0; x < m.w; x++) {
      row += m.land[y * m.w + x];
      sat[(y + 1) * (m.w + 1) + x + 1] = sat[y * (m.w + 1) + x + 1] + row;
    }
  }
  const box = (x0, y0, x1, y1) => {
    x0 = Math.max(0, Math.min(m.w, Math.round(x0))); x1 = Math.max(x0 + 1, Math.min(m.w, Math.round(x1)));
    y0 = Math.max(0, Math.min(m.h, Math.round(y0))); y1 = Math.max(y0 + 1, Math.min(m.h, Math.round(y1)));
    const s = sat[y1 * (m.w + 1) + x1] - sat[y0 * (m.w + 1) + x1] - sat[y1 * (m.w + 1) + x0] + sat[y0 * (m.w + 1) + x0];
    return s / ((x1 - x0) * (y1 - y0));
  };
  const fx0 = R.ox, fy0 = R.oy, fx1 = R.ox + R.scale * m.w, fy1 = R.oy + R.scale * m.h;
  const half = 0.5 / (F * R.scale); // half a fine cell in regional px
  let painted = 0;
  for (let gy = Math.max(0, Math.floor(fy0 * F)); gy < Math.min(GH, Math.ceil(fy1 * F)); gy++) {
    for (let gx = Math.max(0, Math.floor(fx0 * F)); gx < Math.min(GW, Math.ceil(fx1 * F)); gx++) {
      const u = (gx + 0.5) / F, v = (gy + 0.5) / F;
      const edge = Math.min(u - fx0, fx1 - u, v - fy0, fy1 - v);
      if (edge < 0) continue;
      const wgt = Math.min(1, edge / FEATHER);
      const rx = (u - R.ox) / R.scale, ry = (v - R.oy) / R.scale;
      const val = box(rx - half, ry - half, rx + half, ry + half);
      field[gy * GW + gx] = field[gy * GW + gx] * (1 - wgt) + val * wgt;
      painted++; covered[gy * GW + gx] = 1;
    }
  }
  console.log(`${R.name}: mask ${m.w}x${m.h}, painted ${painted} cells, ${Date.now() - t0} ms`);
  if (debugDir) {
    const px = Buffer.alloc(m.w * m.h * 4);
    for (let i = 0; i < m.w * m.h; i++) { const c = m.land[i] ? 235 : 40; px[i * 4] = px[i * 4 + 1] = px[i * 4 + 2] = c; px[i * 4 + 3] = 255; }
    fs.mkdirSync(debugDir, { recursive: true });
    saveJpeg(path.join(debugDir, `${R.name}_land.jpg`), m.w, m.h, px);
  }
}

// ---- author-directed island move (source/adjustments.json) ----
{
  const adj = JSON.parse(fs.readFileSync('source/adjustments.json', 'utf8')).islandMove;
  if (adj) {
    const [fx, fy] = adj.from, [tx, ty] = adj.to;
    // find the island: flood the land cells connected to the nearest land cell around `from`
    let seed = -1, bestD = 1e9;
    for (let gy = Math.floor((fy - 5) * F); gy < (fy + 5) * F; gy++) for (let gx = Math.floor((fx - 5) * F); gx < (fx + 5) * F; gx++) {
      if (field[gy * GW + gx] > 0.5) { const d = Math.hypot(gx / F - fx, gy / F - fy); if (d < bestD) { bestD = d; seed = gy * GW + gx; } }
    }
    if (seed < 0) throw new Error('islandMove: no land near the given position');
    const seen = new Set([seed]), stack = [seed];
    while (stack.length && seen.size < 60000) {
      const p = stack.pop(), x = p % GW, y = (p - x) / GW;
      for (const q of [p - 1, p + 1, p - GW, p + GW]) if (q >= 0 && q < GW * GH && !seen.has(q) && field[q] > 0.5) { seen.add(q); stack.push(q); }
    }
    if (seen.size >= 60000) throw new Error('islandMove: that land is not a small island');
    const cells = new Set();
    for (const p of seen) { const x = p % GW, y = (p - x) / GW; for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) cells.add((y + dy) * GW + x + dx); }
    const ddx = Math.round((tx - fx) * F), ddy = Math.round((ty - fy) * F);
    const moved = [...cells].map((p) => [p, field[p]]);
    let overlap = 0;
    for (const [p, v] of moved) { const x = p % GW, y = (p - x) / GW, q = (y + ddy) * GW + x + ddx; if (v > 0.5 && field[q] > 0.5 && !cells.has(q)) overlap++; }
    if (overlap) console.log('WARNING islandMove: the new spot overlaps existing land by', overlap, 'cells');
    for (const [p] of moved) field[p] = 0;
    for (const [p, v] of moved) { const x = p % GW, y = (p - x) / GW, q = (y + ddy) * GW + x + ddx; field[q] = Math.max(field[q], v); }
    console.log(`island moved: ${seen.size} cells (${(seen.size / F / F).toFixed(1)} px^2) by (${(tx - fx).toFixed(1)}, ${(ty - fy).toFixed(1)}) world px`);
  }
}

// ---- natural coasts for the parts of the map nobody has drawn (source/adjustments.json: coastWarp) ----
// The old world map only gave soft blobs there. Everything outside the hand-drawn maps' footprints is domain-warped
// with multi-scale noise, so the coast gets bays, headlands and fjords; the picture's cut-off edge is rounded off.
const adjAll = JSON.parse(fs.readFileSync('source/adjustments.json', 'utf8'));
if (adjAll.coastWarp) {
  const cw = adjAll.coastWarp;
  const hash = (ix, iy, seed) => { let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const smooth = (t) => t * t * (3 - 2 * t);
  const vnoise = (x, y, seed) => { const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy); const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed); return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy - 0.5; };
  const fbm = (x, y, seed) => { let s = 0; cw.octaves.forEach(([wave, amp], k) => { s += amp * 2 * vnoise(x / wave, y / wave, seed + k * 17); }); return s; };

  // how far each world pixel is from a hand-drawn footprint: 0 inside/near, 1 well away
  let cov = { w: WW, h: WH, v: new Float32Array(WW * WH) };
  for (let gy = 0; gy < GH; gy++) for (let gx = 0; gx < GW; gx++) if (covered[gy * GW + gx]) cov.v[Math.floor(gy / F) * WW + Math.floor(gx / F)] = 1;
  cov = boxBlur(cov, cw.keepClear);
  for (let i = 0; i < cov.v.length; i++) cov.v[i] = cov.v[i] > 0.004 ? 1 : 0;
  cov = boxBlur(boxBlur(cov, 4), 4);
  const away = (u, v) => 1 - bilinear(cov, u, v);

  const src = Float32Array.from(field);
  let changed = 0;
  for (let gy = 0; gy < GH; gy++) {
    for (let gx = 0; gx < GW; gx++) {
      const u = (gx + 0.5) / F, v = (gy + 0.5) / F;
      const w = away(u, v);
      if (w < 0.01) continue;
      const dx = fbm(u, v, 11) * w, dy = fbm(u + 500, v + 500, 29) * w;
      let val = bilinear({ w: GW, h: GH, v: src }, (gx + 0.5) + dx * F, (gy + 0.5) + dy * F);
      // round off the cut-off picture edge: land fades out within `edgeFade` px of the border, with a ragged line
      // (not the top edge: the north continent runs off it into the arctic pole, see arcticCap)
      const edge = Math.min(u, WW - u, WH - v) + 6 * fbm(u * 1.7, v * 1.7, 53) / (cw.octaves[0][1] || 1);
      const fade = Math.max(0, Math.min(1, edge / cw.edgeFade));
      val *= 1 - w * (1 - smooth(fade));
      if (val !== src[gy * GW + gx]) changed++;
      field[gy * GW + gx] = val;
    }
  }
  console.log('coast warp applied to', changed, 'cells');
}

// ---- remove islets the author does not want (source/adjustments.json: removeIslands, world-pixel boxes) ----
const removeBoxes = adjAll.removeIslands || [];

// ---- contour ----
const PAD = 2;
const PW = GW + PAD * 2, PH = GH + PAD * 2;
const padded = new Float32Array(PW * PH);
for (let y = 0; y < GH; y++) for (let x = 0; x < GW; x++) padded[(y + PAD) * PW + x + PAD] = field[y * GW + x];
// light smoothing in fine px to remove stair-stepping
const sm = boxBlur(boxBlur({ w: PW, h: PH, v: padded }, 1), 1);
const multi = contours().size([PW, PH]).thresholds([0.5])(sm.v)[0];

const ringArea = (r) => {
  let a = 0;
  for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return Math.abs(a) / 2;
};
const MIN_ISLAND = 6 * F * F; // world px^2 -> fine px^2
const MIN_LAKE = 8 * F * F;
const polys = [];
for (const poly of multi.coordinates) {
  if (ringArea(poly[0]) < MIN_ISLAND) continue;
  { // drop islets inside a "removeIslands" box (outer ring is in fine px)
    const xs = poly[0].map((p) => (p[0] - PAD) / F), ys = poly[0].map((p) => (p[1] - PAD) / F);
    const bx0 = Math.min(...xs), bx1 = Math.max(...xs), by0 = Math.min(...ys), by1 = Math.max(...ys);
    if (removeBoxes.some(([x0, y0, x1, y1]) => bx0 >= x0 && bx1 <= x1 && by0 >= y0 && by1 <= y1)) { console.log('removed islet at world px', [bx0, by0, bx1, by1].map(Math.round).join(',')); continue; }
  }
  polys.push(poly.filter((r, i) => i === 0 || ringArea(r) >= MIN_LAKE).map((r) => r.map(([x, y]) => [x - PAD, y - PAD])));
}

function chaikin(ring, iters) {
  let pts = ring.slice(0, -1);
  for (let k = 0; k < iters; k++) {
    const next = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    pts = next;
  }
  return [...pts, pts[0]];
}

let land = turf.multiPolygon(polys);
land = turf.simplify(land, { tolerance: 1.4, highQuality: true });
land = turf.multiPolygon(land.geometry.coordinates.map((poly) => poly.map((r) => chaikin(r, 1).map(toLL))));
land = turf.cleanCoords(land);

// ---- seas the author drew into a continent (source/adjustments.json: carveSea) ----
// A red line drawn on the map becomes a new coast: everything on the far side of it, out to the existing sea, is cut away
// (only the main landmass is cut; separate islands inside the cut area are left alone).
for (const c of adjAll.carveSea || []) {
  const wLL = ([x, y]) => [((x - WW / 2) * SPAN) / WW, (-(y - WH / 2) * SPAN) / WW];
  let line = c.line.map((p) => p.slice());
  for (let k = 0; k < (c.smooth ?? 2); k++) { // Chaikin on the open line: softens the hand-drawn kinks, keeps both ends
    const out = [line[0]];
    for (let i = 0; i < line.length - 1; i++) { const a = line[i], b = line[i + 1]; out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]); }
    out.push(line[line.length - 1]); line = out;
  }
  // run each end of the line a little way out to sea, so no sliver of old coast is left where the line meets it
  const ext = (a, b, d) => { const l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [b[0] + ((b[0] - a[0]) / l) * d, b[1] + ((b[1] - a[1]) / l) * d]; };
  const first = ext(line[1], line[0], c.extend ?? 5), last = ext(line[line.length - 2], line[line.length - 1], c.extend ?? 5);
  const ring = [first, ...line, last, ...c.closing, first].map(wLL);
  const cutter = turf.polygon([ring]);
  const minArea = 0.19; // deg^2: ~500 world px^2; smaller landmasses are islands and stay
  const area = (r) => { let s = 0; for (let i = 0; i < r.length - 1; i++) s += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1]; return Math.abs(s) / 2; };
  const kept = [];
  let cutN = 0;
  for (const rings of land.geometry.coordinates) {
    if (area(rings[0]) < minArea) { kept.push(rings); continue; }
    let r = null;
    try { r = turf.difference(turf.featureCollection([turf.polygon(rings), cutter])); } catch (e) { kept.push(rings); continue; }
    if (!r) { cutN++; continue; }
    cutN++;
    for (const part of r.geometry.type === 'Polygon' ? [r.geometry.coordinates] : r.geometry.coordinates) if (area(part[0]) > 0.02) kept.push(part);
  }
  land = turf.multiPolygon(kept);
  console.log(`carveSea "${c.name}": cut ${cutN} landmass(es)`);
}

// ---- straits cut through a landmass (adjustments.json: straits), e.g. to turn Phocacia into an archipelago ----
for (const s of adjAll.straits || []) {
  const wLL2 = ([x, y]) => [((x - WW / 2) * SPAN) / WW, (-(y - WH / 2) * SPAN) / WW];
  const cutter = turf.buffer(turf.lineString(s.line.map(wLL2)), (s.width / 2) * (SPAN / WW) * 111.19, { units: 'kilometers', steps: 6 });
  const [cx0, cy0, cx1, cy1] = turf.bbox(cutter);
  const out = [];
  for (const rings of land.geometry.coordinates) {
    const xs = rings[0].map((p) => p[0]), ys = rings[0].map((p) => p[1]);
    if (Math.max(...xs) < cx0 || Math.min(...xs) > cx1 || Math.max(...ys) < cy0 || Math.min(...ys) > cy1) { out.push(rings); continue; }
    let r = null;
    try { r = turf.difference(turf.featureCollection([turf.polygon(rings), cutter])); } catch (e) { out.push(rings); continue; }
    if (!r) continue;
    for (const part of r.geometry.type === 'Polygon' ? [r.geometry.coordinates] : r.geometry.coordinates) out.push(part);
  }
  land = turf.multiPolygon(out);
  console.log(`strait "${s.name}" cut`);
}

// ---- small areas turned back into sea (adjustments.json: seaCuts): a polygon in world px, grown a little so no old coast is left ----
for (const s of adjAll.seaCuts || []) {
  const wLL3 = ([x, y]) => [((x - WW / 2) * SPAN) / WW, (-(y - WH / 2) * SPAN) / WW];
  let cutter = turf.polygon([[...s.poly, s.poly[0]].map(wLL3)]);
  if (s.grow) cutter = turf.buffer(cutter, s.grow * (SPAN / WW) * 111.19, { units: 'kilometers', steps: 4 });
  const out = [];
  for (const rings of land.geometry.coordinates) {
    let r = null;
    try { r = turf.difference(turf.featureCollection([turf.polygon(rings), cutter])); } catch (e) { out.push(rings); continue; }
    if (!r) continue;
    for (const part of r.geometry.type === 'Polygon' ? [r.geometry.coordinates] : r.geometry.coordinates) out.push(part);
  }
  land = turf.multiPolygon(out);
  console.log(`seaCut "${s.name}" done`);
}

// ---- the Phocacian islands move (adjustments.json: phociaMove): land polygons inside `box` slide by (dx, dy) world px ----
// (done after the straits are cut, so the archipelago keeps its shape; its islets, terrain, river and pins are shifted in their own files)
if (adjAll.phociaMove) {
  const { box, dx, dy } = adjAll.phociaMove;
  const toPx = ([lng, lat]) => [(lng * WW) / SPAN + WW / 2, WH / 2 - (lat * WW) / SPAN];
  let n = 0;
  land = turf.multiPolygon(land.geometry.coordinates.map((rings) => {
    const pts = rings[0].map(toPx);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    if (Math.min(...xs) < box[0] || Math.max(...xs) > box[2] || Math.min(...ys) < box[1] || Math.max(...ys) > box[3]) return rings;
    n++;
    return rings.map((r) => r.map(([lng, lat]) => [lng + (dx * SPAN) / WW, lat - (dy * SPAN) / WW]));
  }));
  console.log(`phocacia moved: ${n} landmasses by (${dx}, ${dy}) world px`);
}

// ---- the arctic pole (source/adjustments.json: arcticCap) ----
// The northern continent is stretched wide where it meets the picture's top edge: that is map distortion, because it joins a
// vast polar cap. So the land is not closed off at the top: it flares outward and runs off the map into the ice.
const polarIslets = [];
// small islets scattered by hand (adjustments.json: islets = [x, y, radius] in world px): thin shallows, like the other tiny islands
{
  let seed = 4141;
  const r01 = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (const [cx, cy, r] of adjAll.islets || []) {
    const ph = [r01() * 6.28, r01() * 6.28];
    const ring = Array.from({ length: 14 }, (_, k) => { const a = (k / 14) * Math.PI * 2, w = 1 + 0.26 * Math.sin(2 * a + ph[0]) + 0.14 * Math.sin(4 * a + ph[1]); return [cx + Math.cos(a) * r * w * 1.2, cy + Math.sin(a) * r * w]; });
    polarIslets.push([chaikin([...ring, ring[0]], 1).map(([x, y]) => [((x - WW / 2) * SPAN) / WW, (-(y - WH / 2) * SPAN) / WW])]);
  }
}
if (adjAll.arcticCap) {
  const ac = adjAll.arcticCap;
  const gy = Math.round(ac.measureAtY * F);
  let best = { len: 0, x0: 0, x1: 0 }, run = null;
  for (let gx = Math.floor(ac.xRange[0] * F); gx < Math.ceil(ac.xRange[1] * F); gx++) {
    if (field[gy * GW + gx] > 0.5) { run = run ? { ...run, x1: gx } : { x0: gx, x1: gx }; if (run.x1 - run.x0 > best.len) best = { len: run.x1 - run.x0, x0: run.x0, x1: run.x1 }; } else run = null;
  }
  const xl = best.x0 / F, xr = best.x1 / F;
  const rnd = (() => { let a = 77; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  const left = [], right = [];
  for (const [y, grow] of ac.flare) { // [world y (negative = north of the picture), how far each side flares out]
    const j = () => (rnd() - 0.5) * ac.ragged;
    left.push([xl - grow + j(), y + j() * 0.4]); right.push([xr + grow + j(), y + j() * 0.4]);
  }
  const ring = [[xl - 1, ac.overlapY], [xr + 1, ac.overlapY], ...right, ...left.reverse()];
  const wLL = ([x, y]) => [((x - WW / 2) * SPAN) / WW, (-(y - WH / 2) * SPAN) / WW];
  // (the flare polygon is optional: the full-width sheet already joins the continent; with no flare points it is skipped)
  let u = land;
  if (ac.flare.length) {
    const cap = turf.polygon([chaikin([...ring, ring[0]], 2).map(wLL)]);
    u = turf.union(turf.featureCollection([land, cap]));
  }
  // the pole is stretched across the WHOLE top of the map (a flat map smears a pole into a band): one ice sheet from edge to edge
  if (ac.fullWidth) {
    const fw = ac.fullWidth;
    // Antarctica-like coast: layered irregularity, a few deep embayments (like the Ross and Weddell seas), long peninsulas,
    // and a scatter of offshore ice islands. (Bays stay clear of the northern continent, which joins the sheet.)
    const waves = fw.octaves.map(([wave, amp]) => [wave, amp, rnd() * 6.28, rnd() * 6.28]);
    const sstep = (a, b, t) => { const k = Math.max(0, Math.min(1, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
    const coastY = (x) => {
      let y = fw.edgeY;
      for (const [wave, amp, p1, p2] of waves) y += amp * (0.6 * Math.sin(x / wave + p1) + 0.4 * Math.sin(x / (wave * 0.63) + p2));
      for (const [xc, half, depth] of fw.bays) { const t = Math.abs(x - xc) / half; if (t < 1) y -= depth * (1 - sstep(0.4, 1, t)); }
      for (const [xc, half, len] of fw.peninsulas) { const t = Math.abs(x - xc) / half; if (t < 1) y += len * Math.pow(1 - t * t, 2); }
      // where the ice sheet meets the northern continent it has to overlap the land (otherwise a thin strait or a sharp
      // triangular bay is left between them): hold the coast south of `minY`, easing off over `blend` px at each end
      if (fw.join) { const j = fw.join, w = sstep(j.x0 - j.blend, j.x0, x) * (1 - sstep(j.x1, j.x1 + j.blend, x)); if (w > 0) y = Math.max(y, j.minY * w); }
      return y;
    };
    const edge = [];
    for (let x = fw.xMax; x >= fw.xMin; x -= 5) edge.push([x, coastY(x)]);
    const sheet = turf.polygon([chaikin([[fw.xMin, fw.top], [fw.xMax, fw.top], ...edge, [fw.xMin, fw.top]], 1).map(wLL)]);
    u = turf.union(turf.featureCollection([u, sheet]));
    for (const [cx, cy, r] of fw.islands) { // offshore ice islands and rocks
      const ph = [rnd() * 6.28, rnd() * 6.28];
      const ring = Array.from({ length: 16 }, (_, k) => { const a = (k / 16) * Math.PI * 2, w = 1 + 0.28 * Math.sin(2 * a + ph[0]) + 0.16 * Math.sin(4 * a + ph[1]); return [cx + Math.cos(a) * r * w * 1.25, cy + Math.sin(a) * r * w]; });
      polarIslets.push([chaikin([...ring, ring[0]], 1).map(wLL)]); // joined to the thin-shallows islands later (they are tiny)
    }
  }
  land = u.geometry.type === 'MultiPolygon' ? u : turf.multiPolygon([u.geometry.coordinates]);
  console.log(`arctic cap: land at the top edge spans x ${xl.toFixed(0)}-${xr.toFixed(0)}, flaring out to the pole`);
}

// ---- the antarctic pole (source/adjustments.json: antarcticCap) ----
// Like the arctic, a flat map smears the pole across the bottom edge: one ice sheet from edge to edge, smaller than the
// arctic one. Its coast is built from whole-number harmonics of the map width so the left and right edges meet on the globe.
if (adjAll.antarcticCap) {
  const ac = adjAll.antarcticCap;
  const wLL = ([x, y]) => [((x - WW / 2) * SPAN) / WW, (-(y - WH / 2) * SPAN) / WW];
  const rnd = (() => { let a = 4242; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  const W = ac.xMax - ac.xMin;
  const sstep = (a, b, t) => { const k = Math.max(0, Math.min(1, (t - a) / (b - a))); return k * k * (3 - 2 * k); };
  const harm = ac.harmonics.map(([k, amp]) => [k, amp, rnd() * 6.28]);
  const coastY = (x) => {
    let y = ac.edgeY;
    for (const [k, amp, ph] of harm) y += amp * Math.sin((2 * Math.PI * k * (x - ac.xMin)) / W + ph);
    for (const [xc, half, depth] of ac.bays) { const t = Math.abs(x - xc) / half; if (t < 1) y += depth * (1 - sstep(0.4, 1, t)); } // a bay pushes the coast away from the equator
    return y;
  };
  const edge = [];
  for (let x = ac.xMax; x >= ac.xMin; x -= 4) edge.push([x, coastY(x)]);
  let sheet = turf.polygon([chaikin([[ac.xMin, ac.bottom], [ac.xMax, ac.bottom], ...edge, [ac.xMin, ac.bottom]], 1).map(wLL)]);
  // arcing peninsulas: a tapering, ragged band that starts on the sheet and curves out into the sea (like the Antarctic Peninsula)
  for (const p of ac.peninsulas) {
    const N = 30, ph = [rnd() * 6.28, rnd() * 6.28];
    let x = p.x, y = coastY(p.x) + 14;
    const left = [], right = [];
    for (let i = 0; i <= N; i++) {
      const t = i / N, th = -Math.PI / 2 + p.bend * t;
      const hw = (p.width / 2) * Math.pow(1 - t, 0.7) * (1 + 0.18 * Math.sin(9 * t + ph[0])) + 0.8;
      const nx = -Math.sin(th), ny = Math.cos(th); // normal to the heading
      left.push([x + nx * hw * (1 + 0.12 * Math.sin(23 * t + ph[1])), y + ny * hw]);
      right.push([x - nx * hw * (1 + 0.12 * Math.cos(19 * t + ph[0])), y - ny * hw]);
      x += Math.cos(th) * (p.len / N); y += Math.sin(th) * (p.len / N);
    }
    const ring = [...left, ...right.reverse()];
    try { sheet = turf.union(turf.featureCollection([sheet, turf.polygon([chaikin([...ring, ring[0]], 1).map(wLL)])])); } catch (e) { console.log('antarctic peninsula skipped', e.message); }
  }
  for (const [cx, cy, r] of ac.islands) { // offshore ice islands
    const ph = [rnd() * 6.28, rnd() * 6.28];
    const ring = Array.from({ length: 16 }, (_, k) => { const a = (k / 16) * Math.PI * 2, w = 1 + 0.28 * Math.sin(2 * a + ph[0]) + 0.16 * Math.sin(4 * a + ph[1]); return [cx + Math.cos(a) * r * w * 1.25, cy + Math.sin(a) * r * w]; });
    polarIslets.push([chaikin([...ring, ring[0]], 1).map(wLL)]);
  }
  const u = turf.union(turf.featureCollection([land, sheet]));
  land = u.geometry.type === 'MultiPolygon' ? u : turf.multiPolygon([u.geometry.coordinates]);
  console.log(`antarctic cap added: coast near y ${ac.edgeY}, ${ac.peninsulas.length} peninsulas`);
}

// ---- the islands west of Sellador (Prios, Thanatos, Agrea): their traced coasts are added as extra landmasses ----
let mainLand = land, islandLand = null, extraBand = [], extraGroup = []; // extraBand: thickness of the shallows round each island polygon (world px per band width)
{
  const { islands } = loadIslands();
  const extra = [];
  const toLLpx = (isl) => ([x, y]) => [((isl.ox + isl.scale * x) - WW / 2) * SPAN / WW, -((isl.oy + isl.scale * y) - WH / 2) * SPAN / WW];
  for (const isl of islands) {
    const proj = toLLpx(isl);
    const rng = (() => { let a = 99 + isl.id.length * 7; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
    const wobble = (ring, amp, step) => { // hand-drawn wobble in image px before smoothing
      const pts = [];
      for (let i = 0; i < ring.length; i++) {
        const [x0, y0] = ring[i], [x1, y1] = ring[(i + 1) % ring.length];
        const len = Math.hypot(x1 - x0, y1 - y0) || 1, n = Math.max(1, Math.round(len / step)), nx = -(y1 - y0) / len, ny = (x1 - x0) / len;
        pts.push([x0, y0]);
        for (let k = 1; k < n; k++) {
          const t = k / n, px = x0 + (x1 - x0) * t, py = y0 + (y1 - y0) * t;
          // parts of a coast the author never drew (outside `visible`) get a much bumpier hand-drawn wobble
          const v = isl.visible, invented = v && (px < v[0] || py < v[1] || px > v[2] || py > v[3]);
          const o = (rng() - 0.5) * 2 * amp * (invented ? isl.inventedWobble : 1);
          pts.push([px + nx * o, py + ny * o]);
        }
      }
      return pts;
    };
    const amp = (isl.wobble ?? 1) * 0.3 / isl.scale; // about a third of a world pixel of wobble, in image px (islands traced in full set wobble to 0)
    for (const ring of [isl.coast, ...(isl.islets || [])]) {
      const pts = wobble(ring, ring === isl.coast ? amp * 1.2 : amp * 0.6, ring === isl.coast ? 40 : 14);
      const closed = chaikin([...pts, pts[0]], 2).map(proj);
      extra.push([closed]); extraBand.push(isl.bandScale ?? 0.22); extraGroup.push(isl.id);
    }
  }
  extra.push(...polarIslets); extraBand.push(...polarIslets.map(() => 0.22)); extraGroup.push(...polarIslets.map((_, k) => `polar${k}`));
  mainLand = land;
  islandLand = turf.multiPolygon(extra);
  land = turf.multiPolygon([...land.geometry.coordinates, ...extra]);
  console.log('islands added:', islands.map((i) => `${i.id} east ${i.eastX.toFixed(0)} west ${i.westX.toFixed(0)}`).join('; '));
}

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'land.geojson'), JSON.stringify(turf.featureCollection([land]), (k, v) => (typeof v === 'number' ? +v.toFixed(5) : v)));

const kmPerWorldPx = (SPAN / WW) * 111.19;
const bands = [];
for (const [name, px] of [['shallows', 5], ['shelf', 12], ['coast', 26]]) {
  const b = turf.buffer(mainLand, px * kmPerWorldPx, { units: 'kilometers', steps: 6 });
  bands.push({ ...b, properties: { band: name } });
  // the western islands are only 5-10 px across: give them proportionally thin shallows
  // (one polygon at a time: a multipolygon whose parts touch, like an islet hugging a coast, confuses the buffer)
  // each island's islets share one shallows outline (separate buffers drew arcs across the islands)
  if (islandLand) {
    const groups = new Map();
    islandLand.geometry.coordinates.forEach((poly, pi) => {
      const buf = turf.buffer(turf.polygon(poly), px * (extraBand[pi] ?? 0.22) * kmPerWorldPx, { units: 'kilometers', steps: 8 });
      const g = extraGroup[pi] ?? 'x' + pi;
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(buf);
    });
    for (const bufs of groups.values()) {
      let u = bufs[0];
      for (const b of bufs.slice(1)) { try { u = turf.union(turf.featureCollection([u, b])) || u; } catch (err) { bands.push({ ...b, properties: { band: name } }); } }
      bands.push({ ...u, properties: { band: name } });
    }
  }
}
fs.writeFileSync(path.join(outDir, 'water_bands.geojson'), JSON.stringify(turf.featureCollection(bands), (k, v) => (typeof v === 'number' ? +v.toFixed(5) : v)));
console.log('polygons', land.geometry.coordinates.length, 'land bytes', fs.statSync(path.join(outDir, 'land.geojson')).size);
