// Trace landmasses from geas_worldmap_big.jpg into GeoJSON (lon/lat, pixel grid mapped linearly).
// usage: node trace_world.mjs <input.jpg> <outDir>
import fs from 'node:fs';
import path from 'node:path';
import jpeg from 'jpeg-js';
import { contours } from 'd3-contour';
import * as turf from '@turf/turf';

const [input, outDir] = process.argv.slice(2);
const img = jpeg.decode(fs.readFileSync(input), { useTArray: true });
const { width: W, height: H, data } = img;

// World pixel space -> lon/lat. 1024px = 20 degrees, centred on 0,0 (keeps Mercator distortion ~1%).
const SPAN = 20;
const toLL = ([x, y]) => [((x - W / 2) * SPAN) / W, (-(y - H / 2) * SPAN) / W];

// Land = anything that isn't the flat ocean blue (0,129,195).
const OCEAN = [0, 129, 195];
const field = new Float32Array(W * H);
for (let i = 0; i < W * H; i++) {
  const d = Math.hypot(data[i * 4] - OCEAN[0], data[i * 4 + 1] - OCEAN[1], data[i * 4 + 2] - OCEAN[2]);
  field[i] = d > 90 ? 1 : 0;
}
// Blank the "The World of Geas" title logo.
for (let y = 0; y < 80; y++) for (let x = 690; x < 850; x++) field[y * W + x] = 0;

// Box blur to remove JPEG fringing and ink speckle before contouring.
function blur(src, r) {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  for (let y = 0; y < H; y++) {
    let acc = 0;
    for (let x = -r; x <= r; x++) acc += src[y * W + Math.min(W - 1, Math.max(0, x))];
    for (let x = 0; x < W; x++) {
      tmp[y * W + x] = acc / (2 * r + 1);
      acc += src[y * W + Math.min(W - 1, x + r + 1)] - src[y * W + Math.max(0, x - r)];
    }
  }
  for (let x = 0; x < W; x++) {
    let acc = 0;
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(H - 1, Math.max(0, y)) * W + x];
    for (let y = 0; y < H; y++) {
      out[y * W + x] = acc / (2 * r + 1);
      acc += tmp[Math.min(H - 1, y + r + 1) * W + x] - tmp[Math.max(0, y - r) * W + x];
    }
  }
  return out;
}
const smooth = blur(blur(field, 2), 2);

// Pad so landmasses touching the image edge still close into polygons.
const PAD = 2;
const PW = W + PAD * 2, PH = H + PAD * 2;
const padded = new Float32Array(PW * PH);
for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) padded[(y + PAD) * PW + x + PAD] = smooth[y * W + x];

const multi = contours().size([PW, PH]).thresholds([0.5])(padded)[0];

function chaikin(ring, iters) {
  let pts = ring.slice(0, -1);
  for (let k = 0; k < iters; k++) {
    const next = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      next.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25]);
      next.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    pts = next;
  }
  return [...pts, pts[0]];
}

const ringArea = (r) => {
  let a = 0;
  for (let i = 0; i < r.length - 1; i++) a += r[i][0] * r[i + 1][1] - r[i + 1][0] * r[i][1];
  return Math.abs(a) / 2;
};

const MIN_ISLAND = 40; // px^2
const MIN_LAKE = 60;
const polys = [];
for (const poly of multi.coordinates) {
  if (ringArea(poly[0]) < MIN_ISLAND) continue;
  const rings = poly
    .filter((r, i) => i === 0 || ringArea(r) >= MIN_LAKE)
    .map((r) => r.map(([x, y]) => [x - PAD, y - PAD]));
  polys.push(rings);
}

// Light simplification in pixel space, then smooth, then project.
let land = turf.multiPolygon(polys);
land = turf.simplify(land, { tolerance: 0.6, highQuality: true });
land = turf.multiPolygon(
  land.geometry.coordinates.map((poly) => poly.map((r) => chaikin(r, 2).map(toLL))),
);
land = turf.cleanCoords(land);

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'land.geojson'), JSON.stringify(turf.featureCollection([land])));

// Water-depth bands: progressively larger buffers around the land (distance in km; 1 deg ~ 111.19 km).
const px = SPAN / W * 111.19; // km per source pixel
const bands = [];
for (const [name, pixels] of [['shallows', 7], ['shelf', 16], ['coast', 32]]) {
  const b = turf.buffer(land, pixels * px, { units: 'kilometers', steps: 8 });
  bands.push({ ...b, properties: { band: name } });
}
fs.writeFileSync(path.join(outDir, 'water_bands.geojson'), JSON.stringify(turf.featureCollection(bands)));

console.log('polygons:', land.geometry.coordinates.length, 'bbox:', turf.bbox(land).map((n) => +n.toFixed(3)));
console.log('bytes land:', fs.statSync(path.join(outDir, 'land.geojson')).size);
