// quick text diagnostics of tools/climate.mjs output (currents, SST anomaly at a few spots)
import fs from 'node:fs';
const c = JSON.parse(fs.readFileSync('../atlas/data/climate.json', 'utf8'));
const { nx, ny, cell: H, x0, y0 } = c;
const IDX = (i, j) => j * nx + ((i % nx) + nx) % nx;
const at = (x, y) => {
  const i = Math.floor((x - x0) / H), j = Math.floor((y - y0) / H), k = IDX(i, j);
  return { land: c.land[k], anom: +(c.anomaly[k] / 10).toFixed(1), sstJan: +(c.sstJan[k] / 10).toFixed(1), sstJul: +(c.sstJul[k] / 10).toFixed(1), cu: +(c.cu[k] / 100).toFixed(2), cv: +(c.cv[k] / 100).toFixed(2) };
};
for (const [n, x, y] of (process.argv[2] ? JSON.parse(process.argv[2]) : [['W of Sellador', -40, 262], ['strait mouth', 20, 216], ['Inner sea', 170, 235], ['W of Tel', -30, 150], ['W ocean mid', -300, 300], ['W ocean S', -300, 500], ['E of Curmeah', 780, 500], ['W of Curmeah', 330, 520], ['S ocean', 200, 1000]])) console.log(n.padEnd(16), JSON.stringify(at(x, y)));
const dirs = ['E', 'e', 'N', 'n', 'W', 'w', 'S', 's']; // E=east, e=north-east, N=north, n=north-west, W=west, w=south-west, S=south, s=south-east
let out = '';
for (let j = 2; j < ny - 2; j += 6) {
  let line = String(Math.round(y0 + H * (j + 0.5))).padStart(5) + ' ';
  for (let i = 0; i < nx; i += 4) {
    const k = IDX(i, j);
    if (c.land[k]) { line += '#'; continue; }
    const u = c.cu[k], v = c.cv[k];
    if (Math.hypot(u, v) < 8) { line += '.'; continue; }
    const a = Math.atan2(v, u); // 0 = east, pi/2 = north
    line += dirs[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8];
  }
  out += line + '\n';
}
console.log(out);
