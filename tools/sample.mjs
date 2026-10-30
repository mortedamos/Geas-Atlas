import fs from 'node:fs';
import jpeg from 'jpeg-js';

const file = process.argv[2];
const img = jpeg.decode(fs.readFileSync(file), { useTArray: true });
const { width, height, data } = img;
const px = (x, y) => [...data.slice((y * width + x) * 4, (y * width + x) * 4 + 3)];
console.log('size', width, height);
for (const [x, y] of [[600, 200], [900, 900], [50, 900], [300, 300], [250, 350], [700, 500], [575, 740], [500, 520]]) {
  console.log(x, y, px(x, y));
}
// color histogram of coarse buckets
const hist = new Map();
for (let i = 0; i < width * height; i++) {
  const k = [data[i * 4] >> 5, data[i * 4 + 1] >> 5, data[i * 4 + 2] >> 5].join(',');
  hist.set(k, (hist.get(k) || 0) + 1);
}
console.log([...hist.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8));
