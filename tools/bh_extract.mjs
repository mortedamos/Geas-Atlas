// Berhagen (Wonderdraft) -> source/berhagen.json: land outline from the map's mask, plus its symbols, roads, rivers and labels.
// usage: node bh_extract.mjs [--write]
import fs from 'node:fs';
import sharp from 'sharp';
import { contours } from 'd3-contour';
import * as turf from '@turf/turf';
import { readGcpf } from './wd_read.mjs';
import { decodeVariant } from './godot_var.mjs';

const m = decodeVariant(readGcpf(fs.readFileSync('../original_data/maps/berhagen.wonderdraft_map')), 4).value;
const W = m.map_width, H = m.map_height, bytes = m.mask.props.data.data.bytes;
const RECT = [540, 304, 2459, 1383]; // the painted part of the canvas
const PAD = 320, D = 3; // land runs on past the painted rectangle; D = down-sampling for the outline
// land = alpha > 0, with the edge pixels of the rectangle repeated outwards
const gw = Math.ceil((RECT[2] - RECT[0] + 1 + 2 * PAD) / D), gh = Math.ceil((RECT[3] - RECT[1] + 1 + 2 * PAD) / D);
const grid = new Float32Array(gw * gh);
for (let j = 0; j < gh; j++) for (let i = 0; i < gw; i++) {
  const x = Math.min(RECT[2], Math.max(RECT[0], RECT[0] - PAD + i * D)), y = Math.min(RECT[3], Math.max(RECT[1], RECT[1] - PAD + j * D));
  grid[j * gw + i] = bytes[(y * W + x) * 4 + 3] > 40 ? 1 : 0;
}
const mp = contours().size([gw, gh]).thresholds([0.5])(grid)[0];
const toPx = ([i, j]) => [RECT[0] - PAD + i * D, RECT[1] - PAD + j * D];
let best = null, bestA = 0;
for (const poly of mp.coordinates) { const a = Math.abs(turf.area(turf.polygon([poly[0]]))); if (a > bestA) { bestA = a; best = poly[0]; } }
let line = turf.simplify(turf.lineString(best), { tolerance: 1.3, highQuality: true }).geometry.coordinates;
if (line[0][0] === line[line.length - 1][0] && line[0][1] === line[line.length - 1][1]) line = line.slice(0, -1);
const land = line.map(toPx).map(([x, y]) => [+x.toFixed(1), +y.toFixed(1)]);
console.log('land outline points', land.length, 'bbox', Math.min(...land.map((p) => p[0])), Math.min(...land.map((p) => p[1])), Math.max(...land.map((p) => p[0])), Math.max(...land.map((p) => p[1])));

const parse = (s) => [...s.matchAll(/Vector2\( ([-\d.]+), ([-\d.]+) \)/g)].map((q) => [+q[1], +q[2]]);
const roads = m.paths.map((p) => ({ style: p.style.split('/').pop(), width: p.width, pts: parse(p.points).map(([x, y]) => [+(x + p.position.x).toFixed(1), +(y + p.position.y).toFixed(1)]) }));
const symbols = m.symbols.map((s) => ({ t: s.texture.replace('res://sprites/', ''), type: s.type, x: +s.position.x.toFixed(1), y: +s.position.y.toFixed(1), sx: +s.scale.x.toFixed(2) }));
const labels = m.labels.map((l) => ({ text: l.text, x: +l.position.x.toFixed(1), y: +l.position.y.toFixed(1), size: l.size }));
console.log('roads', roads.map((r) => r.pts.length).join(','), 'symbols', symbols.length, 'labels', labels.length);
if (process.argv.includes('--write')) {
  fs.writeFileSync('source/berhagen.json', JSON.stringify({ _note: "The author's Wonderdraft map of the Berhagen area (original_data/maps/berhagen.wonderdraft_map, canvas 3000x1688; a rendered picture is berhagen_render.webp). Read by tools/bh_extract.mjs (decoder: wd_read.mjs + godot_var.mjs). Coordinates are canvas pixels, y down, north up. land = outline of the mask's land (alpha > 0), run on past the painted rectangle 'rect'.", map: 'berhagen.wonderdraft_map', size: [W, H], rect: RECT, land, paper: [[RECT[0], RECT[1]], [RECT[2], RECT[1]], [RECT[2], RECT[3]], [RECT[0], RECT[3]]], raster: { x0: 0, y0: -100, w: 3000, h: 1900, cell: 3 }, roads, symbols, labels }));
  console.log('wrote source/berhagen.json');
}
