// Turn a photographed / scanned pen drawing into clean black-on-white linework by comparing each pixel with its
// local paper brightness (removes shadows, creases and paper texture).
// usage: node binarize.mjs in.jpg out.jpg [drop=45] [bgRadius=30]
import { loadJpeg, saveJpeg, boxBlur } from './lib.mjs';

const [input, output, DROP, BGR] = process.argv.slice(2);
const drop = Number(DROP || 45), radius = Number(BGR || 30);
const img = loadJpeg(input);
const { width: W, height: H, data } = img;
const gray = { w: W, h: H, v: new Float32Array(W * H) };
for (let i = 0; i < W * H; i++) gray.v[i] = 0.3 * data[i * 4] + 0.59 * data[i * 4 + 1] + 0.11 * data[i * 4 + 2];
// paper brightness: a wide blur of the *brighter* pixels, so ink does not drag it down
const bgSrc = { w: W, h: H, v: Float32Array.from(gray.v, (v) => Math.max(v, 150)) };
const bg = boxBlur(bgSrc, radius);
const out = Buffer.alloc(W * H * 4);
let inkN = 0;
for (let i = 0; i < W * H; i++) {
  const ink = bg.v[i] - gray.v[i] > drop;
  inkN += ink ? 1 : 0;
  const c = ink ? 0 : 255;
  out[i * 4] = out[i * 4 + 1] = out[i * 4 + 2] = c; out[i * 4 + 3] = 255;
}
saveJpeg(output, W, H, out);
console.log('ink fraction', (inkN / (W * H) * 100).toFixed(2) + '%');
