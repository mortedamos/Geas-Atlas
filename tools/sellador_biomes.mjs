// Classify the rendered Sellador map into biome masks (forest / mountain / desert / lake) from colour.
// usage: node sellador_biomes.mjs <debug.jpg>   (also exported for compose step)
import path from 'node:path';
import { loadJpeg, saveJpeg, boxBlur } from './lib.mjs';

const MAPS = path.resolve('..', 'original_data/web/img/gallery/maps');

export function classifySellador() {
  const img = loadJpeg(path.join(MAPS, 'sellador map big.jpg'));
  const { width: w, height: h, data } = img;
  const n = w * h;
  const feat = { sea: new Float32Array(n), desert: new Float32Array(n), mountain: new Float32Array(n), forestG: new Float32Array(n) };
  for (let i = 0; i < n; i++) {
    const r = data[i * 4], g = data[i * 4 + 1], b = data[i * 4 + 2];
    const isSea = b > r * 1.3 && b > g * 1.05 && b > 50;
    feat.sea[i] = isSea ? 1 : 0;
    feat.desert[i] = r > 150 && r > g && g > b && r - b > 40 ? 1 : 0;
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    feat.mountain[i] = !isSea && spread < 28 && r + g + b > 60 ? 1 : 0;
    // dark mountain rock is nearly black: treat very dark neutral pixels as mountain too
    if (!isSea && r + g + b < 120 && spread < 22) feat.mountain[i] = 1;
    feat.forestG[i] = g;
  }
  const blurred = (arr, r) => boxBlur({ w, h, v: arr }, r).v;
  const sea = blurred(feat.sea, 4);
  const desert = blurred(feat.desert, 5);
  const mountain = blurred(feat.mountain, 7);
  // forests are drawn as a high-contrast tree pattern: use local standard deviation of green as the signal
  const gm = blurred(feat.forestG, 6);
  const g2 = blurred(feat.forestG.map((v) => v * v), 6);
  const std = new Float32Array(n);
  for (let i = 0; i < n; i++) std[i] = Math.sqrt(Math.max(0, g2[i] - gm[i] * gm[i]));
  const g = blurred(std, 8);
  const FOREST_G = Number(process.env.FOREST_G || 23);
  const cls = new Uint8Array(n); // 0 sea, 1 plains, 2 forest, 3 mountain, 4 desert
  for (let i = 0; i < n; i++) {
    if (sea[i] > 0.5) cls[i] = 0;
    else if (desert[i] > 0.4) cls[i] = 4;
    else if (mountain[i] > 0.45) cls[i] = 3;
    else if (g[i] > FOREST_G) cls[i] = 2;
    else cls[i] = 1;
  }
  return { w, h, cls };
}

if (process.argv[1].endsWith('sellador_biomes.mjs') && process.argv[2]) {
  const { w, h, cls } = classifySellador();
  const colors = [[20, 50, 120], [90, 130, 60], [20, 90, 30], [150, 150, 150], [230, 200, 140]];
  const px = Buffer.alloc(w * h * 4);
  for (let i = 0; i < w * h; i++) { const c = colors[cls[i]]; px[i * 4] = c[0]; px[i * 4 + 1] = c[1]; px[i * 4 + 2] = c[2]; px[i * 4 + 3] = 255; }
  saveJpeg(process.argv[2], w, h, px);
  const counts = [0, 0, 0, 0, 0]; for (const c of cls) counts[c]++;
  console.log('sea/plains/forest/mountain/desert fractions', counts.map((c) => (c / (w * h)).toFixed(3)).join(' '));
}
