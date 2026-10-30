// usage: node debug_mask.mjs regional.jpg scale ox oy out.jpg [inkThreshold] [close]
import { loadJpeg, saveJpeg } from './lib.mjs';
import { regionalLandMask } from './regional_mask.mjs';
import path from 'node:path';

const [file, s, ox, oy, out, thr, close] = process.argv.slice(2);
const world = loadJpeg(path.resolve('..', 'original_data/web/img/gallery/maps/geas_worldmap_big.jpg'));
const t0 = Date.now();
const m = regionalLandMask(file, world, { scale: +s, ox: +ox, oy: +oy }, { inkThreshold: thr ? +thr : 170, close: close ? +close : 2 });
console.log('mask', m.w, m.h, 'ms', Date.now() - t0);
const img = loadJpeg(file);
const px = Buffer.alloc(m.w * m.h * 4);
for (let i = 0; i < m.w * m.h; i++) {
  const g = img.data[i * 4];
  // land = tint green, sea = tint blue, keep original ink visible
  const tint = m.land[i] ? [120, 190, 100] : [90, 140, 220];
  const k = g / 255;
  px[i * 4] = tint[0] * k; px[i * 4 + 1] = tint[1] * k; px[i * 4 + 2] = tint[2] * k; px[i * 4 + 3] = 255;
}
saveJpeg(out, m.w, m.h, px);
