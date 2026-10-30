// Register a rendered (colour) regional map to the world composite by land/sea mask agreement.
// usage: node register_mask.mjs regional.jpg sMin sMax sStep oxMin oxMax oyMin oyMax
import path from 'node:path';
import { loadJpeg, saveJpeg } from './lib.mjs';
import { worldSeaField } from './regional_mask.mjs';

const [file, sMin, sMax, sStep, oxMin, oxMax, oyMin, oyMax] = process.argv.slice(2);
const world = loadJpeg(path.resolve('..', 'original_data/web/img/gallery/maps/geas_worldmap_big.jpg'));
const wsea = worldSeaField(world);
const reg = loadJpeg(file);

// regional sea: blue-dominant pixels. Sampled on a coarse grid.
const STEP = 12;
const cells = [];
for (let y = STEP; y < reg.height - STEP / 2; y += STEP) {
  for (let x = STEP; x < reg.width - STEP / 2; x += STEP) {
    let blue = 0, n = 0;
    for (let dy = -3; dy <= 3; dy += 3) for (let dx = -3; dx <= 3; dx += 3) {
      const i = ((y + dy) * reg.width + x + dx) * 4;
      const r = reg.data[i], g = reg.data[i + 1], b = reg.data[i + 2];
      if (b > r * 1.35 && b > g * 1.05 && b > 60) blue++;
      n++;
    }
    cells.push({ x, y, sea: blue / n > 0.5 ? 1 : 0 });
  }
}
console.log('cells', cells.length, 'regional sea fraction', (cells.filter((c) => c.sea).length / cells.length).toFixed(2));

const res = [];
for (let s = +sMin; s <= +sMax + 1e-9; s += +sStep) {
  for (let oy = +oyMin; oy <= +oyMax; oy++) {
    for (let ox = +oxMin; ox <= +oxMax; ox++) {
      let agree = 0, counted = 0;
      for (const c of cells) {
        const u = Math.floor(ox + s * c.x), v = Math.floor(oy + s * c.y);
        if (u < 0 || v < 0 || u >= wsea.w || v >= wsea.h) continue;
        counted++;
        if (wsea.v[v * wsea.w + u] === c.sea) agree++;
      }
      if (counted > cells.length * 0.95) res.push({ score: agree / counted, s, ox, oy });
    }
  }
}
res.sort((a, b) => b.score - a.score);
for (const r of res.slice(0, 8)) console.log(`agree ${r.score.toFixed(3)} scale ${r.s.toFixed(3)} origin (${r.ox}, ${r.oy})`);
