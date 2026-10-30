// Draw an island's traced coast (and islets) over its source image, to check the tracing. usage: node debug_island_overlay.mjs id out.jpg
import fs from 'node:fs';
import path from 'node:path';
import { loadJpeg, saveJpeg } from './lib.mjs';

const [id, out] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync('source/islands.json', 'utf8'));
const isl = cfg.islands.find((i) => i.id === id);
const img = loadJpeg(path.resolve('..', 'original_data/maps', isl.map));
const { width: W, height: H, data } = img;
const buf = Buffer.from(data);
for (let i = 0; i < W * H; i++) buf[i * 4 + 3] = 255;
const put = (x, y, c) => { for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const xx = Math.round(x) + dx, yy = Math.round(y) + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) { const k = (yy * W + xx) * 4; buf[k] = c[0]; buf[k + 1] = c[1]; buf[k + 2] = c[2]; } } };
const ring = (pts, c) => pts.forEach((a, i) => { const b = pts[(i + 1) % pts.length]; const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])); for (let t = 0; t <= n; t++) put(a[0] + ((b[0] - a[0]) * t) / n, a[1] + ((b[1] - a[1]) * t) / n, c); });
ring(isl.coast, [255, 0, 0]);
for (const r of isl.islets || []) ring(r, [255, 0, 0]);
for (const l of isl.lakes || []) if (l.poly) ring(l.poly, [0, 120, 255]);
for (const f of isl.features) ring(f.poly, [255, 0, 255]);
saveJpeg(out, W, H, buf);
