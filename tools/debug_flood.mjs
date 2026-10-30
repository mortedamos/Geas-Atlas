// Preview floodLandMask on the Curmeah drawing: land green / sea blue, ink dark. usage: node debug_flood.mjs out.jpg close [x y w h scale]
import { floodLandMask } from './regional_mask.mjs';
import { loadJpeg, saveJpeg } from './lib.mjs';
import path from 'node:path';

const [out, close, X, Y, CW, CH, S] = process.argv.slice(2);
const file = path.resolve('..', 'original_data/maps/curmeah_ink.jpg');
import fs from 'node:fs';
const def = JSON.parse(fs.readFileSync('source/curmeah.json', 'utf8'));
const m = floodLandMask(file, { close: Number(close || 16), minLand: 6000, seam: def.seam, ignore: def.ignore, forceSea: def.forceSea || [] });
const img = loadJpeg(file);
const [x0, y0, cw, ch, s] = X ? [X, Y, CW, CH, S].map(Number) : [0, 0, m.w, m.h, 0.5];
const ow = Math.round(cw * s), oh = Math.round(ch * s), buf = Buffer.alloc(ow * oh * 4);
for (let y = 0; y < oh; y++) for (let x = 0; x < ow; x++) {
  const sx = Math.min(m.w - 1, Math.floor(x0 + x / s)), sy = Math.min(m.h - 1, Math.floor(y0 + y / s)), i = sy * m.w + sx;
  const inkDark = img.data[i * 4] < 128;
  const c = inkDark ? [20, 20, 20] : m.land[i] ? [140, 200, 120] : [90, 140, 220];
  const d = (y * ow + x) * 4; buf[d] = c[0]; buf[d + 1] = c[1]; buf[d + 2] = c[2]; buf[d + 3] = 255;
}
saveJpeg(out, ow, oh, buf);
