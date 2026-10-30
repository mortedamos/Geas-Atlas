// usage: node crop.mjs in.jpg out.jpg x y w h scale
import fs from 'node:fs';
import jpeg from 'jpeg-js';

const [input, output, X, Y, CW, CH, S] = process.argv.slice(2);
const [x0, y0, cw, ch, s] = [X, Y, CW, CH, S].map(Number);
const src = jpeg.decode(fs.readFileSync(input), { useTArray: true });
const ow = Math.round(cw * s), oh = Math.round(ch * s);
const out = Buffer.alloc(ow * oh * 4);
for (let y = 0; y < oh; y++) {
  for (let x = 0; x < ow; x++) {
    const sx = Math.min(src.width - 1, Math.floor(x0 + x / s));
    const sy = Math.min(src.height - 1, Math.floor(y0 + y / s));
    const si = (sy * src.width + sx) * 4, di = (y * ow + x) * 4;
    out[di] = src.data[si]; out[di + 1] = src.data[si + 1]; out[di + 2] = src.data[si + 2]; out[di + 3] = 255;
  }
}
fs.writeFileSync(output, jpeg.encode({ data: out, width: ow, height: oh }, 92).data);
