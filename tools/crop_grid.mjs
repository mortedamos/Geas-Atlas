// Crop a region of an image, enlarge it, and overlay a labelled coordinate grid (source-pixel coordinates).
// usage: node crop_grid.mjs in.jpg out.jpg x y w h scale [gridStep=50]
import { loadJpeg, saveJpeg } from './lib.mjs';

const [input, output, X, Y, CW, CH, S, G] = process.argv.slice(2);
const [x0, y0, cw, ch, s] = [X, Y, CW, CH, S].map(Number);
const step = G ? +G : 50;
const src = loadJpeg(input);
const ow = Math.round(cw * s), oh = Math.round(ch * s);
const out = Buffer.alloc(ow * oh * 4);
for (let y = 0; y < oh; y++) {
  for (let x = 0; x < ow; x++) {
    const sx = Math.min(src.width - 1, Math.floor(x0 + x / s)), sy = Math.min(src.height - 1, Math.floor(y0 + y / s));
    const si = (sy * src.width + sx) * 4, di = (y * ow + x) * 4;
    out[di] = src.data[si]; out[di + 1] = src.data[si + 1]; out[di + 2] = src.data[si + 2]; out[di + 3] = 255;
  }
}
// 3x5 digit font
const DIG = {
  0: '111101101101111', 1: '010110010010111', 2: '111001111100111', 3: '111001111001111', 4: '101101111001001',
  5: '111100111001111', 6: '111100111101111', 7: '111001001001001', 8: '111101111101111', 9: '111101111001111',
};
const put = (px, py, r, g, b) => { if (px >= 0 && py >= 0 && px < ow && py < oh) { const i = (py * ow + px) * 4; out[i] = r; out[i + 1] = g; out[i + 2] = b; } };
function text(str, px, py, color) {
  const k = 2;
  let cx = px;
  for (const ch of String(str)) {
    const bits = DIG[ch];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) if (bits[r * 3 + c] === '1') for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) put(cx + c * k + a, py + r * k + b, ...color);
    cx += 4 * k;
  }
}
const first = (v) => Math.ceil(v / step) * step;
for (let gx = first(x0); gx < x0 + cw; gx += step) {
  const px = Math.round((gx - x0) * s);
  const major = gx % (step * 2) === 0;
  for (let y = 0; y < oh; y++) if (y % 3 !== 2) put(px, y, major ? 255 : 255, major ? 0 : 120, major ? 0 : 0);
  text(gx, px + 2, 2, [255, 0, 0]);
}
for (let gy = first(y0); gy < y0 + ch; gy += step) {
  const py = Math.round((gy - y0) * s);
  for (let x = 0; x < ow; x++) if (x % 3 !== 2) put(x, py, 255, 0, 120);
  text(gy, 2, py + 2, [255, 0, 160]);
}
saveJpeg(output, ow, oh, out);
