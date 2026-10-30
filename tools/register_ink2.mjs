// Like register_ink.mjs, but for large templates: samples the template on a stride and computes the correlation
// directly. Searches isotropic scale + translation of a (cropped) hand-drawn map inside the world composite.
// usage: node register_ink2.mjs regional.jpg cx0 cy0 cx1 cy1 sMin sMax sStep wx0 wy0 wx1 wy1 [stride=2] [inkThreshold]
import path from 'node:path';
import { loadJpeg, inkMap, resizeBox, boxBlur } from './lib.mjs';

const a = process.argv.slice(2);
const file = a[0];
const [cx0, cy0, cx1, cy1, sMin, sMax, sStep, wx0, wy0, wx1, wy1] = a.slice(1, 12).map(Number);
const stride = Number(a[12] || 2);
const world = loadJpeg(path.resolve('..', 'original_data/web/img/gallery/maps/geas_worldmap_big.jpg'));
const W = boxBlur(inkMap(world, { ignoreOcean: true }), 1);
const R0 = inkMap(loadJpeg(file));
const cw = cx1 - cx0, ch = cy1 - cy0;
const crop = { w: cw, h: ch, v: new Float32Array(cw * ch) };
for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) crop.v[y * cw + x] = R0.v[(y + cy0) * R0.w + x + cx0];

let best = [];
for (let s = sMin; s <= sMax + 1e-9; s += sStep) {
  const T = boxBlur(resizeBox(crop, s), 1);
  const pts = [];
  for (let y = 0; y < T.h; y += stride) for (let x = 0; x < T.w; x += stride) pts.push([x, y, T.v[y * T.w + x]]);
  const n = pts.length;
  let tm = 0; for (const p of pts) tm += p[2]; tm /= n;
  let tv = 0; for (const p of pts) tv += (p[2] - tm) ** 2;
  for (let wy = wy0; wy <= wy1; wy++) for (let wx = wx0; wx <= wx1; wx++) {
    if (wx + T.w > W.w || wy + T.h > W.h) continue;
    let sw = 0, sw2 = 0, dot = 0;
    for (const [x, y, t] of pts) { const v = W.v[(wy + y) * W.w + wx + x]; sw += v; sw2 += v * v; dot += (t - tm) * v; }
    const wvar = sw2 - (sw * sw) / n;
    if (wvar < 1e-3) continue;
    best.push({ ncc: dot / Math.sqrt(tv * wvar), s, wx, wy });
  }
  best.sort((p, q) => q.ncc - p.ncc); best = best.slice(0, 12);
}
for (const b of best.slice(0, 6)) console.log(`ncc ${b.ncc.toFixed(3)} scale ${b.s.toFixed(4)} crop-top-left -> world (${b.wx}, ${b.wy})  => image origin (${(b.wx - cx0 * b.s).toFixed(1)}, ${(b.wy - cy0 * b.s).toFixed(1)})`);
