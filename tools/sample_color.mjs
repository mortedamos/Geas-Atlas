// usage: node sample_color.mjs img.jpg x,y x,y ...   -> mean RGB (and brightness) over a 9x9 window
import { loadJpeg } from './lib.mjs';
const [file, ...pts] = process.argv.slice(2);
const img = loadJpeg(file);
for (const p of pts) {
  const [x, y] = p.split(',').map(Number);
  let r = 0, g = 0, b = 0, n = 0;
  for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
    const i = ((y + dy) * img.width + x + dx) * 4;
    r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; n++;
  }
  console.log(p, [r / n, g / n, b / n].map((v) => v.toFixed(0)).join(','));
}
