// Shared image helpers for the tracing / registration scripts.
import fs from 'node:fs';
import jpeg from 'jpeg-js';

export function loadJpeg(file) {
  const { width, height, data } = jpeg.decode(fs.readFileSync(file), { useTArray: true });
  return { width, height, data };
}

export function saveJpeg(file, width, height, rgba) {
  fs.writeFileSync(file, jpeg.encode({ data: rgba, width, height }, 92).data);
}

export const OCEAN = [0, 129, 195];
export const isOcean = (r, g, b) => Math.hypot(r - OCEAN[0], g - OCEAN[1], b - OCEAN[2]) < 90;

/** Float image {w,h,v} where v is 0..255 ink (dark strokes), pure ocean blue counts as no ink. */
export function inkMap(img, { ignoreOcean = false } = {}) {
  const { width: w, height: h, data } = img;
  const v = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    if (ignoreOcean && isOcean(r, g, b)) continue;
    v[i] = 255 - (0.3 * r + 0.59 * g + 0.11 * b);
  }
  return { w, h, v };
}

/** Area-average resize of a float image by factor s (<1 shrinks). */
export function resizeBox(m, s) {
  const w = Math.max(1, Math.round(m.w * s)), h = Math.max(1, Math.round(m.h * s));
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y / s), y1 = Math.max(y0 + 1, Math.min(m.h, Math.floor((y + 1) / s)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x / s), x1 = Math.max(x0 + 1, Math.min(m.w, Math.floor((x + 1) / s)));
      let acc = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) { acc += m.v[yy * m.w + xx]; n++; }
      out[y * w + x] = acc / n;
    }
  }
  return { w, h, v: out };
}

export function boxBlur(m, r) {
  const { w, h } = m;
  const tmp = new Float32Array(w * h), out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += m.v[y * w + Math.min(w - 1, Math.max(0, x))];
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / (2 * r + 1);
      acc += m.v[y * w + Math.min(w - 1, x + r + 1)] - m.v[y * w + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x] - tmp[Math.max(0, y - r) * w + x];
    }
  }
  return { w, h, v: out };
}
