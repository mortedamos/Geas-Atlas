// Find where the Kharse / Ertrugol / Boddendell drawing sits on the world map by fitting its two coast lines (the 'land' polygon
// in source/kharse_ertrugol.json) to the land/sea mask of the current world (atlas/data/land.geojson). Writes the transform
// (drawing px -> world px) into the json. usage: node ke_fit.mjs [--write]
import fs from 'node:fs';

const F = 'source/kharse_ertrugol.json';
const def = JSON.parse(fs.readFileSync(F, 'utf8'));
const land = JSON.parse(fs.readFileSync('../atlas/data/land.geojson', 'utf8')).features[0].geometry;

// world land raster, 2 cells per world px over 0..1024 x 0..1024
const G = 2, N = 1024 * G;
const world = new Uint8Array(N * N);
{
  const polys = land.type === 'Polygon' ? [land.coordinates] : land.coordinates;
  for (const poly of polys) {
    const rings = poly.map((r) => r.map(([lng, lat]) => [(lng * 51.2 + 512) * G, (512 - lat * 51.2) * G]));
    const ys = rings[0].map((p) => p[1]), y0 = Math.max(0, Math.floor(Math.min(...ys))), y1 = Math.min(N - 1, Math.ceil(Math.max(...ys)));
    for (let y = y0; y <= y1; y++) {
      const xs = [], yy = y + 0.5;
      for (const r of rings) for (let i = 0; i < r.length - 1; i++) { const [xa, ya] = r[i], [xb, yb] = r[i + 1]; if ((ya > yy) !== (yb > yy)) xs.push(xa + ((yy - ya) / (yb - ya)) * (xb - xa)); }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) for (let x = Math.max(0, Math.ceil(xs[k] - 0.5)); x <= Math.min(N - 1, Math.floor(xs[k + 1] - 0.5)); x++) world[y * N + x] ^= 1;
    }
  }
}
const isLand = (u, v) => { const x = Math.floor(u * G), y = Math.floor(v * G); return x < 0 || y < 0 || x >= N || y >= N ? 0 : world[y * N + x]; };

// drawing raster (coarse, 8 px cells) of the land polygon
const CS = 8, X0 = -400, Y0 = -100, CW = Math.ceil((def.size[0] + 900) / CS), CH = Math.ceil((def.size[1] + 300) / CS);
const inPoly = (poly, x, y) => { let inside = false; for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) { const [xa, ya] = poly[a], [xb, yb] = poly[b]; if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside; } return inside; };
const draw = new Uint8Array(CW * CH);
for (let j = 0; j < CH; j++) for (let i = 0; i < CW; i++) draw[j * CW + i] = inPoly(def.land, X0 + (i + 0.5) * CS, Y0 + (j + 0.5) * CS) ? 1 : 0;
const samples = [];
const [PW, PH] = def.size;
for (let y = 40; y < PH - 20; y += CS * 2) for (let x = 80; x < PW - 20; x += CS * 2) samples.push([x, y, draw[Math.floor((y - Y0) / CS) * CW + Math.floor((x - X0) / CS)]]);
console.log('samples', samples.length);

const score = (s, th, tx, ty) => {
  const c = Math.cos(th), sn = Math.sin(th); let ok = 0;
  for (const [x, y, v] of samples) ok += isLand(tx + s * (c * x - sn * y), ty + s * (sn * x + c * y)) === v ? 1 : 0;
  return ok / samples.length;
};
const deg = Math.PI / 180;
let best = { sc: 0 };
for (let s = 0.02; s <= 0.08; s += 0.004) for (let t = -24; t <= 24; t += 6) for (let tx = 60; tx <= 300; tx += 6) for (let ty = 150; ty <= 400; ty += 6) {
  const sc = score(s, t * deg, tx, ty); if (sc > best.sc) best = { sc, s, th: t * deg, tx, ty };
}
console.log('coarse', best.sc.toFixed(3), best);
for (const [ds, dt, dp] of [[0.005, 2, 5], [0.002, 0.8, 2], [0.001, 0.4, 1], [0.0005, 0.2, 0.5]]) {
  const c = { ...best };
  for (let s = c.s - 3 * ds; s <= c.s + 3 * ds + 1e-9; s += ds) for (let t = c.th / deg - 3 * dt; t <= c.th / deg + 3 * dt + 1e-9; t += dt) for (let tx = c.tx - 4 * dp; tx <= c.tx + 4 * dp + 1e-9; tx += dp) for (let ty = c.ty - 4 * dp; ty <= c.ty + 4 * dp + 1e-9; ty += dp) {
    const sc = score(s, t * deg, tx, ty); if (sc > best.sc) best = { sc, s, th: t * deg, tx, ty };
  }
}
console.log('fitted', best.sc.toFixed(3), `scale ${best.s.toFixed(4)} rot ${(best.th / deg).toFixed(1)} deg origin (${best.tx.toFixed(1)}, ${best.ty.toFixed(1)})`);
console.log(`map spans about ${(PW * best.s).toFixed(0)} x ${(PH * best.s).toFixed(0)} world px = ${(PW * best.s * 8.724).toFixed(0)} x ${(PH * best.s * 8.724).toFixed(0)} miles`);
if (process.argv.includes('--write')) {
  def.transform = { scale: +best.s.toFixed(5), rot: +best.th.toFixed(5), ox: +best.tx.toFixed(2), oy: +best.ty.toFixed(2), fitted: true, score: +best.sc.toFixed(3) };
  fs.writeFileSync(F, JSON.stringify(def, null, 1));
  console.log('wrote transform');
}
