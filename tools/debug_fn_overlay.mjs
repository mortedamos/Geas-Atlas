// Draw the fitted Free Nations coastlines / paper footprint on top of the rendered Sellador map (debug image).
// usage: node debug_fn_overlay.mjs out.jpg
import fs from 'node:fs';
import path from 'node:path';
import { loadJpeg, saveJpeg } from './lib.mjs';

const MAPS = path.resolve('..', 'original_data/web/img/gallery/maps');
const fn = JSON.parse(fs.readFileSync('source/free-nations.json', 'utf8'));
const sel = JSON.parse(fs.readFileSync('source/sellador.json', 'utf8'));
const img = loadJpeg(path.join(MAPS, sel.map));
const { width: W, height: H, data } = img;
const t = fn.transform;
// FN px -> world px -> Sellador px
const toSel = ([x, y]) => {
  const c = Math.cos(t.rot), s = Math.sin(t.rot);
  const wx = t.ox + t.scale * (c * x - s * y), wy = t.oy + t.scale * (s * x + c * y);
  return [(wx - sel.ox) / sel.scale, (wy - sel.oy) / sel.scale];
};
const put = (x, y, r, g, b) => { x = Math.round(x); y = Math.round(y); if (x >= 0 && y >= 0 && x < W && y < H) for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) { const xx = x + dx, yy = y + dy; if (xx >= 0 && yy >= 0 && xx < W && yy < H) { const i = (yy * W + xx) * 4; data[i] = r; data[i + 1] = g; data[i + 2] = b; } } };
function line(a, b, col) { const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1])); for (let i = 0; i <= n; i++) put(a[0] + ((b[0] - a[0]) * i) / n, a[1] + ((b[1] - a[1]) * i) / n, ...col); }
const ring = (pts, col) => pts.map(toSel).forEach((p, i, arr) => line(p, arr[(i + 1) % arr.length], col));
ring(fn.land, [255, 255, 0]);
ring(fn.paper, [255, 0, 255]);
for (const f of fn.features) ring(f.poly, [0, 255, 255]);
const out = Buffer.alloc(W * H * 4);
for (let i = 0; i < W * H * 4; i++) out[i] = data[i];
for (let i = 0; i < W * H; i++) out[i * 4 + 3] = 255;
saveJpeg(process.argv[2], W, H, out);
