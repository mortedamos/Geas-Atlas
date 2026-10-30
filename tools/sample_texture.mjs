// usage: node sample_texture.mjs img.jpg x,y ...  -> local mean/std of green (r=10 window) and luma
import { loadJpeg } from './lib.mjs';
const [file, ...pts] = process.argv.slice(2);
const img = loadJpeg(file);
for (const p of pts) {
  const [x, y] = p.split(',').map(Number);
  let s = 0, s2 = 0, n = 0, br = 0;
  for (let dy = -10; dy <= 10; dy++) for (let dx = -10; dx <= 10; dx++) {
    const i = ((y + dy) * img.width + x + dx) * 4;
    const g = img.data[i + 1]; s += g; s2 += g * g; n++;
    br += img.data[i] + img.data[i + 1] + img.data[i + 2];
  }
  const m = s / n;
  console.log(p, 'meanG', m.toFixed(1), 'stdG', Math.sqrt(s2 / n - m * m).toFixed(1), 'bright', (br / n).toFixed(0));
}
