// Turn a generated sheet of map symbols (on a flat key colour) into individual transparent PNGs.
//   node process_sheet.mjs <sheet.png|jpg> <prefix> [--names a,b,c] [--key #FF00FF] [--size 128]
//                          [--tolerance 90] [--gap 12] [--out ../atlas/symbols] [--debug]
// Writes <out>/<prefix>-<name|index>.png and merges them into <out>/manifest.json.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import jpeg from 'jpeg-js';

const { PNG } = createRequire(import.meta.url)('pngjs');

const argv = process.argv.slice(2);
const positional = [];
const opt = {};
for (let i = 0; i < argv.length; i++) {
  if (argv[i].startsWith('--')) {
    const k = argv[i].slice(2);
    if (k === 'debug' || k === 'append') opt[k] = true;
    else opt[k] = argv[++i];
  } else positional.push(argv[i]);
}
const [sheetFile, prefix] = positional;
if (!sheetFile || !prefix) { console.error('usage: node process_sheet.mjs <sheet> <prefix> [options]'); process.exit(1); }
const OUT = path.resolve(opt.out || path.join('..', 'atlas', 'symbols'));
const SIZE = Number(opt.size || 128);
const TOL = Number(opt.tolerance || 90);
const names = opt.names ? opt.names.split(',') : null;

// ---- load ----
function load(file) {
  const buf = fs.readFileSync(file);
  if (/\.jpe?g$/i.test(file)) { const { width, height, data } = jpeg.decode(buf, { useTArray: true }); return { width, height, data: Uint8Array.from(data) }; }
  const p = PNG.sync.read(buf);
  return { width: p.width, height: p.height, data: Uint8Array.from(p.data) };
}
const img = load(sheetFile);
const { width: W, height: H, data } = img;
const N = W * H;

// ---- key colour ----
function cornerKey() {
  const samples = [];
  const s = Math.max(4, Math.round(Math.min(W, H) * 0.02));
  for (const [x0, y0] of [[0, 0], [W - s, 0], [0, H - s], [W - s, H - s]]) {
    let r = 0, g = 0, b = 0;
    for (let y = y0; y < y0 + s; y++) for (let x = x0; x < x0 + s; x++) { const i = (y * W + x) * 4; r += data[i]; g += data[i + 1]; b += data[i + 2]; }
    const n = s * s; samples.push([r / n, g / n, b / n]);
  }
  samples.sort((a, b) => a[0] + a[1] + a[2] - (b[0] + b[1] + b[2]));
  return samples[1]; // a middle sample, robust to one odd corner
}
const KEY = opt.key
  ? [parseInt(opt.key.slice(1, 3), 16), parseInt(opt.key.slice(3, 5), 16), parseInt(opt.key.slice(5, 7), 16)]
  : cornerKey();
console.log('key colour', KEY.map(Math.round).join(','));
const dist = (i) => Math.hypot(data[i * 4] - KEY[0], data[i * 4 + 1] - KEY[1], data[i * 4 + 2] - KEY[2]);

// ---- background = flood from the border through key-coloured pixels, plus any pocket that is almost pure key ----
const bg = new Uint8Array(N);
const stack = [];
const push = (p) => { if (!bg[p] && dist(p) < TOL) { bg[p] = 1; stack.push(p); } };
for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
while (stack.length) {
  const p = stack.pop(), x = p % W, y = (p - x) / W;
  if (x > 0) push(p - 1); if (x < W - 1) push(p + 1); if (y > 0) push(p - W); if (y < H - 1) push(p + W);
}
for (let i = 0; i < N; i++) if (!bg[i] && dist(i) < TOL * 0.5) bg[i] = 1;

// ---- soft alpha near the background edge, then unmix the key colour out of the edge pixels ----
const near = new Uint8Array(N);
for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
  const p = y * W + x;
  if (bg[p]) continue;
  if (bg[p - 1] || bg[p + 1] || bg[p - W] || bg[p + W] || bg[p - W - 1] || bg[p - W + 1] || bg[p + W - 1] || bg[p + W + 1]) near[p] = 1;
}
const rgba = new Uint8Array(N * 4);
for (let i = 0; i < N; i++) {
  let a = bg[i] ? 0 : 1;
  let r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
  if (near[i]) {
    const d = dist(i), lo = TOL * 0.5, hi = TOL * 1.6;
    a = Math.max(0.0, Math.min(1, (d - lo) / (hi - lo)));
    if (a > 0.04) { r = (r - (1 - a) * KEY[0]) / a; g = (g - (1 - a) * KEY[1]) / a; b = (b - (1 - a) * KEY[2]) / a; }
  }
  rgba[i * 4] = Math.max(0, Math.min(255, r)); rgba[i * 4 + 1] = Math.max(0, Math.min(255, g)); rgba[i * 4 + 2] = Math.max(0, Math.min(255, b));
  rgba[i * 4 + 3] = Math.round(a * 255);
}

if (opt.debug) {
  const p = new PNG({ width: W, height: H }); p.data = Buffer.from(rgba);
  fs.writeFileSync(sheetFile.replace(/\.\w+$/, '') + '.keyed.png', PNG.sync.write(p));
}

// ---- find symbols: dilate the opaque mask so loose parts of one symbol join, then label ----
const GAP = Number(opt.gap || Math.max(6, Math.round(W * 0.006)));
const solid = new Uint8Array(N);
for (let i = 0; i < N; i++) solid[i] = rgba[i * 4 + 3] > 128 ? 1 : 0;
function dilate(mask, r) {
  const tmp = new Uint8Array(N), out = new Uint8Array(N);
  for (let y = 0; y < H; y++) { let last = -1e9; const d = new Int32Array(W).fill(1e9);
    for (let x = 0; x < W; x++) { if (mask[y * W + x]) last = x; d[x] = x - last; }
    last = 1e9; for (let x = W - 1; x >= 0; x--) { if (mask[y * W + x]) last = x; d[x] = Math.min(d[x], last - x); }
    for (let x = 0; x < W; x++) tmp[y * W + x] = d[x] <= r ? 1 : 0; }
  for (let x = 0; x < W; x++) { let last = -1e9; const d = new Int32Array(H).fill(1e9);
    for (let y = 0; y < H; y++) { if (tmp[y * W + x]) last = y; d[y] = y - last; }
    last = 1e9; for (let y = H - 1; y >= 0; y--) { if (tmp[y * W + x]) last = y; d[y] = Math.min(d[y], last - y); }
    for (let y = 0; y < H; y++) out[y * W + x] = d[y] <= r ? 1 : 0; }
  return out;
}
const joined = dilate(solid, GAP);
const label = new Int32Array(N);
const comps = [];
for (let s = 0; s < N; s++) {
  if (!joined[s] || label[s]) continue;
  const id = comps.length + 1;
  const c = { id, x0: W, y0: H, x1: -1, y1: -1, area: 0 };
  const st = [s]; label[s] = id;
  while (st.length) {
    const p = st.pop(), x = p % W, y = (p - x) / W;
    if (solid[p]) { c.area++; if (x < c.x0) c.x0 = x; if (x > c.x1) c.x1 = x; if (y < c.y0) c.y0 = y; if (y > c.y1) c.y1 = y; }
    for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) if (q >= 0 && joined[q] && !label[q]) { label[q] = id; st.push(q); }
  }
  if (c.x1 >= 0) comps.push(c);
}
const areas = comps.map((c) => c.area).sort((a, b) => a - b);
const medianArea = areas[Math.floor(areas.length / 2)] || 1;
let symbols = comps.filter((c) => c.area > medianArea * 0.12);
console.log(`found ${comps.length} blobs, keeping ${symbols.length} symbols (median area ${medianArea}px)`);

// reading order: group into rows by vertical centre
const medH = symbols.map((c) => c.y1 - c.y0).sort((a, b) => a - b)[Math.floor(symbols.length / 2)] || 1;
symbols.sort((a, b) => (a.y0 + a.y1) / 2 - (b.y0 + b.y1) / 2);
const rows = [];
for (const s of symbols) {
  const cy = (s.y0 + s.y1) / 2;
  const row = rows.find((r) => Math.abs(r.cy - cy) < medH * 0.6);
  if (row) { row.items.push(s); row.cy = (row.cy * (row.items.length - 1) + cy) / row.items.length; } else rows.push({ cy, items: [s] });
}
symbols = rows.sort((a, b) => a.cy - b.cy).flatMap((r) => r.items.sort((a, b) => a.x0 - b.x0));

// ---- crop, scale (one common scale so relative sizes are kept), write ----
const longest = Math.max(...symbols.map((c) => Math.max(c.x1 - c.x0 + 1, c.y1 - c.y0 + 1)));
const scale = SIZE / longest;
function crop(c) {
  const w = c.x1 - c.x0 + 1, h = c.y1 - c.y0 + 1;
  const out = new Float32Array(w * h * 4); // premultiplied
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const p = (c.y0 + y) * W + c.x0 + x;
    // only keep pixels that belong to this symbol's blob (neighbouring symbols can overlap its bounding box)
    const a = (rgba[p * 4 + 3] / 255) * (label[p] === c.id ? 1 : 0);
    out[(y * w + x) * 4] = rgba[p * 4] * a; out[(y * w + x) * 4 + 1] = rgba[p * 4 + 1] * a; out[(y * w + x) * 4 + 2] = rgba[p * 4 + 2] * a; out[(y * w + x) * 4 + 3] = a;
  }
  return { w, h, v: out };
}
function resize(m, s) {
  const nw = Math.max(1, Math.round(m.w * s)), nh = Math.max(1, Math.round(m.h * s));
  const out = new Float32Array(nw * nh * 4);
  const sx = m.w / nw, sy = m.h / nh;
  for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
    const x0 = x * sx, x1 = (x + 1) * sx, y0 = y * sy, y1 = (y + 1) * sy;
    let acc = [0, 0, 0, 0], wsum = 0;
    for (let yy = Math.floor(y0); yy < Math.min(m.h, Math.ceil(y1)); yy++) for (let xx = Math.floor(x0); xx < Math.min(m.w, Math.ceil(x1)); xx++) {
      const w = (Math.min(x1, xx + 1) - Math.max(x0, xx)) * (Math.min(y1, yy + 1) - Math.max(y0, yy));
      for (let k = 0; k < 4; k++) acc[k] += m.v[(yy * m.w + xx) * 4 + k] * w;
      wsum += w;
    }
    for (let k = 0; k < 4; k++) out[(y * nw + x) * 4 + k] = acc[k] / wsum;
  }
  return { w: nw, h: nh, v: out };
}

fs.mkdirSync(OUT, { recursive: true });
const manifestFile = path.join(OUT, 'manifest.json');
const manifest = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')) : { images: {}, categories: {} };
// replace this prefix's symbols, unless --append (e.g. adding pines to the tree set)
if (!opt.append) {
  for (const k of Object.keys(manifest.images)) if (k.startsWith(prefix + '-')) { try { fs.unlinkSync(path.join(OUT, manifest.images[k].file)); } catch {} delete manifest.images[k]; }
  manifest.categories[prefix] = [];
}
manifest.categories[prefix] ??= [];
const offset = opt.append ? manifest.categories[prefix].length : 0;

symbols.forEach((c, idx) => {
  const small = resize(crop(c), Math.min(scale, 4));
  const PAD = 1;
  const w = small.w + PAD * 2, h = small.h + PAD * 2;
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < small.h; y++) for (let x = 0; x < small.w; x++) {
    const i = (y * small.w + x) * 4, o = ((y + PAD) * w + x + PAD) * 4, a = small.v[i + 3];
    if (a <= 0.001) continue;
    png.data[o] = Math.min(255, Math.round(small.v[i] / a)); png.data[o + 1] = Math.min(255, Math.round(small.v[i + 1] / a)); png.data[o + 2] = Math.min(255, Math.round(small.v[i + 2] / a));
    png.data[o + 3] = Math.round(Math.min(1, a) * 255);
  }
  const name = names ? names[idx] ?? String(idx) : String(offset + idx);
  const file = `${prefix}-${name}.png`;
  fs.writeFileSync(path.join(OUT, file), PNG.sync.write(png));
  manifest.images[`${prefix}-${name}`] = { file, w, h };
  manifest.categories[prefix].push(`${prefix}-${name}`);
});
fs.writeFileSync(manifestFile, JSON.stringify(manifest, null, 1));
console.log(`wrote ${symbols.length} symbols to ${OUT} (scale ${scale.toFixed(3)}, longest source side ${longest}px -> ${SIZE}px)`);
