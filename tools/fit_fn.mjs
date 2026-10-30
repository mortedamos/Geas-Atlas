// Find where the hand-drawn Free Nations map sits on the rendered Sellador map by fitting its two coastlines
// (the 'land' polygon) to the rendered land/sea mask. Writes the transform into source/free-nations.json
// (FN px -> world px) and prints the agreement score.
// usage: node fit_fn.mjs
import fs from 'node:fs';
import path from 'node:path';
import { colorLandMask } from './regional_mask.mjs';

const MAPS = path.resolve('..', 'original_data/web/img/gallery/maps');
const fnFile = 'source/free-nations.json';
const fn = JSON.parse(fs.readFileSync(fnFile, 'utf8'));
const sel = JSON.parse(fs.readFileSync('source/sellador.json', 'utf8'));
const R = colorLandMask(path.join(MAPS, sel.map), { smooth: 6 });

// raster of the FN land polygon and paper quad on a 4px grid over [-250,1050] x [0,700]
const CX0 = -250, CY0 = 0, CS = 4, CW = 325, CH = 175;
function raster(poly) {
  const m = new Uint8Array(CW * CH);
  for (let j = 0; j < CH; j++) for (let i = 0; i < CW; i++) {
    const x = CX0 + (i + 0.5) * CS, y = CY0 + (j + 0.5) * CS;
    let inside = false;
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
      const [xa, ya] = poly[a], [xb, yb] = poly[b];
      if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside;
    }
    m[j * CW + i] = inside ? 1 : 0;
  }
  return m;
}
const landM = raster(fn.land), paperM = raster(fn.paper);
const at = (m, x, y) => { const i = Math.floor((x - CX0) / CS), j = Math.floor((y - CY0) / CS); return i < 0 || j < 0 || i >= CW || j >= CH ? 0 : m[j * CW + i]; };

// rendered samples (east part of the Sellador map)
const STEP = 10, samples = [];
for (let y = 60; y < R.h; y += STEP) for (let x = 560; x < R.w; x += STEP) samples.push([x, y, R.land[y * R.w + x]]);

function score(s, th, tx, ty) {
  const c = Math.cos(th), sn = Math.sin(th);
  let agree = 0, total = 0;
  for (const [px, py, land] of samples) {
    const dx = (px - tx) / s, dy = (py - ty) / s;
    const fx = c * dx + sn * dy, fy = -sn * dx + c * dy; // inverse rotation
    if (!at(paperM, fx, fy)) continue;
    total++;
    if (at(landM, fx, fy) === land) agree++;
  }
  return total < 600 ? 0 : agree / total - 0.2 * Math.max(0, 1 - total / 2500); // mild bonus for covering more of the map
}

let best = { sc: 0 };
const deg = Math.PI / 180;
for (let s = 0.6; s <= 1.5; s += 0.1) for (let t = -20; t <= 20; t += 5) for (let tx = 150; tx <= 1000; tx += 25) for (let ty = -100; ty <= 700; ty += 25) {
  const sc = score(s, t * deg, tx, ty);
  if (sc > best.sc) best = { sc, s, th: t * deg, tx, ty };
}
console.log('coarse', best.sc.toFixed(3), `scale ${best.s.toFixed(2)} rot ${(best.th / deg).toFixed(0)}deg t=(${best.tx},${best.ty})`);
// refine around the best
for (const [ds, dt, dp] of [[0.05, 2.5, 10], [0.02, 1, 4], [0.01, 0.5, 2]]) {
  const c = { ...best };
  for (let s = c.s - 2 * ds; s <= c.s + 2 * ds + 1e-9; s += ds) for (let t = c.th / deg - 2 * dt; t <= c.th / deg + 2 * dt + 1e-9; t += dt)
    for (let tx = c.tx - 3 * dp; tx <= c.tx + 3 * dp; tx += dp) for (let ty = c.ty - 3 * dp; ty <= c.ty + 3 * dp; ty += dp) {
      const sc = score(s, t * deg, tx, ty);
      if (sc > best.sc) best = { sc, s, th: t * deg, tx, ty };
    }
}
console.log('refined', best.sc.toFixed(3), `scale ${best.s.toFixed(3)} rot ${(best.th / deg).toFixed(1)}deg t=(${best.tx.toFixed(0)},${best.ty.toFixed(0)}) in Sellador-map px`);

// compose into world px:  world = sellador.o + sellador.scale * (t + s * R(th) * fn)
const S = sel.scale * best.s;
fn.transform = { scale: +S.toFixed(5), rot: +best.th.toFixed(5), ox: +(sel.ox + sel.scale * best.tx).toFixed(2), oy: +(sel.oy + sel.scale * best.ty).toFixed(2), fitted: true, score: +best.sc.toFixed(3) };
fs.writeFileSync(fnFile, JSON.stringify(fn, null, 2));
console.log('world transform', fn.transform);
