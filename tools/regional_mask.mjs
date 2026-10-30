// Turn a line-drawn regional map into a land/sea mask, using the world composite (where this map was
// pasted, with a blue sea) as a guide for which white areas are sea.
import { loadJpeg, isOcean, boxBlur } from './lib.mjs';

export function worldSeaField(world) {
  const { width: w, height: h, data } = world;
  const v = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) v[i] = isOcean(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) ? 1 : 0;
  return { w, h, v };
}

function sample(m, u, v) {
  const x = Math.min(m.w - 1.001, Math.max(0, u - 0.5)), y = Math.min(m.h - 1.001, Math.max(0, v - 0.5));
  const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
  const a = m.v[y0 * m.w + x0], b = m.v[y0 * m.w + x0 + 1], c = m.v[(y0 + 1) * m.w + x0], d = m.v[(y0 + 1) * m.w + x0 + 1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

function dilate(mask, w, h, r) {
  // separable square dilation
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -1e9;
    const row = y * w;
    // forward/backward distance to nearest set pixel along the row
    const dist = new Int32Array(w).fill(1e9);
    for (let x = 0; x < w; x++) { if (mask[row + x]) last = x; dist[x] = x - last; }
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) { if (mask[row + x]) last = x; dist[x] = Math.min(dist[x], last - x); }
    for (let x = 0; x < w; x++) tmp[row + x] = dist[x] <= r ? 1 : 0;
  }
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    const dist = new Int32Array(h).fill(1e9);
    for (let y = 0; y < h; y++) { if (tmp[y * w + x]) last = y; dist[y] = y - last; }
    last = 1e9;
    for (let y = h - 1; y >= 0; y--) { if (tmp[y * w + x]) last = y; dist[y] = Math.min(dist[y], last - y); }
    for (let y = 0; y < h; y++) out[y * w + x] = dist[y] <= r ? 1 : 0;
  }
  return out;
}

/** Morphological opening of a 0/1 mask with a square element of radius r (removes features thinner than 2r+1). */
export function openMask(mask, w, h, r) {
  if (!r) return mask;
  const inv = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) inv[i] = mask[i] ? 0 : 1;
  const eroded = dilate(inv, w, h, r); // dilating the complement erodes the mask
  const e2 = new Uint8Array(mask.length);
  for (let i = 0; i < mask.length; i++) e2[i] = eroded[i] ? 0 : 1;
  return dilate(e2, w, h, r);
}

/**
 * Land mask of a clean black-on-white drawing whose sea is all connected to the picture's border: flood the sea in
 * from the edges (coast ink thickened by `close` px to seal gaps), keep landmasses bigger than `minLand` px.
 */
export function floodLandMask(file, { close = 8, minLand = 6000, inkLevel = 128, seam = null, ignore = [], forceSea = [] } = {}) {
  const { width: w, height: h, data } = loadJpeg(file);
  const n = w * h;
  const ink = new Uint8Array(n);
  for (let i = 0; i < n; i++) ink[i] = data[i * 4] < inkLevel ? 1 : 0;
  // boxes [x0,y0,x1,y1] of lettering/decoration that is not map (titles, arrows): treat as blank paper
  for (const [bx0, by0, bx1, by1] of ignore) for (let y = by0; y < by1; y++) for (let x = bx0; x < bx1; x++) ink[y * w + x] = 0;
  const wall = dilate(ink, w, h, close);
  const sea = new Uint8Array(n), stack = [];
  const push = (p) => { if (!wall[p] && !sea[p]) { sea[p] = 1; stack.push(p); } };
  for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
  for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
  while (stack.length) { const p = stack.pop(), x = p % w, y = (p - x) / w; if (x > 0) push(p - 1); if (x < w - 1) push(p + 1); if (y > 0) push(p - w); if (y < h - 1) push(p + w); }
  // the flood stopped `close` px short of the coast ink: let the sea creep back up to the line itself
  const seaGrown = dilate(sea, w, h, close);
  for (let i = 0; i < n; i++) sea[i] = seaGrown[i] ? 1 : 0;
  const lab = new Int32Array(n), sizes = [0];
  for (let s = 0; s < n; s++) {
    if (sea[s] || lab[s]) continue;
    const id = sizes.length; let c = 0; const st = [s]; lab[s] = id;
    while (st.length) { const p = st.pop(); c++; const x = p % w, y = (p - x) / w; for (const q of [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1]) if (q >= 0 && !sea[q] && !lab[q]) { lab[q] = id; st.push(q); } }
    sizes.push(c);
  }
  const land = new Uint8Array(n);
  for (let i = 0; i < n; i++) land[i] = lab[i] && sizes[lab[i]] >= minLand ? 1 : 0;

  // Two sheets taped together never line up exactly, so a coast that crosses the seam jogs sideways. Rebuild the
  // rows of the seam by sliding the coast linearly from its position above to its position below: interpolate a
  // 1-D signed distance to the nearest land/sea change along each row.
  if (seam) {
    const [s0, s1] = seam, ya = s0 - 6, yb = s1 + 6;
    const sdf = (y) => {
      const d = new Float32Array(w);
      let last = -1e9; // distance to the nearest transition on the left, then on the right
      const left = new Float32Array(w), right = new Float32Array(w);
      for (let x = 0; x < w; x++) { if (x > 0 && land[y * w + x] !== land[y * w + x - 1]) last = x; left[x] = x - last; }
      last = 1e9;
      for (let x = w - 1; x >= 0; x--) { if (x < w - 1 && land[y * w + x] !== land[y * w + x + 1]) last = x + 1; right[x] = last - x; }
      for (let x = 0; x < w; x++) d[x] = (land[y * w + x] ? 1 : -1) * Math.min(left[x], right[x], 600);
      return d;
    };
    const da = sdf(ya), db = sdf(yb);
    for (let y = ya + 1; y < yb; y++) {
      const t = (y - ya) / (yb - ya);
      for (let x = 0; x < w; x++) land[y * w + x] = (1 - t) * da[x] + t * db[x] > 0 ? 1 : 0;
    }
  }
  // water the drawing implies but ink would otherwise hold in (e.g. the foam dots ringing a river delta)
  for (const poly of forceSea) {
    const xs = poly.map((p) => p[0]), ys = poly.map((p) => p[1]);
    for (let y = Math.max(0, Math.floor(Math.min(...ys))); y < Math.min(h, Math.ceil(Math.max(...ys))); y++) {
      for (let x = Math.max(0, Math.floor(Math.min(...xs))); x < Math.min(w, Math.ceil(Math.max(...xs))); x++) {
        let inside = false;
        for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) { const [xa, ya2] = poly[a], [xb, yb2] = poly[b]; if ((ya2 > y) !== (yb2 > y) && x < ((xb - xa) * (y - ya2)) / (yb2 - ya2) + xa) inside = !inside; }
        if (inside) land[y * w + x] = 0;
      }
    }
  }
  return { w, h, land };
}

/** Rendered (colour) map: textured blue sea vs everything else. Returns land=1 mask at regional resolution. */
export function colorLandMask(file, { smooth = 3 } = {}) {
  const { width: w, height: h, data } = loadJpeg(file);
  const sea = { w, h, v: new Float32Array(w * h) };
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    sea.v[i] = b > r * 1.3 && b > g * 1.05 && b > 50 ? 1 : 0;
  }
  const s = boxBlur(sea, smooth);
  const land = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) land[i] = s.v[i] > 0.5 ? 0 : 1;
  return { w, h, land };
}

/**
 * @param {string} file  regional jpg
 * @param {{scale:number, ox:number, oy:number}} reg  world = origin + scale * regionalPx
 * @param {object} opts  { inkThreshold, close, zoneBlur, zoneMin }
 * @returns {{w,h,land:Uint8Array}}  land=1 / sea=0 at regional resolution
 */
export function regionalLandMask(file, world, reg, opts = {}) {
  const { inkThreshold = 170, close = 2, zoneBlur = 2, zoneMin = 0.05, openSea = 0 } = opts;
  const img = loadJpeg(file);
  const { width: w, height: h, data } = img;
  const n = w * h;

  const ink = new Uint8Array(n);
  for (let i = 0; i < n; i++) ink[i] = 0.3 * data[i * 4] + 0.59 * data[i * 4 + 1] + 0.11 * data[i * 4 + 2] < inkThreshold ? 1 : 0;
  const wall = dilate(ink, w, h, close);

  const sea = boxBlur(worldSeaField(world), zoneBlur);
  const raw = worldSeaField(world);
  const zone = new Uint8Array(n), seaish = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const u = reg.ox + reg.scale * (x + 0.5), v = reg.oy + reg.scale * (y + 0.5);
      const i = y * w + x;
      zone[i] = sample(sea, u, v) > zoneMin ? 1 : 0;
      seaish[i] = sample(raw, u, v) > 0.5 ? 1 : 0;
    }
  }

  // label non-wall pixels inside the zone, classify each component by how much of it is world-sea
  const label = new Int32Array(n);
  const isSea = new Uint8Array(n);
  const stack = new Int32Array(n);
  let nextLabel = 0;
  for (let start = 0; start < n; start++) {
    if (wall[start] || !zone[start] || label[start]) continue;
    nextLabel++;
    let sp = 0, count = 0, seaCount = 0;
    const members = [];
    stack[sp++] = start; label[start] = nextLabel;
    while (sp) {
      const p = stack[--sp];
      members.push(p); count++; seaCount += seaish[p];
      const x = p % w, y = (p - x) / w;
      if (x > 0 && !wall[p - 1] && zone[p - 1] && !label[p - 1]) { label[p - 1] = nextLabel; stack[sp++] = p - 1; }
      if (x < w - 1 && !wall[p + 1] && zone[p + 1] && !label[p + 1]) { label[p + 1] = nextLabel; stack[sp++] = p + 1; }
      if (y > 0 && !wall[p - w] && zone[p - w] && !label[p - w]) { label[p - w] = nextLabel; stack[sp++] = p - w; }
      if (y < h - 1 && !wall[p + w] && zone[p + w] && !label[p + w]) { label[p + w] = nextLabel; stack[sp++] = p + w; }
    }
    if (seaCount / count >= 0.5) for (const p of members) isSea[p] = 1;
  }

  // ink / wall touching sea becomes sea too (coast lines, labels floating in the water)
  const grown = dilate(isSea, w, h, close + 2);
  let seaMask = new Uint8Array(n);
  for (let i = 0; i < n; i++) seaMask[i] = isSea[i] || (grown[i] && wall[i]) ? 1 : 0;
  // drop sea slivers (e.g. the drawn shore band between a double coastline); wide bays survive
  seaMask = openMask(seaMask, w, h, openSea);
  const land = new Uint8Array(n);
  for (let i = 0; i < n; i++) land[i] = seaMask[i] ? 0 : 1;
  return { w, h, land, ink: wall, zone };
}
