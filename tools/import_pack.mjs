// Import a ready-made pack of individual transparent PNG symbols into atlas/symbols using pack_config.json:
// trims empty margins, interleaves the listed folders so any variant number gives a good mix, and writes
// manifest.json with a per-image pixelRatio so every category appears at a sensible on-screen size.
// usage: node import_pack.mjs [pack_config.json]
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
const { PNG } = createRequire(import.meta.url)('pngjs');

const configFile = path.resolve(process.argv[2] || 'pack_config.json');
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
const SRC = path.resolve(path.dirname(configFile), config.source);
const OUT = path.resolve(path.dirname(configFile), '..', 'atlas', 'symbols');
const natural = (a, b) => a.localeCompare(b, undefined, { numeric: true });

function trimmed(file) {
  const p = PNG.sync.read(fs.readFileSync(file));
  let x0 = p.width, y0 = p.height, x1 = -1, y1 = -1;
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
    if (p.data[(y * p.width + x) * 4 + 3] > 6) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  if (x1 < 0) return null;
  const w = x1 - x0 + 1, h = y1 - y0 + 1;
  const out = new PNG({ width: w, height: h });
  PNG.bitblt(p, out, x0, y0, w, h, 0, 0);
  return out;
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const manifest = { credit: config.credit, images: {}, categories: {} };
const median = (a) => a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)];

// categories: interleave the groups (A1,B1,C1,A2,B2,...) so variant numbers mix the symbol types evenly
for (const [prefix, def] of Object.entries(config.categories)) {
  const lists = def.files ? [def.files.map((f) => path.join(SRC, f))] : def.groups.map((g) => fs.readdirSync(path.join(SRC, g)).filter((f) => /\.png$/i.test(f)).sort(natural).map((f) => path.join(SRC, g, f)));
  const order = [];
  for (let i = 0; i < Math.max(...lists.map((l) => l.length)); i++) for (const l of lists) if (l[i]) order.push(l[i]);
  const imgs = order.map((f) => trimmed(f)).filter(Boolean);
  const pr = median(imgs.map((im) => Math.max(im.width, im.height))) / def.target;
  manifest.categories[prefix] = [];
  imgs.forEach((im, i) => {
    const name = `${prefix}-${i}`;
    fs.writeFileSync(path.join(OUT, `${name}.png`), PNG.sync.write(im));
    manifest.images[name] = { file: `${name}.png`, w: im.width, h: im.height, pr: +pr.toFixed(3) };
    manifest.categories[prefix].push(name);
  });
  console.log(`${prefix}: ${imgs.length} images, pixelRatio ${pr.toFixed(2)}`);
}

// named symbols (settlements etc.) share one pixelRatio so relative sizes are kept
if (config.named) {
  const entries = Object.entries(config.named.files).map(([name, rel]) => [name, trimmed(path.join(SRC, rel))]).filter(([, im]) => im);
  const pr = median(entries.map(([, im]) => Math.max(im.width, im.height))) / config.named.target;
  for (const [name, im] of entries) {
    fs.writeFileSync(path.join(OUT, `${name}.png`), PNG.sync.write(im));
    manifest.images[name] = { file: `${name}.png`, w: im.width, h: im.height, pr: +pr.toFixed(3) };
  }
  console.log(`named: ${entries.length} images, pixelRatio ${pr.toFixed(2)}`);
}

fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 1));
fs.writeFileSync(path.join(OUT, 'CREDITS.md'), `# Symbol credits\n\n${config.credit.text}\n\n- Source: ${config.credit.url}\n- Licence: Creative Commons Attribution 4.0 International (${config.credit.license})\n- Changes: transparent margins trimmed and images rescaled for display; no other modification.\n`);
console.log('wrote', OUT);
