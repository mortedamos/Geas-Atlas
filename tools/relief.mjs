// Relative elevation for the whole map, for the Relief view (atlas/relief.js).
//   usage (after interior.mjs):  node relief.mjs ../atlas/data
// Nobody drew heights, so they are read off what is on the map: the land rises gently away from the coast; mountain and hill areas
// (blurred, so ranges have slopes) and every mountain / hill symbol add peaks; ridged noise roughens the mountains; marsh is pulled flat,
// lakes sit in basins, and the sea floor deepens away from the coast. Heights are relative (1.0 = the highest peaks), not feet or miles.
// Output: relief.bin (Uint16 little-endian, row-major, north first) + relief.json (grid placement and the height range it encodes).
import fs from 'node:fs';
import path from 'node:path';

const dataDir = path.resolve(process.argv[2] || '../atlas/data');
const rd = (f) => JSON.parse(fs.readFileSync(path.join(dataDir, f), 'utf8'));
const px = ([lng, lat]) => [lng * 51.2 + 512, 512 - lat * 51.2];

// the grid covers the land and its shallows, one cell per world px
const X0 = -840, Y0 = -180, CELL = 1, GW = 2030, GH = 1720;
const N = GW * GH;
const H_MIN = -0.5, H_MAX = 1.1;

// ---------- small tools ----------
function polysOf(g) { return g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []; }
function fill(mask, polys) { // even-odd scanline fill of polygons (rings in lng/lat) into a Uint8 mask
  for (const rings of polys) {
    const rows = new Map();
    for (const ring of rings) {
      const pts = ring.map((c) => { const [x, y] = px(c); return [(x - X0) / CELL, (y - Y0) / CELL]; });
      for (let i = 0; i < pts.length - 1; i++) {
        let [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
        if (y1 === y2) continue;
        if (y1 > y2) [x1, y1, x2, y2] = [x2, y2, x1, y1];
        const r0 = Math.max(0, Math.ceil(y1 - 0.5)), r1 = Math.min(GH - 1, Math.floor(y2 - 0.5));
        for (let r = r0; r <= r1; r++) {
          const y = r + 0.5;
          if (y < y1 || y >= y2) continue;
          const x = x1 + ((x2 - x1) * (y - y1)) / (y2 - y1);
          (rows.get(r) || rows.set(r, []).get(r)).push(x);
        }
      }
    }
    for (const [r, xs] of rows) {
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const a = Math.max(0, Math.ceil(xs[k] - 0.5)), b = Math.min(GW - 1, Math.floor(xs[k + 1] - 0.5));
        for (let c = a; c <= b; c++) mask[r * GW + c] = 1;
      }
    }
  }
}
const maskOf = (features) => { const m = new Uint8Array(N); for (const f of features) fill(m, polysOf(f.geometry)); return m; };

function boxBlur(src, radius, passes = 3) { // separable box blur, repeated: close to a gaussian of sigma ~ radius*0.58*sqrt(passes)
  let a = Float32Array.from(src), b = new Float32Array(N);
  const win = radius * 2 + 1;
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < GH; y++) {
      let s = 0; const o = y * GW;
      for (let x = -radius; x <= radius; x++) s += a[o + Math.min(GW - 1, Math.max(0, x))];
      for (let x = 0; x < GW; x++) { b[o + x] = s / win; s += a[o + Math.min(GW - 1, x + radius + 1)] - a[o + Math.max(0, x - radius)]; }
    }
    for (let x = 0; x < GW; x++) {
      let s = 0;
      for (let y = -radius; y <= radius; y++) s += b[Math.min(GH - 1, Math.max(0, y)) * GW + x];
      for (let y = 0; y < GH; y++) { a[y * GW + x] = s / win; s += b[Math.min(GH - 1, y + radius + 1) * GW + x] - b[Math.max(0, y - radius) * GW + x]; }
    }
  }
  return a;
}

function edt(isSource) { // distance (cells) from every cell to the nearest cell where isSource is true (Felzenszwalb)
  const INF = 1e12, f = new Float32Array(N);
  for (let i = 0; i < N; i++) f[i] = isSource[i] ? 0 : INF;
  const pass = (len, stride, count, offsetOf) => {
    const v = new Int32Array(len), z = new Float32Array(len + 1), d = new Float32Array(len);
    for (let line = 0; line < count; line++) {
      const o = offsetOf(line);
      let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
      for (let q = 1; q < len; q++) {
        let s;
        for (;;) {
          const p = v[k];
          s = ((f[o + q * stride] + q * q) - (f[o + p * stride] + p * p)) / (2 * q - 2 * p);
          if (s <= z[k] && k > 0) k--; else break;
        }
        k++; v[k] = q; z[k] = s; z[k + 1] = INF;
      }
      k = 0;
      for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; const p = v[k]; d[q] = (q - p) * (q - p) + f[o + p * stride]; }
      for (let q = 0; q < len; q++) f[o + q * stride] = d[q];
    }
  };
  pass(GH, GW, GW, (c) => c); // down each column
  pass(GW, 1, GH, (r) => r * GW); // along each row
  for (let i = 0; i < N; i++) f[i] = Math.sqrt(f[i]);
  return f;
}

// seeded value noise
function hash(ix, iy, seed) { let h = (ix * 374761393 + iy * 668265263 + seed * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; h = h ^ (h >>> 16); return ((h >>> 0) % 100000) / 100000; }
const smooth = (t) => t * t * (3 - 2 * t);
const lerp = (a, b, t) => a + (b - a) * t;
function vnoise(x, y, seed) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
  const a = hash(ix, iy, seed), b = hash(ix + 1, iy, seed), c = hash(ix, iy + 1, seed), d = hash(ix + 1, iy + 1, seed);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}
const ROT = Array.from({ length: 8 }, (_, o) => [Math.cos(0.83 * o + 0.4), Math.sin(0.83 * o + 0.4)]); // a different turn for each octave
const fbm = (x, y, seed, wave, octaves = 4) => { let s = 0, a = 0.5, w = wave, n = 0; for (let o = 0; o < octaves; o++) { const [c, d] = ROT[o]; s += a * vnoise((x * c - y * d) / w + 31 * o, (x * d + y * c) / w - 17 * o, seed + o * 17); n += a; a *= 0.5; w /= 2; } return s / n; }; // 0..1
const ridged = (x, y, seed, wave) => { let s = 0, a = 0.55, w = wave, n = 0; for (let o = 0; o < 4; o++) { const [c, d] = ROT[o]; const v = 1 - Math.abs(2 * vnoise((x * c - y * d) / w + 13 * o, (x * d + y * c) / w - 29 * o, seed + o * 31) - 1); s += a * v * v; n += a; a *= 0.5; w /= 2; } return s / n; }; // sharp crests, 0..1
// the same, stretched along a direction (radians): crests run in lines along it, like a range (the paper's "skewed" spectrum)
const ridgedAlong = (x, y, seed, wave, theta, stretch = 2.6) => { const c = Math.cos(theta), d = Math.sin(theta); return ridged((x * c + y * d) / stretch, -x * d + y * c, seed, wave); };

// ---------- inputs ----------
const land = rd('land.geojson'), terrain = rd('terrain.geojson'), lakes = rd('lakes.geojson'), icons = rd('icons.geojson');
const landM = maskOf(land.features);
const byKind = (k) => maskOf(terrain.features.filter((f) => f.properties.kind === k));
const mountM = byKind('mountain'), hillM = byKind('hills'), iceM = byKind('ice'), marshM = byKind('marsh'), wasteM = byKind('waste'), lakeM = maskOf(lakes.features);
console.log('masks done; land cells', landM.reduce((a, v) => a + v, 0));

const dLand = boxBlur(edt(landM), 5, 2); // for sea cells: distance to the coast (blurred so the sea floor has no streaks)
const dSea = edt(landM.map((v) => (v ? 0 : 1))); // for land cells: distance to the sea
const grow = (a, k) => a.map((v) => Math.min(1, v * k)); // wide blurs thin out narrow ranges; scale them back up
const Mb = grow(boxBlur(mountM, 7), 1.6), Hb = grow(boxBlur(hillM, 6), 1.4), Ib = boxBlur(iceM, 6), Sb = boxBlur(marshM, 3), Wb = boxBlur(wasteM, 3);

// symbol bumps: each mountain / hill symbol raises a rounded peak; the highest bump wins where they overlap
function bumps(kind, radius, amp) {
  const P = new Float32Array(N);
  for (const f of icons.features) {
    if (f.properties.kind !== kind) continue;
    const [x, y] = px(f.geometry.coordinates), cx = (x - X0) / CELL, cy = (y - Y0) / CELL;
    const a = amp * (0.7 + 0.5 * Math.min(1, (f.properties.s || 0.8) / 1.0)) * (0.8 + 0.4 * hash(Math.round(x * 10), Math.round(y * 10), 5));
    for (let j = Math.max(0, Math.floor(cy - radius * 2)); j <= Math.min(GH - 1, Math.ceil(cy + radius * 2)); j++) {
      for (let i = Math.max(0, Math.floor(cx - radius * 2)); i <= Math.min(GW - 1, Math.ceil(cx + radius * 2)); i++) {
        const r2 = ((i - cx) ** 2 + (j - cy) ** 2) / (radius * radius), v = a * Math.exp(-r2 * 0.9);
        if (v > P[j * GW + i]) P[j * GW + i] = v;
      }
    }
  }
  return P;
}
const Mwide = boxBlur(mountM, 22, 3); // very wide blur: the slope of this points across a range
const Pm = bumps('mountain', 3.2, 0.34), Ph = bumps('hills', 3.6, 0.1);

// ---------- elevation ----------
const H = new Float32Array(N);
let hi = -9, lo = 9;
for (let j = 0; j < GH; j++) {
  for (let i = 0; i < GW; i++) {
    const k = j * GW + i, x = X0 + i * CELL, y = Y0 + j * CELL;
    let h;
    if (landM[k]) {
      const inland = 1 - Math.exp(-dSea[k] / 80);
      h = 0.03 + 0.10 * inland + 0.04 * (fbm(x, y, 3, 160, 3) - 0.5);
      // crests run along the range where it has a clear direction, and are tangled where it has none
      const g = 5, gx = Mwide[j * GW + Math.min(GW - 1, i + g)] - Mwide[j * GW + Math.max(0, i - g)], gy = Mwide[Math.min(GH - 1, j + g) * GW + i] - Mwide[Math.max(0, j - g) * GW + i], mag = Math.hypot(gx, gy), along = Math.min(1, mag / 0.02);
      const crest = lerp(ridged(x, y, 11, 38), ridgedAlong(x, y, 11, 38, Math.atan2(gy, gx) + Math.PI / 2), along);
      h += 0.36 * Mb[k] + Pm[k] * (0.3 + 0.7 * Mb[k]) + Mb[k] * 0.17 * crest;
      h += 0.11 * Hb[k] + Ph[k] * (0.4 + 0.6 * Hb[k]) + Hb[k] * 0.04 * fbm(x, y, 23, 14, 3);
      h += 0.10 * Ib[k] + 0.04 * Wb[k];
      h += (0.012 + 0.03 * Hb[k]) * (fbm(x, y, 41, 9, 3) - 0.5) * 2;
      h = h * (1 - 0.85 * Sb[k]) + 0.012 * Sb[k]; // marsh lies flat, just above the sea
      if (lakeM[k]) h = 0.006; // lakes sit in basins
      h = Math.max(0.008, h);
    } else {
      h = -0.34 * (1 - Math.exp(-dLand[k] / 55)) + 0.02 * (fbm(x, y, 57, 50, 3) - 0.5);
      h = Math.min(h, -0.004);
    }
    H[k] = h;
  }
}
const Hs = boxBlur(H, 1, 2); // soften the one-cell stair-steps
for (let k = 0; k < N; k++) { if (landM[k]) Hs[k] = Math.max(0.006, Hs[k]); else Hs[k] = Math.min(-0.002, Hs[k]); hi = Math.max(hi, Hs[k]); lo = Math.min(lo, Hs[k]); }
console.log('height range', lo.toFixed(3), hi.toFixed(3));

// ---------- write ----------
const out = Buffer.alloc(N * 2);
for (let k = 0; k < N; k++) out.writeUInt16LE(Math.round(((Math.min(H_MAX, Math.max(H_MIN, Hs[k])) - H_MIN) / (H_MAX - H_MIN)) * 65535), k * 2);
fs.writeFileSync(path.join(dataDir, 'relief.bin'), out);
fs.writeFileSync(path.join(dataDir, 'relief.json'), JSON.stringify({ x0: X0, y0: Y0, cell: CELL, w: GW, h: GH, hMin: H_MIN, hMax: H_MAX, note: 'Uint16 LE, row-major from the north edge; height = hMin + v/65535*(hMax-hMin). Relative elevation, 1.0 = the highest peaks.' }));
console.log('relief.bin', (out.length / 1e6).toFixed(1), 'MB');
