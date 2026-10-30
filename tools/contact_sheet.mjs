// Preview a folder of transparent PNGs on parchment: one row per subfolder, first N files each.
// usage: node contact_sheet.mjs <dir> <out.jpg> [--per 6] [--cell 120] [--dirs a,b]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import jpeg from 'jpeg-js';
const { PNG } = createRequire(import.meta.url)('pngjs');

const args = process.argv.slice(2);
const [dir, out] = args;
const opt = Object.fromEntries(args.slice(2).reduce((a, v, i, arr) => (v.startsWith('--') ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const PER = Number(opt.per || 6), CELL = Number(opt.cell || 120);
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true });
let subdirs = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort(natural);
if (opt.dirs) subdirs = opt.dirs.split(',');
if (!subdirs.length) subdirs = ['.'];

let rows = subdirs.map((s) => ({ name: s, files: fs.readdirSync(path.join(dir, s)).filter((f) => /\.png$/i.test(f)).sort(natural) })).filter((r) => r.files.length);
if (opt.wrap) rows = rows.flatMap((r) => Array.from({ length: Math.ceil(r.files.length / PER) }, (_, i) => ({ name: r.name, files: r.files.slice(i * PER, (i + 1) * PER), start: i * PER })));
else rows = rows.map((r) => ({ ...r, files: r.files.slice(0, PER) }));
const W = CELL * PER, H = CELL * rows.length;
const buf = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H; i++) { buf[i * 4] = 233; buf[i * 4 + 1] = 223; buf[i * 4 + 2] = 192; buf[i * 4 + 3] = 255; }
rows.forEach((row, r) => {
  console.log(`row ${r}: ${row.name} (${row.files.length} shown)`);
  row.files.forEach((f, c) => {
    const p = PNG.sync.read(fs.readFileSync(path.join(dir, row.name, f)));
    const s = Math.min((CELL - 8) / p.width, (CELL - 8) / p.height, 1.5);
    const nw = Math.max(1, Math.round(p.width * s)), nh = Math.max(1, Math.round(p.height * s));
    const ox = c * CELL + Math.round((CELL - nw) / 2), oy = r * CELL + CELL - 4 - nh;
    for (let y = 0; y < nh; y++) for (let x = 0; x < nw; x++) {
      // box-average source pixels under this destination pixel (premultiplied)
      const x0 = Math.floor(x / s), x1 = Math.max(x0 + 1, Math.min(p.width, Math.ceil((x + 1) / s)));
      const y0 = Math.floor(y / s), y1 = Math.max(y0 + 1, Math.min(p.height, Math.ceil((y + 1) / s)));
      let R = 0, G = 0, B = 0, A = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { const i = (yy * p.width + xx) * 4, a = p.data[i + 3] / 255; R += p.data[i] * a; G += p.data[i + 1] * a; B += p.data[i + 2] * a; A += a; n++; }
      if (!n || A === 0) continue;
      const a = A / n, d = ((oy + y) * W + ox + x) * 4;
      buf[d] = Math.round(R / n + buf[d] * (1 - a)); buf[d + 1] = Math.round(G / n + buf[d + 1] * (1 - a)); buf[d + 2] = Math.round(B / n + buf[d + 2] * (1 - a));
    }
  });
});
fs.writeFileSync(out, jpeg.encode({ data: buf, width: W, height: H }, 90).data);
