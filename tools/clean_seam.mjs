// Remove a horizontal paper seam (two sheets overlapping) from a scanned map: rows y0..y1 are replaced by the rows
// just outside the band (upper half from above, lower half from below), so lines crossing the seam stay continuous.
// usage: node clean_seam.mjs in.jpg out.jpg y0 y1
import { loadJpeg, saveJpeg } from './lib.mjs';

const [input, output, Y0, Y1] = process.argv.slice(2);
const y0 = Number(Y0), y1 = Number(Y1);
const img = loadJpeg(input);
const { width: W, height: H, data } = img;
const out = Buffer.from(data);
const mid = Math.round((y0 + y1) / 2);
for (let y = y0; y <= y1; y++) {
  const src = y < mid ? y0 - 4 : y1 + 4;
  for (let x = 0; x < W; x++) for (let k = 0; k < 4; k++) out[(y * W + x) * 4 + k] = data[(src * W + x) * 4 + k];
}
// The two sheets are a little out of register, so a line that crosses the seam jogs sideways. Join each ink run
// above the seam to the nearest one below it with a short horizontal stroke.
const lum = (y, x) => 0.3 * out[(y * W + x) * 4] + 0.59 * out[(y * W + x) * 4 + 1] + 0.11 * out[(y * W + x) * 4 + 2];
function runs(y) {
  const r = []; let s = -1;
  for (let x = 0; x <= W; x++) {
    const dark = x < W && lum(y, x) < 150;
    if (dark && s < 0) s = x;
    if (!dark && s >= 0) { r.push((s + x - 1) / 2); s = -1; }
  }
  return r;
}
const upper = runs(mid - 2), lower = runs(mid + 2);
let joined = 0;
for (const cu of upper) {
  let best = null;
  for (const cl of lower) if (Math.abs(cl - cu) <= 90 && (!best || Math.abs(cl - cu) < Math.abs(best - cu))) best = cl;
  if (best === null || Math.abs(best - cu) < 2) continue;
  for (let x = Math.round(Math.min(cu, best)); x <= Math.round(Math.max(cu, best)); x++) for (let dy = -2; dy <= 2; dy++) for (let k = 0; k < 3; k++) out[((mid + dy) * W + x) * 4 + k] = 20;
  joined++;
}
console.log('joined', joined, 'lines across the seam');
saveJpeg(output, W, H, out);
console.log('cleaned seam rows', y0, '-', y1);
