// Find where a hand-drawn regional map was pasted into the world map by normalised cross-correlation
// of ink (dark strokes). Searches scale and translation.
// usage: node register_ink.mjs regional.jpg cropX0 cropY0 cropX1 cropY1(in regional px) sMin sMax sStep wx0 wy0 wx1 wy1(world search window for top-left of crop)
import path from 'node:path';
import { loadJpeg, inkMap, resizeBox, boxBlur } from './lib.mjs';

const args = process.argv.slice(2);
const regionalFile = args[0];
const [cx0, cy0, cx1, cy1, sMin, sMax, sStep, wx0, wy0, wx1, wy1] = args.slice(1).map(Number);
const world = loadJpeg(path.resolve('..', 'original_data/web/img/gallery/maps/geas_worldmap_big.jpg'));
const regional = loadJpeg(regionalFile);

const W = boxBlur(inkMap(world, { ignoreOcean: true }), 1);
// Crop regional to the part we trust is present in the world composite.
const R0 = inkMap(regional);
const cropW = cx1 - cx0, cropH = cy1 - cy0;
const cropped = { w: cropW, h: cropH, v: new Float32Array(cropW * cropH) };
for (let y = 0; y < cropH; y++) for (let x = 0; x < cropW; x++) cropped.v[y * cropW + x] = R0.v[(y + cy0) * R0.w + x + cx0];

// integral images for window mean/variance of world
const iw = W.w, ih = W.h;
const I1 = new Float64Array((iw + 1) * (ih + 1)), I2 = new Float64Array((iw + 1) * (ih + 1));
for (let y = 0; y < ih; y++) {
  let r1 = 0, r2 = 0;
  for (let x = 0; x < iw; x++) {
    const v = W.v[y * iw + x];
    r1 += v; r2 += v * v;
    I1[(y + 1) * (iw + 1) + x + 1] = I1[y * (iw + 1) + x + 1] + r1;
    I2[(y + 1) * (iw + 1) + x + 1] = I2[y * (iw + 1) + x + 1] + r2;
  }
}
const rect = (I, x, y, w, h) => I[(y + h) * (iw + 1) + x + w] - I[y * (iw + 1) + x + w] - I[(y + h) * (iw + 1) + x] + I[y * (iw + 1) + x];

let best = [];
for (let s = sMin; s <= sMax + 1e-9; s += sStep) {
  const T = boxBlur(resizeBox(cropped, s), 1);
  const n = T.w * T.h;
  let tm = 0; for (const v of T.v) tm += v; tm /= n;
  let tv = 0; for (const v of T.v) tv += (v - tm) ** 2;
  const tz = new Float32Array(n); for (let i = 0; i < n; i++) tz[i] = T.v[i] - tm;
  for (let wy = wy0; wy <= wy1; wy++) {
    for (let wx = wx0; wx <= wx1; wx++) {
      if (wx + T.w > iw || wy + T.h > ih) continue;
      const s1 = rect(I1, wx, wy, T.w, T.h), s2 = rect(I2, wx, wy, T.w, T.h);
      const wvar = s2 - (s1 * s1) / n;
      if (wvar < 1e-3) continue;
      let dot = 0;
      for (let y = 0; y < T.h; y++) {
        const wrow = (wy + y) * iw + wx, trow = y * T.w;
        for (let x = 0; x < T.w; x++) dot += tz[trow + x] * W.v[wrow + x];
      }
      const ncc = dot / Math.sqrt(tv * wvar);
      best.push({ ncc, s, wx, wy });
    }
  }
  best.sort((a, b) => b.ncc - a.ncc);
  best = best.slice(0, 20);
}
for (const b of best.slice(0, 8)) {
  console.log(`ncc ${b.ncc.toFixed(3)} scale ${b.s.toFixed(4)} cropTopLeft -> world (${b.wx}, ${b.wy})  => regional origin (${(b.wx - cx0 * b.s).toFixed(1)}, ${(b.wy - cy0 * b.s).toFixed(1)})`);
}
